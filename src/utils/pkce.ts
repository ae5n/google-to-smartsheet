import crypto from 'crypto';

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateCodeChallenge(codeVerifier: string): string {
  return crypto.createHash('sha256').update(codeVerifier).digest('base64url');
}

export function generateState(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function createAuthorizationUrl(
  baseUrl: string,
  clientId: string,
  redirectUri: string,
  scopes: string[],
  state: string,
  codeChallenge: string
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent'
  });

  return `${baseUrl}?${params.toString()}`;
}