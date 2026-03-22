import React, { useState, useEffect } from 'react';
import { Button, Alert, Card } from '@/components/common';
import { useAuthStore } from '@/store';
import { apiService } from '@/services/api';
import { API_CONFIG } from '@/config/api.config';

interface Usuario {
  id: number;
  username: string;
  email: string;
  nombre_completo: string;
  rol: string;
  activo: boolean;
  email_verificado: boolean;
  fecha_creacion: string;
}

interface CrearUsuarioForm {
  username: string;
  email: string;
  password: string;
  nombre_completo: string;
  rol: string;
}

const ROLES_DISPONIBLES = ['OPERARIO', 'SUPERVISOR', 'CALIDAD', 'AUDITOR', 'ADMIN'];

export const GestionUsuarios: React.FC = () => {
  const usuario = useAuthStore((state) => state.user);
  const esAdmin = usuario?.rol === 'admin';

  const [pendientes, setPendientes] = useState<Usuario[]>([]);
  const [todos, setTodos] = useState<Usuario[]>([]);
  const [tab, setTab] = useState<'pendientes' | 'todos' | 'crear'>('pendientes');
  const [isLoading, setIsLoading] = useState(false);
  const [accionando, setAccionando] = useState<number | null>(null);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const [form, setForm] = useState<CrearUsuarioForm>({
    username: '', email: '', password: '', nombre_completo: '', rol: 'OPERARIO',
  });
  const [creando, setCreando] = useState(false);

  const limpiarMensajes = () => {
    setTimeout(() => { setSuccess(''); setError(''); }, 4000);
  };

  const cargarPendientes = async () => {
    try {
      const res = await apiService.get<Usuario[]>(API_CONFIG.ENDPOINTS.USERS.PENDING);
      if (res.success && res.data) setPendientes(res.data);
    } catch {}
  };

  const cargarTodos = async () => {
    try {
      const res = await apiService.get<{ users: Usuario[] }>(API_CONFIG.ENDPOINTS.USERS.LIST);
      if (res.success && res.data) setTodos(res.data.users || []);
    } catch {}
  };

  useEffect(() => {
    setIsLoading(true);
    Promise.all([cargarPendientes(), cargarTodos()]).finally(() => setIsLoading(false));
  }, []);

  const aprobar = async (id: number) => {
    setAccionando(id);
    try {
      const res = await apiService.post(API_CONFIG.ENDPOINTS.USERS.APPROVE(id), {});
      if (res.success) {
        setSuccess('Usuario aprobado y activado correctamente.');
        await Promise.all([cargarPendientes(), cargarTodos()]);
      } else {
        setError(res.message || 'Error al aprobar usuario');
      }
    } catch (e: any) {
      setError(e.message || 'Error al aprobar usuario');
    } finally {
      setAccionando(null);
      limpiarMensajes();
    }
  };

  const desactivar = async (id: number) => {
    setAccionando(id);
    try {
      const res = await apiService.post(API_CONFIG.ENDPOINTS.USERS.DEACTIVATE(id), {});
      if (res.success) {
        setSuccess('Usuario desactivado.');
        await cargarTodos();
      } else {
        setError(res.message || 'Error al desactivar');
      }
    } catch (e: any) {
      setError(e.message || 'Error al desactivar');
    } finally {
      setAccionando(null);
      limpiarMensajes();
    }
  };

  const crearUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreando(true);
    setError('');
    try {
      const res = await apiService.post(API_CONFIG.ENDPOINTS.USERS.CREATE, form);
      if (res.success) {
        setSuccess(`Usuario "${form.username}" creado. Se enviará email de verificación.`);
        setForm({ username: '', email: '', password: '', nombre_completo: '', rol: 'OPERARIO' });
        setTab('pendientes');
        await cargarPendientes();
      } else {
        setError(res.message || 'Error al crear usuario');
      }
    } catch (e: any) {
      setError(e.message || 'Error al crear usuario');
    } finally {
      setCreando(false);
      limpiarMensajes();
    }
  };

  const rolBadge = (rol: string) => {
    const colores: Record<string, string> = {
      ADMIN: 'bg-red-100 text-red-800',
      SUPERVISOR: 'bg-blue-100 text-blue-800',
      CALIDAD: 'bg-purple-100 text-purple-800',
      AUDITOR: 'bg-yellow-100 text-yellow-800',
      OPERARIO: 'bg-gray-100 text-gray-700',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colores[rol] || 'bg-gray-100 text-gray-700'}`}>
        {rol}
      </span>
    );
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Gestión de Usuarios</h1>
        <p className="text-sm text-gray-500 mt-1">
          Administra los accesos al sistema de producción.
        </p>
      </div>

      {success && <Alert variant="success">{success}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-6">
          <button
            onClick={() => setTab('pendientes')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              tab === 'pendientes'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Pendientes de aprobación
            {pendientes.length > 0 && (
              <span className="ml-2 bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                {pendientes.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('todos')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              tab === 'todos'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Todos los usuarios
          </button>
          {esAdmin && (
            <button
              onClick={() => setTab('crear')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                tab === 'crear'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              + Crear usuario
            </button>
          )}
        </nav>
      </div>

      {/* Tab: Pendientes */}
      {tab === 'pendientes' && (
        <Card>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            </div>
          ) : pendientes.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              <svg className="mx-auto h-10 w-10 text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="font-medium">Sin usuarios pendientes</p>
              <p className="text-sm">Todos los usuarios están activos.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {pendientes.map((u) => (
                <div key={u.id} className="flex items-center justify-between py-4 px-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{u.nombre_completo}</span>
                      {rolBadge(u.rol)}
                      {!u.email_verificado && (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-700">
                          Sin verificar email
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">@{u.username} · {u.email}</p>
                  </div>
                  <Button
                    variant="success"
                    size="sm"
                    isLoading={accionando === u.id}
                    onClick={() => aprobar(u.id)}
                    disabled={!u.email_verificado}
                  >
                    {u.email_verificado ? 'Aprobar acceso' : 'Esperando verificación'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Tab: Todos */}
      {tab === 'todos' && (
        <Card>
          <div className="divide-y divide-gray-100">
            {todos.map((u) => (
              <div key={u.id} className="flex items-center justify-between py-4 px-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{u.nombre_completo}</span>
                    {rolBadge(u.rol)}
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      u.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {u.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">@{u.username} · {u.email}</p>
                </div>
                {esAdmin && u.username !== 'admin' && (
                  <div className="flex gap-2">
                    {!u.activo ? (
                      <Button variant="success" size="sm" isLoading={accionando === u.id}
                        onClick={() => aprobar(u.id)}>
                        Activar
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" isLoading={accionando === u.id}
                        onClick={() => desactivar(u.id)}>
                        Desactivar
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Tab: Crear */}
      {tab === 'crear' && esAdmin && (
        <Card>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Nuevo usuario</h3>
          <p className="text-sm text-gray-500 mb-6">
            El usuario recibirá un email para verificar su cuenta.
            Después deberás aprobar su acceso desde la pestaña "Pendientes".
          </p>
          <form onSubmit={crearUsuario} className="space-y-4 max-w-lg">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre completo</label>
                <input
                  type="text" required value={form.nombre_completo}
                  onChange={(e) => setForm({ ...form, nombre_completo: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  placeholder="Juan Pérez"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Usuario</label>
                <input
                  type="text" required value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  placeholder="jperez"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Correo electrónico</label>
              <input
                type="email" required value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="jperez@laartesa.com"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña temporal</label>
                <input
                  type="password" required value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  placeholder="Mínimo 8 caracteres"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rol</label>
                <select
                  value={form.rol}
                  onChange={(e) => setForm({ ...form, rol: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                >
                  {ROLES_DISPONIBLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>
            <Button type="submit" variant="primary" isLoading={creando}>
              Crear usuario y enviar invitación
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
};

export default GestionUsuarios;
