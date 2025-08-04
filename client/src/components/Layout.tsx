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
      <div className="fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-lg">
        <div className="flex h-16 items-center justify-center border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-900">
            Google → Smartsheet
          </h1>
        </div>

        <nav className="mt-8 px-4">
          <ul className="space-y-2">
            {navigation.map((item) => {
              const isActive = location.pathname === item.href ||
                (item.href === '/transfer' && location.pathname.startsWith('/transfer'));
              
              return (
                <li key={item.name}>
                  <Link
                    to={item.href}
                    className={clsx(
                      'group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors',
                      isActive
                        ? 'bg-primary-50 text-primary-700 border-r-2 border-primary-500'
                        : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                    )}
                  >
                    <item.icon
                      className={clsx(
                        'mr-3 h-5 w-5',
                        isActive ? 'text-primary-500' : 'text-gray-400 group-hover:text-gray-500'
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
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <UserIcon className="h-8 w-8 text-gray-400" />
            </div>
            <div className="ml-3 flex-1">
              <p className="text-sm font-medium text-gray-900 truncate">
                {user?.name}
              </p>
              <p className="text-xs text-gray-500 truncate">
                {user?.email}
              </p>
            </div>
            <button
              onClick={logout}
              className="ml-3 p-1 text-gray-400 hover:text-gray-500"
              title="Logout"
            >
              <ArrowRightOnRectangleIcon className="h-5 w-5" />
            </button>
          </div>

          {/* Connection status */}
          <div className="mt-3 flex space-x-2">
            <div className={clsx(
              'flex items-center px-2 py-1 text-xs rounded-md',
              user?.googleConnected
                ? 'bg-success-50 text-success-700'
                : 'bg-gray-100 text-gray-500'
            )}>
              <div className={clsx(
                'w-2 h-2 rounded-full mr-1',
                user?.googleConnected ? 'bg-success-500' : 'bg-gray-400'
              )} />
              Google
            </div>
            <div className={clsx(
              'flex items-center px-2 py-1 text-xs rounded-md',
              user?.smartsheetConnected
                ? 'bg-success-50 text-success-700'
                : 'bg-gray-100 text-gray-500'
            )}>
              <div className={clsx(
                'w-2 h-2 rounded-full mr-1',
                user?.smartsheetConnected ? 'bg-success-500' : 'bg-gray-400'
              )} />
              Smartsheet
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="pl-64">
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