import React from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@/store';

interface HeaderProps {
  onMenuClick?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onMenuClick }) => {
  const { user, logout } = useAuthStore();

  return (
    <header className="shadow-sm border-b border-gray-200 sticky top-0 z-10" style={{ backgroundColor: '#F5F0E4' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Hamburger (solo móvil) + Logo */}
          <div className="flex items-center gap-3">
            <button
              onClick={onMenuClick}
              className="lg:hidden p-2 rounded-md text-gray-600 hover:bg-gray-100 focus:outline-none"
              aria-label="Abrir menú"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <Link to="/" className="flex items-center">
              <img src="/Orbit_LogoHorizontal.jpeg" alt="Orbit Producción Artesa" className="h-10 w-auto" />
              <span className="ml-2 text-sm text-gray-500 hidden sm:inline">Control de Producción</span>
            </Link>
          </div>

          {/* User menu */}
          <div className="flex items-center gap-2 lg:gap-4">
            {user && (
              <>
                <span className="text-sm text-gray-700 hidden md:inline">
                  {user.nombre} <span className="text-gray-500">({user.rol})</span>
                </span>
                <button
                  onClick={logout}
                  className="inline-flex items-center px-3 py-2 lg:px-4 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
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
