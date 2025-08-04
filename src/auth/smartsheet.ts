import axios from 'axios';
import config from '../config';
import { encryptionService } from '../utils/encryption';
import { generateCodeVerifier, generateCodeChallenge, generateState, createAuthorizationUrl } from '../utils/pkce';
import database from '../database';
import { EncryptedTokens } from '../types';

export class SmartsheetAuthService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly scopes: string[];
  private readonly baseUrl = 'https://app.smartsheet.com/b/authorize';
  private readonly tokenUrl = 'https://api.smartsheet.com/2.0/token';
  private readonly apiUrl = 'https://api.smartsheet.com/2.0';

  constructor() {
    this.clientId = config.smartsheet.clientId;
    this.clientSecret = config.smartsheet.clientSecret;
    this.redirectUri = config.smartsheet.redirectUri;
    this.scopes = config.smartsheet.scopes;

    if (!this.clientId || !this.clientSecret) {
      throw new Error('Smartsheet OAuth credentials not configured');
    }
  }

  public async generateAuthUrl(userId?: string): Promise<{ url: string; state: string }> {
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    await database.createOAuthState({
      state,
      codeVerifier,
      userId,
      provider: 'smartsheet'
    });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: this.scopes.join(' '),
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    const url = `${this.baseUrl}?${params.toString()}`;
    return { url, state };
  }

  public async exchangeCodeForTokens(code: string, state: string): Promise<{
    tokens: EncryptedTokens;
    userInfo: { id: string; email: string; name: string };
  }> {
    const oauthState = await database.getOAuthState(state);
    if (!oauthState) {
      throw new Error('Invalid or expired OAuth state');
    }

    await database.deleteOAuthState(state);

    try {
      const tokenResponse = await axios.post(this.tokenUrl, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri,
        code_verifier: oauthState.codeVerifier
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const { access_token, refresh_token, expires_in } = tokenResponse.data;
      
      const userInfo = await this.getUserInfo(access_token);
      
      const expiryDate = Date.now() + (expires_in * 1000);
      const encryptedData = encryptionService.encryptTokens({
        accessToken: access_token,
        refreshToken: refresh_token,
        expiryDate
      });

      const tokens: EncryptedTokens = {
        accessToken: '',
        refreshToken: '',
        expiryDate,
        encryptedData
      };

      return { tokens, userInfo };
    } catch (error: any) {
      if (error.response?.status === 400) {
        throw new Error('Invalid authorization code');
      }
      throw new Error('Failed to exchange code for tokens');
    }
  }

  public async refreshTokens(encryptedTokens: EncryptedTokens): Promise<EncryptedTokens> {
    try {
      const tokens = encryptionService.decryptTokens(encryptedTokens.encryptedData);
      
      if (!tokens.refreshToken) {
        throw new Error('No refresh token available');
      }

      const response = await axios.post(this.tokenUrl, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token'
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const { access_token, expires_in, refresh_token } = response.data;
      
      const expiryDate = Date.now() + (expires_in * 1000);
      const newTokens = {
        accessToken: access_token,
        refreshToken: refresh_token || tokens.refreshToken,
        expiryDate
      };

      const encryptedData = encryptionService.encryptTokens(newTokens);

      return {
        accessToken: '',
        refreshToken: '',
        expiryDate,
        encryptedData
      };
    } catch (error: any) {
      if (error.response?.status === 400) {
        throw new Error('Refresh token expired or revoked');
      }
      throw new Error('Failed to refresh tokens');
    }
  }

  public async getUserInfo(accessToken: string): Promise<{ id: string; email: string; name: string }> {
    try {
      const response = await axios.get(`${this.apiUrl}/users/me`, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      const { id, email, firstName, lastName } = response.data;
      const name = `${firstName} ${lastName}`.trim();
      
      return { 
        id: id.toString(), 
        email: email || `user${id}@smartsheet.com`, // Fallback if email not available
        name: name || `User ${id}` 
      };
    } catch (error) {
      throw new Error('Failed to get user info');
    }
  }

  public async validateAndRefreshTokens(userId: string, encryptedTokens: EncryptedTokens): Promise<EncryptedTokens> {
    const tokens = encryptionService.decryptTokens(encryptedTokens.encryptedData);
    
    if (tokens.expiryDate && tokens.expiryDate <= Date.now() + 60000) {
      try {
        const refreshedTokens = await this.refreshTokens(encryptedTokens);
        await database.updateUserTokens(userId, 'smartsheet', refreshedTokens);
        return refreshedTokens;
      } catch (error) {
        throw new Error('Token refresh failed - user needs to re-authenticate');
      }
    }

    return encryptedTokens;
  }

  public async makeAuthenticatedRequest(
    encryptedTokens: EncryptedTokens,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    data?: any
  ): Promise<any> {
    const tokens = encryptionService.decryptTokens(encryptedTokens.encryptedData);
    
    const config: any = {
      method,
      url: endpoint.startsWith('http') ? endpoint : `${this.apiUrl}${endpoint}`,
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      config.data = data;
    }

    try {
      const response = await axios(config);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new Error('Token expired or invalid');
      }
      throw error;
    }
  }

  public async revokeTokens(encryptedTokens: EncryptedTokens): Promise<void> {
    try {
      const tokens = encryptionService.decryptTokens(encryptedTokens.encryptedData);
      
      await axios.post(`${this.tokenUrl}/revoke`, {
        token: tokens.accessToken
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
    } catch (error) {
      console.error('Failed to revoke Smartsheet tokens:', error);
    }
  }
}

export const smartsheetAuthService = new SmartsheetAuthService();