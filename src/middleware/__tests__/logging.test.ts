import { sanitizeLogUrl } from '../logging';

describe('request log URL sanitization', () => {
  it('removes OAuth callback query parameters', () => {
    expect(
      sanitizeLogUrl(
        '/auth/google/callback?state=secret-state&code=secret-code&scope=openid&authuser=1'
      )
    ).toBe('/auth/google/callback');

    expect(
      sanitizeLogUrl('/auth/smartsheet/callback?code=secret-code&state=secret-state')
    ).toBe('/auth/smartsheet/callback');
  });

  it('removes query parameters from every route to avoid future secret leaks', () => {
    expect(sanitizeLogUrl('/api/jobs?token=secret&sheetId=123')).toBe('/api/jobs');
  });

  it('preserves paths that do not contain a query string', () => {
    expect(sanitizeLogUrl('/health')).toBe('/health');
  });
});
