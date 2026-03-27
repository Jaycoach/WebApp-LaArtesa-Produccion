import React from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { useAuthStore } from '@/store';

interface NavItem {
  name: string;
  path: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  {
    name: 'Dashboard',
    path: '/',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    name: 'Sincronizar SAP',
    path: '/sincronizar',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    ),
  },
  {
    name: 'Planificación',
    path: '/planificacion',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
  },
  {
    name: 'Reporte de Costos',
    path: '/reportes/costos',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    name: 'Configuración',
    path: '/configuracion',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

interface SidebarProps {
  onClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onClose }) => {
  const location = useLocation();
  const usuario = useAuthStore((state) => state.user);
  const puedeGestionarUsuarios = usuario?.rol === 'admin' || usuario?.rol === 'supervisor';

  const params = useParams<{ masaId?: string; nombreFase?: string }>();
  const masaActiva = params.masaId || sessionStorage.getItem('artesa_masa_activa') || null;

  React.useEffect(() => {
    if (params.masaId) {
      sessionStorage.setItem('artesa_masa_activa', params.masaId);
    }
  }, [params.masaId]);

  const handleNavClick = () => {
    if (onClose) onClose();
  };

  const getFaseLink = (key: string, defaultPath: string): string => {
    if (!masaActiva) return defaultPath;
    const rutas: Record<string, string> = {
      pesaje:       `/pesaje/${masaActiva}`,
      amasado:      `/amasado/${masaActiva}`,
      division:     `/division/${masaActiva}`,
      formado:      `/formado/${masaActiva}`,
      fermentacion: `/fermentacion/${masaActiva}`,
      horneado:     `/horneado/${masaActiva}`,
      empaque:      `/empaque`,
    };
    return rutas[key] ?? defaultPath;
  };

  return (
    <aside className="w-64 border-r border-gray-200 min-h-screen flex flex-col" style={{ backgroundColor: '#F5F0E4' }}>
      {/* Botón cerrar (solo visible en móvil) */}
      <div className="lg:hidden flex justify-end p-3 pt-4">
        <button
          onClick={onClose}
          className="p-2 rounded-md text-gray-500 hover:bg-gray-100"
          aria-label="Cerrar menú"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <nav className="mt-8 px-4">
        <ul className="space-y-2">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path ||
                           (item.path !== '/' && location.pathname.startsWith(item.path));

            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  onClick={handleNavClick}
                  className={clsx(
                    'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors',
                    isActive
                      ? 'bg-primary-50 text-primary-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-50'
                  )}
                >
                  <span className={isActive ? 'text-primary-600' : 'text-gray-500'}>
                    {item.icon}
                  </span>
                  <span>{item.name}</span>
                </Link>
              </li>
            );
          })}
          {puedeGestionarUsuarios && (
            <li>
              <Link
                to="/configuracion/usuarios"
                onClick={handleNavClick}
                className={clsx(
                  'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors',
                  location.pathname === '/configuracion/usuarios'
                    ? 'bg-primary-50 text-primary-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                )}
              >
                <span className={location.pathname === '/configuracion/usuarios' ? 'text-primary-600' : 'text-gray-500'}>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                </span>
                <span>Usuarios</span>
              </Link>
            </li>
          )}
        </ul>
      </nav>

      {/* Fases de producción */}
      <div className="mt-8 px-4">
        <h3 className="px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Fases de Producción
        </h3>
        <ul className="mt-4 space-y-1">
          {[
            { key: 'pesaje',       label: 'Pesaje',       color: 'bg-blue-500',   path: '/fase/pesaje'       },
            { key: 'amasado',      label: 'Amasado',      color: 'bg-purple-500', path: '/fase/amasado'      },
            { key: 'division',     label: 'División',     color: 'bg-yellow-500', path: '/fase/division'     },
            { key: 'formado',      label: 'Formado',      color: 'bg-green-500',  path: '/fase/formado'      },
            { key: 'fermentacion', label: 'Fermentación', color: 'bg-orange-500', path: '/fase/fermentacion' },
            { key: 'horneado',     label: 'Horneado',     color: 'bg-red-500',    path: '/fase/horneado'     },
            { key: 'empaque',      label: 'Empaque',      color: 'bg-amber-500',  path: '/empaque'           },
          ].map(({ key, label, color, path }) => {
            const resolvedPath = getFaseLink(key, path);
            const isActive = location.pathname.startsWith(path) ||
              (masaActiva !== null && location.pathname === resolvedPath);
            return (
              <li key={key}>
                <Link
                  to={resolvedPath}
                  onClick={handleNavClick}
                  className={clsx(
                    'flex items-center gap-3 px-4 py-2 text-sm rounded-lg transition-colors',
                    isActive
                      ? 'bg-primary-50 text-primary-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  )}
                >
                  <span className={`w-2 h-2 rounded-full ${color} shrink-0`} />
                  <span className="flex-1">{label}</span>
                  {masaActiva && key !== 'empaque' && (
                    <span className="text-xs text-gray-400 font-mono">#{masaActiva}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
};

export default Sidebar;
