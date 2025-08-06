import axios from 'axios';
import { google } from 'googleapis';
import config from '../config';
import { encryptionService } from '../utils/encryption';
import { generateCodeVerifier, generateCodeChallenge, generateState, createAuthorizationUrl } from '../utils/pkce';
import database from '../database';
import { EncryptedTokens } from '../types';

export class GoogleAuthService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly scopes: string[];

  constructor() {
    this.clientId = config.google.clientId;
    this.clientSecret = config.google.clientSecret;
    this.redirectUri = config.google.redirectUri;
    this.scopes = config.google.scopes;

    if (!this.clientId || !this.clientSecret) {
      throw new Error('Google OAuth credentials not configured');
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
      provider: 'google'
    });

    const url = createAuthorizationUrl(
      'https://accounts.google.com/o/oauth2/v2/auth',
      this.clientId,
      this.redirectUri,
      this.scopes,
      state,
      codeChallenge,
      false // Don't force consent - let Google decide based on user's previous authorization
    );

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
      const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri,
        code_verifier: oauthState.codeVerifier
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
        accessToken: '', // Don't store plain text
        refreshToken: '', // Don't store plain text
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

      const response = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token'
      });

      const { access_token, expires_in, refresh_token } = response.data;
      
      const expiryDate = Date.now() + (expires_in * 1000);
      const newTokens = {
        accessToken: access_token,
        refreshToken: refresh_token || tokens.refreshToken, // Use new refresh token or keep existing
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
      const response = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      const { id, email, name } = response.data;
      return { id, email, name };
    } catch (error) {
      throw new Error('Failed to get user info');
    }
  }

  public createOAuth2Client(encryptedTokens: EncryptedTokens): any {
    const tokens = encryptionService.decryptTokens(encryptedTokens.encryptedData);
    
    const oauth2Client = new google.auth.OAuth2(
      this.clientId,
      this.clientSecret,
      this.redirectUri
    );

    oauth2Client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiryDate
    });

    oauth2Client.on('tokens', (newTokens) => {
      console.log('Google tokens refreshed automatically');
    });

    return oauth2Client;
  }

  public async validateAndRefreshTokens(userId: string, encryptedTokens: EncryptedTokens): Promise<EncryptedTokens> {
    const tokens = encryptionService.decryptTokens(encryptedTokens.encryptedData);
    
    if (tokens.expiryDate && tokens.expiryDate <= Date.now() + 60000) { // Refresh if expires within 1 minute
      try {
        const refreshedTokens = await this.refreshTokens(encryptedTokens);
        await database.updateUserTokens(userId, 'google', refreshedTokens);
        return refreshedTokens;
      } catch (error) {
        throw new Error('Token refresh failed - user needs to re-authenticate');
      }
    }

    return encryptedTokens;
  }

  public async revokeTokens(encryptedTokens: EncryptedTokens): Promise<void> {
    try {
      const tokens = encryptionService.decryptTokens(encryptedTokens.encryptedData);
      
      await axios.post('https://oauth2.googleapis.com/revoke', null, {
        params: {
          token: tokens.refreshToken || tokens.accessToken
        }
      });
    } catch (error) {
      console.error('Failed to revoke Google tokens:', error);
    }
  }
}

export const googleAuthService = new GoogleAuthService();