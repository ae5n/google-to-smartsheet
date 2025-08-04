import React from 'react';
import { useAuth } from '../hooks/useAuth';

function SettingsPage() {
  const { user, connectGoogle, connectSmartsheet, disconnectGoogle, disconnectSmartsheet } = useAuth();

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">Settings</h1>
      
      <div className="space-y-6">
        {/* Account Connections */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Account Connections</h2>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
              <div className="flex items-center">
                <svg className="w-8 h-8 mr-3" viewBox="0 0 24 24">
                  <path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#fbbc04" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                <div>
                  <p className="font-medium text-gray-900">Google Account</p>
                  <p className="text-sm text-gray-500">Access to Google Sheets and Drive</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  user?.googleConnected 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  {user?.googleConnected ? 'Connected' : 'Not Connected'}
                </span>
                {user?.googleConnected ? (
                  <button
                    onClick={disconnectGoogle}
                    className="text-red-600 hover:text-red-500 text-sm font-medium"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={connectGoogle}
                    className="text-primary-600 hover:text-primary-500 text-sm font-medium"
                  >
                    Connect
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
              <div className="flex items-center">
                <div className="w-8 h-8 mr-3 bg-gray-800 rounded flex items-center justify-center">
                  <span className="text-white text-xs font-bold">SS</span>
                </div>
                <div>
                  <p className="font-medium text-gray-900">Smartsheet Account</p>
                  <p className="text-sm text-gray-500">Access to Smartsheet sheets</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  user?.smartsheetConnected 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  {user?.smartsheetConnected ? 'Connected' : 'Not Connected'}
                </span>
                {user?.smartsheetConnected ? (
                  <button
                    onClick={disconnectSmartsheet}
                    className="text-red-600 hover:text-red-500 text-sm font-medium"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={connectSmartsheet}
                    className="text-primary-600 hover:text-primary-500 text-sm font-medium"
                  >
                    Connect
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* User Profile */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Profile Information</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Name</label>
              <p className="mt-1 text-sm text-gray-900">{user?.name}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <p className="mt-1 text-sm text-gray-900">{user?.email}</p>
            </div>
          </div>
        </div>

        {/* Security */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Security</h2>
          
          <div className="space-y-4">
            <div className="flex items-start">
              <svg className="h-5 w-5 text-green-500 mt-1 mr-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 1L5 6v9l5 4 5-4V6l-5-5zM8.5 13L5 9.5l1.5-1.5L8.5 10l5-5L15 6.5 8.5 13z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="text-sm font-medium text-gray-900">OAuth 2.0 with PKCE</p>
                <p className="text-sm text-gray-500">Secure authentication without storing passwords</p>
              </div>
            </div>
            <div className="flex items-start">
              <svg className="h-5 w-5 text-green-500 mt-1 mr-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="text-sm font-medium text-gray-900">Encrypted Token Storage</p>
                <p className="text-sm text-gray-500">All access tokens are encrypted at rest</p>
              </div>
            </div>
            <div className="flex items-start">
              <svg className="h-5 w-5 text-green-500 mt-1 mr-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="text-sm font-medium text-gray-900">HTTPS Only</p>
                <p className="text-sm text-gray-500">All communications are encrypted in transit</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;