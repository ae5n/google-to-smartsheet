import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  HomeIcon,
  ArrowRightOnRectangleIcon,
  ClockIcon,
  Cog6ToothIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: HomeIcon },
    { name: 'New Transfer', href: '/transfer', icon: ArrowRightOnRectangleIcon },
    { name: 'History', href: '/history', icon: ClockIcon },
    { name: 'Settings', href: '/settings', icon: Cog6ToothIcon },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-gray-100">
        {/* Header */}
        <div className="flex h-20 items-center justify-center">
          <div className="flex items-center space-x-3">
            <div className="bg-gradient-to-r from-green-500 to-blue-500 p-2 rounded-lg">
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">
                Google → Smartsheet
              </h1>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="px-6 mt-8">
          <ul className="space-y-1">
            {navigation.map((item) => {
              const isActive = location.pathname === item.href ||
                (item.href === '/transfer' && location.pathname.startsWith('/transfer'));
              
              return (
                <li key={item.name}>
                  <Link
                    to={item.href}
                    className={clsx(
                      'group flex items-center px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200',
                      isActive
                        ? 'bg-gradient-to-r from-blue-50 to-purple-50 text-blue-700 shadow-sm'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    )}
                  >
                    <item.icon
                      className={clsx(
                        'mr-3 h-5 w-5',
                        isActive ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'
                      )}
                    />
                    {item.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User info */}
        <div className="absolute bottom-0 left-0 right-0 p-6 border-t border-gray-100">
          <div className="flex items-center mb-4">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center">
                <span className="text-white font-semibold text-sm">
                  {user?.name?.charAt(0)?.toUpperCase()}
                </span>
              </div>
            </div>
            <div className="ml-3 flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {user?.name}
              </p>
              <p className="text-xs text-gray-500 truncate">
                {user?.email}
              </p>
            </div>
            <button
              onClick={logout}
              className="ml-3 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="Logout"
            >
              <ArrowRightOnRectangleIcon className="h-4 w-4" />
            </button>
          </div>

          {/* Connection status */}
          <div className="flex space-x-2">
            <div className={clsx(
              'flex items-center px-3 py-1.5 text-xs rounded-full border',
              user?.googleConnected
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'bg-gray-50 text-gray-500 border-gray-200'
            )}>
              <div className={clsx(
                'w-2 h-2 rounded-full mr-2',
                user?.googleConnected ? 'bg-green-500' : 'bg-gray-400'
              )} />
              Google
            </div>
            <div className={clsx(
              'flex items-center px-3 py-1.5 text-xs rounded-full border',
              user?.smartsheetConnected
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-gray-50 text-gray-500 border-gray-200'
            )}>
              <div className={clsx(
                'w-2 h-2 rounded-full mr-2',
                user?.smartsheetConnected ? 'bg-blue-500' : 'bg-gray-400'
              )} />
              Smartsheet
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="pl-72">
        <main className="py-8">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export default Layout;