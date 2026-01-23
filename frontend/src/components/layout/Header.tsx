import React from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@/store';

export const Header: React.FC = () => {
  const { user, logout } = useAuthStore();

  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex items-center">
            <Link to="/" className="flex items-center">
              <span className="text-2xl font-bold text-primary-600">La Artesa</span>
              <span className="ml-2 text-sm text-gray-500">Control de Producción</span>
            </Link>
          </div>

          {/* User menu */}
          <div className="flex items-center gap-4">
            {user && (
              <>
                <span className="text-sm text-gray-700">
                  {user.nombre} <span className="text-gray-500">({user.rol})</span>
                </span>
                <button
                  onClick={logout}
                  className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  Cerrar Sesión
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
