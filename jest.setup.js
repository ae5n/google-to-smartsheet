/**
 * Dummy credentials so modules that validate configuration at import time can
 * be loaded under test. These are not secrets and are never used to talk to a
 * real service — every outbound call in the test suite is mocked.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || 'test-encryption-key-0000000000000000';
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET || 'test-session-secret-000000000000000';
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-secret';
process.env.SMARTSHEET_CLIENT_ID = process.env.SMARTSHEET_CLIENT_ID || 'test-ss-client-id';
process.env.SMARTSHEET_CLIENT_SECRET = process.env.SMARTSHEET_CLIENT_SECRET || 'test-ss-secret';
// The pool is constructed lazily and never connects in unit tests — every
// outbound call is mocked — but the connection string must be present.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
