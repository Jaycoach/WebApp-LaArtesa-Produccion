import React, { useState, useEffect } from 'react';
import { Button, Alert, Card } from '@/components/common';
import { useAuthStore } from '@/store';
import { apiService } from '@/services/api';
import { authService } from '@/services/authService';
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
  intentos_fallidos?: number;
  bloqueado_hasta?: string | null;
}

// Jerarquía de roles — debe reflejar backend/src/utils/roleHierarchy.js.
// Esta es una capa adicional de UX (ocultar acciones que el backend de
// todas formas va a rechazar); la protección real vive en el backend.
const RANGO_ROL: Record<string, number> = {
  ADMIN: 3,
  SUPERVISOR: 2,
  OPERARIO: 1,
  CALIDAD: 1,
  AUDITOR: 1,
};

const estaBloqueado = (u: Usuario) =>
  !!u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date();

interface CrearUsuarioForm {
  username: string;
  email: string;
  password: string;
  nombre_completo: string;
  rol: string;
}

const ROLES_DISPONIBLES: { label: string; value: string }[] = [
  { label: 'Operario', value: 'operario' },
  { label: 'Calidad', value: 'calidad' },
  { label: 'Supervisor', value: 'supervisor' },
  { label: 'Admin', value: 'admin' },
];

export const GestionUsuarios: React.FC = () => {
  const usuario = useAuthStore((state) => state.user);
  const actualizarUsuarioStore = useAuthStore((state) => state.updateUser);
  // esAdminOSupervisor: acceso a la sección de gestión de usuarios en general
  // (crear, ver, aprobar). NO implica poder actuar sobre cualquier usuario —
  // eso lo decide puedeModificar() fila por fila, y lo hace cumplir el
  // backend de verdad (ver roleHierarchy.js). Antes esta variable se llamaba
  // "esAdmin" pero incluía a supervisor — nombre corregido para no confundir
  // "tiene acceso a la sección" con "es admin real".
  const esAdminOSupervisor = ['admin', 'supervisor', 'ADMIN', 'SUPERVISOR'].includes(usuario?.rol || '');
  const esAdminReal = (usuario?.rol || '').toUpperCase() === 'ADMIN';
  const miRango = RANGO_ROL[(usuario?.rol || '').toUpperCase()] || 0;

  // Capa adicional de UX — la protección real es del backend. Un admin
  // puede modificar a cualquiera; el resto solo a rango estrictamente
  // inferior al propio.
  const puedeModificar = (target: Usuario) =>
    esAdminReal || miRango > (RANGO_ROL[(target.rol || '').toUpperCase()] || 0);

  // Solo un admin real puede asignar el rol admin (ver roleHierarchy.js).
  const rolesParaSelect = esAdminReal
    ? ROLES_DISPONIBLES
    : ROLES_DISPONIBLES.filter((r) => r.value !== 'admin');

  const [desbloqueando, setDesbloqueando] = useState<number | null>(null);

  const [pendientes, setPendientes] = useState<Usuario[]>([]);
  const [todos, setTodos] = useState<Usuario[]>([]);
  const [tab, setTab] = useState<'pendientes' | 'todos' | 'crear' | 'password' | 'perfil'>('pendientes');
  const [isLoading, setIsLoading] = useState(false);
  const [accionando, setAccionando] = useState<number | null>(null);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const [form, setForm] = useState<CrearUsuarioForm>({
    username: '', email: '', password: '', nombre_completo: '', rol: 'operario',
  });
  const [creando, setCreando] = useState(false);

  const [editando, setEditando] = useState<Usuario | null>(null);
  const [rolEditando, setRolEditando] = useState('');
  const [nombreEditando, setNombreEditando] = useState('');
  const [emailEditando, setEmailEditando] = useState('');
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);

  // Cambio de contraseña
  const [pwActual, setPwActual] = useState('');
  const [pwNueva, setPwNueva] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [cambiandoPw, setCambiandoPw] = useState(false);

  // Mi perfil (nombre/email propios)
  const [nombreCompleto, setNombreCompleto] = useState(usuario?.nombre || '');
  const [emailPerfil, setEmailPerfil] = useState(usuario?.email || '');
  const [guardandoPerfil, setGuardandoPerfil] = useState(false);

  const abrirEdicion = (u: Usuario) => {
    setEditando(u);
    setRolEditando(u.rol.toLowerCase());
    setNombreEditando(u.nombre_completo);
    setEmailEditando(u.email);
  };

  const cerrarEdicion = () => {
    setEditando(null);
    setRolEditando('');
    setNombreEditando('');
    setEmailEditando('');
    setError('');
  };

  const guardarEdicion = async () => {
    if (!editando) return;
    setGuardandoEdicion(true);
    setError('');
    try {
      const res = await apiService.put(API_CONFIG.ENDPOINTS.USERS.UPDATE(editando.id), {
        nombre_completo: nombreEditando.trim(),
        email: emailEditando.trim(),
        rol: rolEditando.toLowerCase(),
      });
      if (res.success) {
        setSuccess(`Usuario "${nombreEditando.trim()}" actualizado.`);
        cerrarEdicion();
        await cargarTodos();
      } else {
        setError(res.message || 'Error al actualizar usuario');
      }
    } catch (e: any) {
      setError(e.message || 'Error al actualizar usuario');
    } finally {
      setGuardandoEdicion(false);
      limpiarMensajes();
    }
  };

  const cambiarPassword = async () => {
    setError('');
    if (!pwActual || !pwNueva || !pwConfirm) {
      setError('Todos los campos son requeridos.');
      return;
    }
    if (pwNueva.length < 8) {
      setError('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (pwNueva !== pwConfirm) {
      setError('Las contraseñas nuevas no coinciden.');
      return;
    }
    setCambiandoPw(true);
    try {
      await authService.changePassword(pwActual, pwNueva);
      setSuccess('Contraseña actualizada correctamente.');
      setPwActual(''); setPwNueva(''); setPwConfirm('');
      limpiarMensajes();
    } catch (e: any) {
      setError(e.message || 'Error al cambiar la contraseña.');
    } finally {
      setCambiandoPw(false);
    }
  };

  const guardarPerfil = async () => {
    setError('');
    if (!nombreCompleto.trim()) {
      setError('El nombre completo es requerido.');
      return;
    }
    setGuardandoPerfil(true);
    try {
      const actualizado = await authService.updateProfile({
        nombre_completo: nombreCompleto.trim(),
        email: emailPerfil.trim(),
      });
      actualizarUsuarioStore(actualizado);
      setSuccess('Perfil actualizado correctamente.');
      limpiarMensajes();
    } catch (e: any) {
      setError(e.message || 'Error al actualizar el perfil.');
    } finally {
      setGuardandoPerfil(false);
    }
  };

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

  const desbloquear = async (id: number) => {
    setDesbloqueando(id);
    try {
      const res = await apiService.post(API_CONFIG.ENDPOINTS.USERS.UNLOCK(id), {});
      if (res.success) {
        setSuccess('Usuario desbloqueado.');
        await cargarTodos();
      } else {
        setError(res.message || 'Error al desbloquear');
      }
    } catch (e: any) {
      setError(e.message || 'Error al desbloquear');
    } finally {
      setDesbloqueando(null);
      limpiarMensajes();
    }
  };

  const crearUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreando(true);
    setError('');
    try {
      const res = await apiService.post(API_CONFIG.ENDPOINTS.USERS.CREATE, {
        ...form,
        rol: form.rol.toLowerCase(),
      });
      if (res.success) {
        setSuccess(`Usuario "${form.username}" creado exitosamente.`);
        setForm({ username: '', email: '', password: '', nombre_completo: '', rol: 'operario' });
        setTab('todos');
        await cargarTodos();
      } else {
        if (res.errors && Array.isArray(res.errors) && res.errors.length > 0) {
          const detalles = res.errors.map((err: any) => `${err.field}: ${err.message}`).join(' | ');
          setError(detalles);
        } else {
          setError(res.message || 'Error al crear usuario');
        }
      }
    } catch (e: any) {
      setError(e.message || 'Error al crear usuario');
    } finally {
      setCreando(false);
      limpiarMensajes();
    }
  };

  const rolBadge = (rol: string) => {
    const rolUp = (rol || '').toUpperCase();
    const colores: Record<string, string> = {
      ADMIN: 'bg-red-100 text-red-800',
      SUPERVISOR: 'bg-blue-100 text-blue-800',
      CALIDAD: 'bg-purple-100 text-purple-800',
      OPERARIO: 'bg-gray-100 text-gray-700',
    };
    const labels: Record<string, string> = {
      ADMIN: 'Admin',
      SUPERVISOR: 'Supervisor',
      CALIDAD: 'Calidad',
      OPERARIO: 'Operario',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colores[rolUp] || 'bg-gray-100 text-gray-700'}`}>
        {labels[rolUp] || rol}
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
          <button
            onClick={() => setTab('perfil')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              tab === 'perfil'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Mi perfil
          </button>
          <button
            onClick={() => setTab('password')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              tab === 'password'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Mi contraseña
          </button>
          {esAdminOSupervisor && (
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
                    {estaBloqueado(u) && (
                      <span
                        className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700"
                        title={`Bloqueado hasta ${new Date(u.bloqueado_hasta as string).toLocaleString()}`}
                      >
                        Bloqueado{u.intentos_fallidos ? ` (${u.intentos_fallidos} intentos)` : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500">@{u.username} · {u.email}</p>
                </div>
                {esAdminOSupervisor && puedeModificar(u) && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm"
                      onClick={() => abrirEdicion(u)}>
                      Editar usuario
                    </Button>
                    {estaBloqueado(u) && (
                      <Button variant="secondary" size="sm" isLoading={desbloqueando === u.id}
                        onClick={() => desbloquear(u.id)}>
                        Desbloquear
                      </Button>
                    )}
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
      {tab === 'crear' && esAdminOSupervisor && (
        <Card>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Nuevo usuario</h3>
          <p className="text-sm text-gray-500 mb-6">
            El usuario queda pendiente de aprobación (visible en la pestaña "Pendientes de aprobación")
            hasta que verifique su correo y un admin o supervisor lo apruebe. Comparte la contraseña
            temporal con el operario para que pueda ingresar.
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
                  placeholder="Ej: Artesa2024@"
                />
                <p className="text-xs text-gray-400 mt-1">Mayúscula, minúscula, número y símbolo (@$!%*?&#)</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rol</label>
                <select
                  value={form.rol}
                  onChange={(e) => setForm({ ...form, rol: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                >
                  {rolesParaSelect.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <Button type="submit" variant="primary" isLoading={creando}>
              Crear usuario
            </Button>
          </form>
        </Card>
      )}
      {/* Tab: Mi perfil */}
      {tab === 'perfil' && (
        <Card>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Mi perfil</h3>
          <p className="text-sm text-gray-500 mb-6">
            Actualiza tu nombre completo y correo electrónico.
          </p>
          <div className="space-y-4 max-w-sm">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre completo</label>
              <input
                type="text"
                value={nombreCompleto}
                onChange={e => setNombreCompleto(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="Tu nombre completo"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Correo electrónico</label>
              <input
                type="email"
                value={emailPerfil}
                onChange={e => setEmailPerfil(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="tu@correo.com"
              />
            </div>
            <Button
              variant="primary"
              isLoading={guardandoPerfil}
              onClick={guardarPerfil}
            >
              Guardar perfil
            </Button>
          </div>
        </Card>
      )}

      {/* Tab: Mi contraseña */}
      {tab === 'password' && (
        <Card>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Cambiar contraseña</h3>
          <p className="text-sm text-gray-500 mb-6">
            Actualiza tu contraseña de acceso al sistema.
          </p>
          <div className="space-y-4 max-w-sm">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña actual</label>
              <input
                type="password"
                value={pwActual}
                onChange={e => setPwActual(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="Tu contraseña actual"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nueva contraseña</label>
              <input
                type="password"
                value={pwNueva}
                onChange={e => setPwNueva(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="Mínimo 8 caracteres"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar nueva contraseña</label>
              <input
                type="password"
                value={pwConfirm}
                onChange={e => setPwConfirm(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="Repite la nueva contraseña"
              />
            </div>
            <Button
              variant="primary"
              isLoading={cambiandoPw}
              onClick={cambiarPassword}
            >
              Actualizar contraseña
            </Button>
          </div>
        </Card>
      )}

      {/* Modal edición de usuario */}
      {editando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-sm mx-4 p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Editar usuario</h3>
            <p className="text-sm text-gray-500 mb-5">
              @{editando.username}
            </p>

            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre completo</label>
            <input
              type="text"
              value={nombreEditando}
              onChange={(e) => setNombreEditando(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 mb-3"
            />

            <label className="block text-sm font-medium text-gray-700 mb-1">Correo electrónico</label>
            <input
              type="email"
              value={emailEditando}
              onChange={(e) => setEmailEditando(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 mb-3"
            />

            <label className="block text-sm font-medium text-gray-700 mb-1">Rol</label>
            <select
              value={rolEditando}
              onChange={(e) => setRolEditando(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 mb-2"
            >
              {rolesParaSelect.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>

            {rolEditando !== editando.rol.toLowerCase() && (
              <p className="text-xs text-amber-600 mb-4">
                Rol cambiará de <strong>{editando.rol}</strong> → <strong>{rolEditando}</strong>
              </p>
            )}

            {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

            <div className="flex gap-2 justify-end mt-4">
              <Button variant="outline" size="sm" onClick={cerrarEdicion} disabled={guardandoEdicion}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                size="sm"
                isLoading={guardandoEdicion}
                onClick={guardarEdicion}
                disabled={
                  !nombreEditando.trim() ||
                  (rolEditando === editando.rol.toLowerCase() &&
                    nombreEditando.trim() === editando.nombre_completo &&
                    emailEditando.trim() === editando.email)
                }
              >
                Guardar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GestionUsuarios;
