import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { googleAuthService } from '../auth/google';
import { smartsheetAuthService } from '../auth/smartsheet';
import database from '../database';
import { authRateLimiter, requireAuth } from '../middleware/security';
import { authLogger } from '../middleware/logging';
import { APIResponse, SessionUser } from '../types';

const router = Router();

declare module 'express-session' {
  interface SessionData {
    user?: SessionUser;
    csrfToken?: string;
  }
}

router.use(authRateLimiter);

router.get('/google', async (req: Request, res: Response) => {
  try {
    const { url, state } = await googleAuthService.generateAuthUrl(req.session?.user?.id);
    
    authLogger(req, 'google_auth_init', true, { state });
    
    res.json({ 
      success: true, 
      data: { authUrl: url, state } 
    } as APIResponse);
  } catch (error: any) {
    authLogger(req, 'google_auth_init', false, error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to initialize Google authentication' 
    } as APIResponse);
  }
});

router.get('/google/callback', async (req: Request, res: Response) => {
  const { code, state, error: authError } = req.query;

  if (authError) {
    authLogger(req, 'google_callback', false, authError);
    return res.redirect(`${process.env.CLIENT_URL || 'https://localhost:3000'}/auth/error?error=access_denied`);
  }

  if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
    authLogger(req, 'google_callback', false, 'Missing code or state');
    return res.redirect(`${process.env.CLIENT_URL || 'https://localhost:3000'}/auth/error?error=invalid_request`);
  }

  try {
    const { tokens, userInfo } = await googleAuthService.exchangeCodeForTokens(code, state);
    
    let user = await database.getUserByEmail(userInfo.email);
    
    if (!user) {
      user = await database.createUser({
        id: uuidv4(),
        email: userInfo.email,
        name: userInfo.name,
        googleTokens: tokens
      });
    } else {
      await database.updateUserTokens(user.id, 'google', tokens);
      user = await database.getUserById(user.id);
    }

    if (user) {
      req.session.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        googleConnected: !!user.googleTokens,
        smartsheetConnected: !!user.smartsheetTokens
      };

      authLogger(req, 'google_callback', true, { userId: user.id });
    }
    
    res.redirect(`${process.env.CLIENT_URL || 'https://localhost:3000'}/dashboard`);
  } catch (error: any) {
    authLogger(req, 'google_callback', false, error.message);
    res.redirect(`${process.env.CLIENT_URL || 'https://localhost:3000'}/auth/error?error=authentication_failed`);
  }
});

router.post('/google/disconnect', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await database.getUserById(req.session.user!.id);
    
    if (user?.googleTokens) {
      await googleAuthService.revokeTokens(user.googleTokens);
      await database.updateUserTokens(user.id, 'google', null);
    }

    if (req.session.user) {
      req.session.user.googleConnected = false;
    }

    authLogger(req, 'google_disconnect', true, { userId: user?.id });
    
    res.json({ 
      success: true, 
      message: 'Google account disconnected successfully' 
    } as APIResponse);
  } catch (error: any) {
    authLogger(req, 'google_disconnect', false, error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to disconnect Google account' 
    } as APIResponse);
  }
});

router.get('/user', (req: Request, res: Response) => {
  if (!req.session?.user) {
    return res.json({ 
      success: true, 
      data: null 
    } as APIResponse);
  }

  res.json({ 
    success: true, 
    data: req.session.user 
  } as APIResponse);
});

// Smartsheet authentication routes
router.get('/smartsheet', requireAuth, async (req: Request, res: Response) => {
  try {
    const { url, state } = await smartsheetAuthService.generateAuthUrl(req.session.user!.id);
    
    authLogger(req, 'smartsheet_auth_init', true, { state });
    
    res.json({ 
      success: true, 
      data: { authUrl: url, state } 
    } as APIResponse);
  } catch (error: any) {
    authLogger(req, 'smartsheet_auth_init', false, error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to initialize Smartsheet authentication' 
    } as APIResponse);
  }
});

router.get('/smartsheet/callback', async (req: Request, res: Response) => {
  const { code, state, error: authError } = req.query;

  if (authError) {
    authLogger(req, 'smartsheet_callback', false, authError);
    return res.redirect(`${process.env.CLIENT_URL || 'https://localhost:3000'}/auth/error?error=access_denied`);
  }

  if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
    authLogger(req, 'smartsheet_callback', false, 'Missing code or state');
    return res.redirect(`${process.env.CLIENT_URL || 'https://localhost:3000'}/auth/error?error=invalid_request`);
  }

  try {
    // Get OAuth state before it gets deleted by exchangeCodeForTokens
    const oauthState = await database.getOAuthState(state);
    if (!oauthState?.userId) {
      throw new Error('No user associated with this OAuth state');
    }

    const { tokens } = await smartsheetAuthService.exchangeCodeForTokens(code, state);

    await database.updateUserTokens(oauthState.userId, 'smartsheet', tokens);

    if (req.session.user) {
      req.session.user.smartsheetConnected = true;
    }

    authLogger(req, 'smartsheet_callback', true, { userId: oauthState.userId });
    
    res.redirect(`${process.env.CLIENT_URL || 'https://localhost:3000'}/dashboard?connected=smartsheet`);
  } catch (error: any) {
    authLogger(req, 'smartsheet_callback', false, error.message);
    res.redirect(`${process.env.CLIENT_URL || 'https://localhost:3000'}/auth/error?error=authentication_failed`);
  }
});

router.post('/smartsheet/disconnect', requireAuth, async (req: Request, res: Response) => {
  try {
    console.log('Smartsheet disconnect request:', {
      userId: req.session.user?.id,
      sessionExists: !!req.session,
      userExists: !!req.session.user
    });

    const user = await database.getUserById(req.session.user!.id);
    console.log('User found:', {
      userId: user?.id,
      hasSmartsheetTokens: !!user?.smartsheetTokens
    });
    
    if (user?.smartsheetTokens) {
      console.log('Revoking Smartsheet tokens...');
      await smartsheetAuthService.revokeTokens(user.smartsheetTokens);
      await database.updateUserTokens(user.id, 'smartsheet', null);
      console.log('Tokens revoked successfully');
    }

    if (req.session.user) {
      req.session.user.smartsheetConnected = false;
    }

    authLogger(req, 'smartsheet_disconnect', true, { userId: user?.id });
    
    res.json({ 
      success: true, 
      message: 'Smartsheet account disconnected successfully' 
    } as APIResponse);
  } catch (error: any) {
    console.error('Smartsheet disconnect error:', error);
    authLogger(req, 'smartsheet_disconnect', false, error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to disconnect Smartsheet account',
      details: error.message 
    } as APIResponse);
  }
});

router.post('/logout', (req: Request, res: Response) => {
  const userId = req.session?.user?.id;
  
  req.session.destroy((err) => {
    if (err) {
      authLogger(req, 'logout', false, err.message);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to logout' 
      } as APIResponse);
    }

    authLogger(req, 'logout', true, { userId });
    res.json({ 
      success: true, 
      message: 'Logged out successfully' 
    } as APIResponse);
  });
});

export default router;