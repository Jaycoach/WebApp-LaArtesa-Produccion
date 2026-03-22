import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';

export const MainLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header onMenuClick={() => setSidebarOpen(true)} />
      <div className="flex">
        {/* Overlay móvil */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-20 bg-black bg-opacity-50 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        {/* Sidebar */}
        <div
          className={`
            fixed top-0 left-0 z-30 h-full transform transition-transform duration-300 ease-in-out
            lg:relative lg:translate-x-0 lg:z-auto lg:h-auto
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
        >
          <Sidebar onClose={() => setSidebarOpen(false)} />
        </div>
        <main className="flex-1 min-w-0 p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default MainLayout;
