import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

function AuthErrorPage() {
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');

  const getErrorMessage = (errorCode: string | null) => {
    switch (errorCode) {
      case 'access_denied':
        return 'You denied access to your account. Authentication is required to use this application.';
      case 'invalid_request':
        return 'There was an error with the authentication request. Please try again.';
      case 'authentication_failed':
        return 'Authentication failed. Please try logging in again.';
      default:
        return 'An unexpected error occurred during authentication.';
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <ExclamationTriangleIcon className="mx-auto h-12 w-12 text-red-500" />
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Authentication Error
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            {getErrorMessage(error)}
          </p>
        </div>
        
        <div className="mt-8 space-y-6">
          <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
            <div className="space-y-6">
              <div className="text-center">
                <Link
                  to="/login"
                  className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  Try Again
                </Link>
              </div>
              
              <div className="text-center">
                <Link
                  to="/login"
                  className="text-primary-600 hover:text-primary-500 text-sm font-medium"
                >
                  ← Back to Login
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AuthErrorPage;