import { useEffect } from 'react';
import { useAuthStore } from '@/store';
import { debeTratarseComoSesionReemplazada } from '@/utils/sessionReplacedGuard';

/**
 * Detecta cuando OTRA pestaña del mismo navegador sobrescribe auth_token en
 * localStorage con el token de un usuario distinto (ej. alguien loguea al
 * Usuario B en la Pestaña 2 mientras la Pestaña 1 sigue abierta como
 * Usuario A). localStorage es compartido entre pestañas del mismo origen a
 * propósito (permite "mismo usuario, varias pestañas") — lo que hace falta
 * no es dejar de compartirlo, sino avisar explícitamente cuando el usuario
 * cambió, en vez de que la pestaña vieja siga operando en silencio como si
 * fuera la sesión nueva.
 *
 * El evento `storage` del navegador SOLO se dispara en las pestañas que NO
 * originaron el cambio — por eso este listener no interfiere para nada con
 * el login/logout normal de una sola pestaña.
 *
 * La decisión de "¿esto cuenta como sesión reemplazada?" vive en
 * utils/sessionReplacedGuard.ts (función pura, sin DOM) — este hook solo
 * conecta esa decisión con el evento real del navegador.
 */
export const useSessionReplacedGuard = () => {
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      const { user, isAuthenticated, logout } = useAuthStore.getState();

      const reemplazada = debeTratarseComoSesionReemplazada({
        key: e.key,
        oldValue: e.oldValue,
        newValue: e.newValue,
        isAuthenticated,
        currentUserId: user?.id,
      });

      if (!reemplazada) return;

      logout();
      window.location.href = '/login?session_replaced=1';
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);
};
