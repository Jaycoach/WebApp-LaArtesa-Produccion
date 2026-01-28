/**
 * Servicio de Autenticación
 * Maneja las llamadas a la API de autenticación
 */

import { apiService } from './api';
import { API_CONFIG } from '@/config/api.config';
import type { Usuario } from '@/types';

// Tipos específicos para autenticación
export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  user: {
    id: number;
    username: string;
    email: string;
    nombre_completo: string;
    rol: string;
  };
  accessToken: string;
  refreshToken: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  nombre_completo: string;
  rol?: string;
}

/**
 * Servicio de autenticación
 */
class AuthService {
  /**
   * Iniciar sesión
   */
  async login(credentials: LoginRequest): Promise<{ user: Usuario; token: string; refreshToken: string }> {
    try {
      const response = await apiService.post<LoginResponse>(
        API_CONFIG.ENDPOINTS.AUTH.LOGIN,
        credentials
      );

      if (!response.success || !response.data) {
        throw new Error(response.message || 'Error al iniciar sesión');
      }

      const { user: backendUser, accessToken, refreshToken } = response.data;

      // Mapear usuario del backend al formato del frontend
      const user: Usuario = {
        id: String(backendUser.id),
        username: backendUser.username,
        nombre: backendUser.nombre_completo, // Mapear nombre_completo a nombre
        rol: this.mapRol(backendUser.rol),
        email: backendUser.email,
        activo: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Guardar refresh token en localStorage
      localStorage.setItem('refresh_token', refreshToken);

      return {
        user,
        token: accessToken,
        refreshToken,
      };
    } catch (error: any) {
      console.error('Error en login:', error);
      throw new Error(error.message || 'Error al iniciar sesión');
    }
  }

  /**
   * Registrar nuevo usuario
   */
  async register(userData: RegisterRequest): Promise<{ user: Usuario; token: string }> {
    try {
      const response = await apiService.post<LoginResponse>(
        API_CONFIG.ENDPOINTS.AUTH.LOGIN,
        userData
      );

      if (!response.success || !response.data) {
        throw new Error(response.message || 'Error al registrar usuario');
      }

      const { user: backendUser, accessToken, refreshToken } = response.data;

      // Mapear usuario del backend al formato del frontend
      const user: Usuario = {
        id: String(backendUser.id),
        username: backendUser.username,
        nombre: backendUser.nombre_completo,
        rol: this.mapRol(backendUser.rol),
        email: backendUser.email,
        activo: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Guardar refresh token
      localStorage.setItem('refresh_token', refreshToken);

      return {
        user,
        token: accessToken,
      };
    } catch (error: any) {
      console.error('Error en registro:', error);
      throw new Error(error.message || 'Error al registrar usuario');
    }
  }

  /**
   * Cerrar sesión
   */
  async logout(): Promise<void> {
    try {
      const refreshToken = localStorage.getItem('refresh_token');

      if (refreshToken) {
        await apiService.post(API_CONFIG.ENDPOINTS.AUTH.LOGOUT, { refreshToken });
      }

      // Limpiar tokens
      localStorage.removeItem('auth_token');
      localStorage.removeItem('refresh_token');
    } catch (error: any) {
      console.error('Error en logout:', error);
      // Limpiar tokens incluso si falla la llamada al backend
      localStorage.removeItem('auth_token');
      localStorage.removeItem('refresh_token');
    }
  }

  /**
   * Refrescar access token
   */
  async refreshToken(): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const refreshToken = localStorage.getItem('refresh_token');

      if (!refreshToken) {
        throw new Error('No hay refresh token disponible');
      }

      const response = await apiService.post<{ accessToken: string; refreshToken: string }>(
        API_CONFIG.ENDPOINTS.AUTH.REFRESH,
        { refreshToken }
      );

      if (!response.success || !response.data) {
        throw new Error(response.message || 'Error al refrescar token');
      }

      const { accessToken, refreshToken: newRefreshToken } = response.data;

      // Actualizar tokens
      localStorage.setItem('auth_token', accessToken);
      localStorage.setItem('refresh_token', newRefreshToken);

      return {
        accessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error: any) {
      console.error('Error al refrescar token:', error);
      throw error;
    }
  }

  /**
   * Mapear rol del backend al formato del frontend
   */
  private mapRol(rol: string): 'admin' | 'operador' | 'supervisor' {
    const rolUpper = rol.toUpperCase();

    if (rolUpper === 'ADMIN' || rolUpper === 'ADMINISTRADOR') {
      return 'admin';
    }

    if (rolUpper === 'SUPERVISOR') {
      return 'supervisor';
    }

    // OPERARIO, OPERADOR, CALIDAD, etc. se mapean a operador
    return 'operador';
  }
}

// Exportar instancia única
export const authService = new AuthService();

export default authService;
