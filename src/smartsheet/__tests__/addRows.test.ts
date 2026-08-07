import { smartsheetAPIService } from '../api';
import { smartsheetAuthService } from '../../auth/smartsheet';
import database from '../../database';
import { EncryptedTokens, SmartsheetCellValue } from '../../types';

jest.mock('../../auth/smartsheet', () => ({
  smartsheetAuthService: { makeAuthenticatedRequest: jest.fn() }
}));

const mockRequest = smartsheetAuthService.makeAuthenticatedRequest as jest.Mock;

const tokens = { encryptedData: 'x' } as EncryptedTokens;

const makeRows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    cells: [{ columnId: 1, value: `row-${i}` }] as SmartsheetCellValue[]
  }));

/** Mirrors Smartsheet: one object per submitted row, in submission order. */
const insertedResponse = (submitted: any[], startId = 1000) => ({
  result: submitted.map((_, i) => ({ id: startId + i, rowNumber: i + 1 }))
});

beforeEach(() => {
  mockRequest.mockReset();
});

// Importing the API module constructs the shared Postgres pool; leaving it open
// keeps the Jest worker alive after the suite finishes.
afterAll(async () => {
  await database.close();
});

describe('addRowsToSheet', () => {
  it('reports a target row id for every input row on success', async () => {
    mockRequest.mockImplementation(async (_t, _m, _e, body) => insertedResponse(body));

    const outcome = await smartsheetAPIService.addRowsToSheet(tokens, 1, makeRows(5));

    expect(outcome.success).toBe(5);
    expect(outcome.failed).toBe(0);
    expect(outcome.results).toHaveLength(5);
    outcome.results.forEach((r, i) => {
      expect(r.index).toBe(i);
      expect(r.inserted).toBe(true);
      expect(r.rowId).toBe(1000 + i);
    });
  });

  it('isolates a single bad row instead of failing the whole chunk', async () => {
    // Row 3 is poison: any request containing it is rejected.
    mockRequest.mockImplementation(async (_t, _m, _e, body: any[]) => {
      if (body.some(r => r.cells[0].value === 'row-3')) {
        throw { response: { status: 400, data: { message: 'Invalid cell value' } }, message: 'Bad Request' };
      }
      return insertedResponse(body);
    });

    const outcome = await smartsheetAPIService.addRowsToSheet(tokens, 1, makeRows(8));

    // The old behaviour discarded all 8. Only the offending row should fail.
    expect(outcome.success).toBe(7);
    expect(outcome.failed).toBe(1);

    const failures = outcome.results.filter(r => !r.inserted);
    expect(failures).toHaveLength(1);
    expect(failures[0].index).toBe(3);
    expect(failures[0].error).toContain('400');
  });

  it('keeps results aligned to input positions after bisection', async () => {
    mockRequest.mockImplementation(async (_t, _m, _e, body: any[]) => {
      if (body.some(r => ['row-1', 'row-6'].includes(r.cells[0].value))) {
        throw { response: { status: 400, data: { message: 'nope' } }, message: 'Bad Request' };
      }
      return insertedResponse(body, 500);
    });

    const outcome = await smartsheetAPIService.addRowsToSheet(tokens, 1, makeRows(10));

    expect(outcome.failed).toBe(2);
    expect(outcome.results.filter(r => !r.inserted).map(r => r.index).sort((a, b) => a - b))
      .toEqual([1, 6]);

    // Every surviving row must still carry an id — a misaligned result here is
    // exactly what caused images to be attached to the wrong rows.
    outcome.results
      .filter(r => r.inserted)
      .forEach(r => expect(typeof r.rowId).toBe('number'));
  });

  it('does not claim success when the response cannot be aligned', async () => {
    mockRequest.mockResolvedValue({ result: { message: 'SUCCESS' } });

    const outcome = await smartsheetAPIService.addRowsToSheet(tokens, 1, makeRows(3));

    expect(outcome.success).toBe(0);
    expect(outcome.failed).toBe(3);
    outcome.results.forEach(r => expect(r.error).toMatch(/could not be confirmed/i));
  });

  it('splits input across requests at the 100-row API limit', async () => {
    mockRequest.mockImplementation(async (_t, _m, _e, body) => insertedResponse(body));

    const outcome = await smartsheetAPIService.addRowsToSheet(tokens, 1, makeRows(250));

    expect(outcome.success).toBe(250);
    expect(mockRequest).toHaveBeenCalledTimes(3);
    expect(mockRequest.mock.calls[0][3]).toHaveLength(100);
    expect(mockRequest.mock.calls[2][3]).toHaveLength(50);
  });
});
