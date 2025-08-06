import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { transferAPI } from '../services/api';
import { TransferJob } from '../types';
import {
  PlusIcon,
  ArrowRightIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import toast from 'react-hot-toast';

function DashboardPage() {
  const { user, connectGoogle, connectSmartsheet } = useAuth();
  const [recentJobs, setRecentJobs] = useState<TransferJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRecentJobs = async () => {
      try {
        const response = await transferAPI.getUserJobs(5);
        setRecentJobs(response.data.data || []);
      } catch (error: any) {
        console.error('Failed to fetch recent jobs:', error);
      } finally {
        setLoading(false);
      }
    };

    if (user?.googleConnected && user?.smartsheetConnected) {
      fetchRecentJobs();
    } else {
      setLoading(false);
    }
  }, [user]);

  const getStatusIcon = (status: TransferJob['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircleIcon className="h-5 w-5 text-green-500" />;
      case 'failed':
      case 'cancelled':
        return <XCircleIcon className="h-5 w-5 text-red-500" />;
      case 'running':
        return <div className="spinner" />;
      default:
        return <ClockIcon className="h-5 w-5 text-yellow-500" />;
    }
  };

  const getStatusText = (status: TransferJob['status']) => {
    switch (status) {
      case 'completed':
        return 'Completed';
      case 'failed':
        return 'Failed';
      case 'cancelled':
        return 'Cancelled';
      case 'running':
        return 'Running';
      default:
        return 'Pending';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!user?.googleConnected || !user?.smartsheetConnected) {
    return (
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">Welcome to Google Sheets Transfer</h1>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="text-center">
            <ExclamationTriangleIcon className="mx-auto h-12 w-12 text-yellow-500 mb-4" />
            <h2 className="text-lg font-medium text-gray-900 mb-2">
              Connect Your Accounts
            </h2>
            <p className="text-gray-600 mb-6">
              You need to connect both Google and Smartsheet accounts to start transferring data.
            </p>
            
            <div className="space-y-4">
              {!user?.googleConnected && (
                <button
                  onClick={connectGoogle}
                  className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Connect Google Account
                </button>
              )}
              
              {!user?.smartsheetConnected && (
                <button
                  onClick={connectSmartsheet}
                  className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                    <rect width="24" height="24" rx="3" fill="#1f2937"/>
                    <text x="12" y="16" textAnchor="middle" fontSize="8" fill="white">SS</text>
                  </svg>
                  Connect Smartsheet Account
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Hero Section */}
      <div className="text-center py-12 mb-12">
        <div className="mb-8">
          <div className="flex justify-center items-center mb-6">
            <div className="bg-green-100 p-3 rounded-full mr-4">
              <svg className="w-8 h-8 text-green-600" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M7 7H17C18.1046 7 19 7.89543 19 9V15C19 16.1046 18.1046 17 17 17H7C5.89543 17 5 16.1046 5 15V9C5 7.89543 5.89543 7 7 7Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M8 11L12 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M8 13L16 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="flex items-center text-gray-400 text-2xl">
              <span>→</span>
            </div>
            <div className="bg-blue-100 p-3 rounded-full ml-4">
              <svg className="w-8 h-8 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
                <rect width="20" height="16" x="2" y="4" rx="2" ry="2" stroke="currentColor" strokeWidth="2" fill="none"/>
                <rect width="4" height="2" x="4" y="7" fill="currentColor"/>
                <rect width="4" height="2" x="10" y="7" fill="currentColor"/>
                <rect width="4" height="2" x="16" y="7" fill="currentColor"/>
                <rect width="4" height="2" x="4" y="11" fill="currentColor"/>
                <rect width="4" height="2" x="10" y="11" fill="currentColor"/>
                <rect width="4" height="2" x="16" y="11" fill="currentColor"/>
                <rect width="4" height="2" x="4" y="15" fill="currentColor"/>
                <rect width="4" height="2" x="10" y="15" fill="currentColor"/>
                <rect width="4" height="2" x="16" y="15" fill="currentColor"/>
              </svg>
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-8">
            Transfer Google Sheet to Smartsheet
          </h1>
        </div>
        
        <Link
          to="/transfer"
          className="inline-flex items-center px-8 py-4 border border-transparent rounded-lg shadow-lg text-lg font-semibold text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transform hover:scale-105 transition-all duration-200"
        >
          <PlusIcon className="-ml-1 mr-3 h-6 w-6" />
          Start New Transfer
        </Link>
      </div>


      {/* Recent transfers */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg leading-6 font-medium text-gray-900">
              Recent Transfers
            </h3>
            <Link 
              to="/history"
              className="text-sm font-medium text-primary-600 hover:text-primary-500"
            >
              View all <ArrowRightIcon className="inline h-4 w-4 ml-1" />
            </Link>
          </div>
          
          {loading ? (
            <div className="text-center py-4">
              <div className="spinner mx-auto"></div>
            </div>
          ) : recentJobs.length === 0 ? (
            <div className="text-center py-8">
              <ClockIcon className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No transfers yet</h3>
              <p className="mt-1 text-sm text-gray-500">
                Get started by creating your first transfer.
              </p>
              <div className="mt-6">
                <Link
                  to="/transfer"
                  className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
                  New Transfer
                </Link>
              </div>
            </div>
          ) : (
            <div className="flow-root">
              <ul className="-my-5 divide-y divide-gray-200">
                {recentJobs.map((job) => (
                  <li key={job.id} className="py-4">
                    <div className="flex items-center space-x-4">
                      <div className="flex-shrink-0">
                        {getStatusIcon(job.status)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          Transfer to Sheet #{job.smartsheetId}
                        </p>
                        <p className="text-sm text-gray-500">
                          {formatDate(job.createdAt)} • {getStatusText(job.status)}
                          {job.progress.totalRows > 0 && (
                            <> • {job.progress.processedRows.toLocaleString()} of {job.progress.totalRows.toLocaleString()} rows</>
                          )}
                        </p>
                      </div>
                      <div className="flex-shrink-0">
                        <Link
                          to={`/transfer/${job.id}`}
                          className="text-primary-600 hover:text-primary-500 text-sm font-medium"
                        >
                          View
                        </Link>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default DashboardPage;