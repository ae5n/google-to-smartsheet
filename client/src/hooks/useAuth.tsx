import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from '../types';
import { authAPI } from '../services/api';
import toast from 'react-hot-toast';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  connectGoogle: () => Promise<void>;
  connectSmartsheet: () => Promise<void>;
  disconnectGoogle: () => Promise<void>;
  disconnectSmartsheet: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = async () => {
    try {
      const response = await authAPI.getUser();
      setUser(response.data.data || null);
    } catch (error) {
      setUser(null);
    }
  };

  const login = async () => {
    try {
      const response = await authAPI.initiateGoogleAuth();
      if (response.data.success && response.data.data?.authUrl) {
        window.location.href = response.data.data.authUrl;
      } else {
        throw new Error('Failed to get authentication URL');
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to initiate login');
    }
  };

  const logout = async () => {
    try {
      await authAPI.logout();
      setUser(null);
      toast.success('Logged out successfully');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to logout');
    }
  };

  const connectGoogle = async () => {
    try {
      const response = await authAPI.initiateGoogleAuth();
      if (response.data.success && response.data.data?.authUrl) {
        window.location.href = response.data.data.authUrl;
      } else {
        throw new Error('Failed to get authentication URL');
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to connect Google account');
    }
  };

  const connectSmartsheet = async () => {
    try {
      const response = await authAPI.initiateSmartsheetAuth();
      if (response.data.success && response.data.data?.authUrl) {
        window.location.href = response.data.data.authUrl;
      } else {
        throw new Error('Failed to get authentication URL');
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to connect Smartsheet account');
    }
  };

  const disconnectGoogle = async () => {
    try {
      await authAPI.disconnectGoogle();
      await refreshUser();
      toast.success('Google account disconnected');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to disconnect Google account');
    }
  };

  const disconnectSmartsheet = async () => {
    try {
      await authAPI.disconnectSmartsheet();
      await refreshUser();
      toast.success('Smartsheet account disconnected');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to disconnect Smartsheet account');
    }
  };

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, []);

  // Check for auth callback success
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const connected = urlParams.get('connected');
    
    if (connected === 'smartsheet') {
      toast.success('Smartsheet account connected successfully');
      refreshUser();
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    // If we're on dashboard page, refresh user to ensure login state is current
    if (window.location.pathname === '/dashboard') {
      refreshUser();
    }
  }, []);

  const value: AuthContextType = {
    user,
    loading,
    login,
    logout,
    refreshUser,
    connectGoogle,
    connectSmartsheet,
    disconnectGoogle,
    disconnectSmartsheet,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}