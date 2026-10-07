// frontend/src/services/api.ts

import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import { API_CONFIG, HTTP_STATUS, MESSAGES } from '../config/api.config';
import { useAuthStore } from '../store/useAuthStore';
import { esSesionReemplazada, marcarAvisoSesionReemplazada } from '../utils/sesionReemplazada';
import { ApiResponse } from '../types/api';

/** Marcas internas para controlar la renovación automática del token. */
interface ConfigRenovable extends InternalAxiosRequestConfig {
  /** La petición ya se reintentó una vez tras renovar: un segundo 401 es definitivo. */
  _retry?: boolean;
  /** La petición ES la renovación (o no debe renovarse nunca): evita bucles. */
  _skipRefresh?: boolean;
}

/** Endpoints donde un 401 NO debe intentar renovar (credenciales o la propia renovación). */
const RUTAS_SIN_RENOVACION = /\/auth\/(login|refresh)(\?|$)/;

/** Tiempo máximo de la petición de renovación (el timeout general es de 20 min). */
const TIMEOUT_RENOVACION_MS = 15_000;

/**
 * Instancia de Axios configurada
 */
class ApiService {
  private axiosInstance: AxiosInstance;

  /** Renovación en vuelo, compartida por todas las peticiones que reciben 401 a la vez. */
  private refreshPromise: Promise<string> | null = null;

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: API_CONFIG.BASE_URL,
      timeout: API_CONFIG.TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  /**
   * Configurar interceptores de request y response
   */
  private setupInterceptors(): void {
    // Request interceptor - agregar token
    this.axiosInstance.interceptors.request.use(
      (config: any) => {
        const token = localStorage.getItem('auth_token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error: any) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor - manejo de errores
    this.axiosInstance.interceptors.response.use(
      (response: AxiosResponse) => {
        return response;
      },
      (error: AxiosError<ApiResponse>) => {
        if (this.debeRenovarToken(error)) {
          return this.renovarYReintentar(error);
        }
        return this.handleError(error);
      }
    );
  }

  /**
   * ¿Este error es un 401 recuperable renovando el token?
   * No lo es si ya se reintentó, si es la propia renovación o el login.
   */
  private debeRenovarToken(error: AxiosError<ApiResponse>): boolean {
    const config = error.config as ConfigRenovable | undefined;
    if (error.response?.status !== HTTP_STATUS.UNAUTHORIZED || !config) return false;
    if (config._retry || config._skipRefresh) return false;
    // Sesión reemplazada por otro inicio de sesión: renovar fallaría igual (su refresh ya está revocado)
    if (esSesionReemplazada(error.response.data)) return false;
    return !RUTAS_SIN_RENOVACION.test(config.url || '');
  }

  /**
   * Ante un 401: renueva el token (una sola petición para todas las que fallaron a la
   * vez) y reintenta UNA vez la petición original. Si la renovación falla, se cierra la
   * sesión por el camino de siempre (handleError → login).
   */
  private async renovarYReintentar(error: AxiosError<ApiResponse>): Promise<any> {
    const original = error.config as ConfigRenovable;
    original._retry = true;

    let token: string;
    try {
      token = await this.obtenerTokenVigente(original);
    } catch {
      return this.handleError(error);
    }

    original.headers.set('Authorization', `Bearer ${token}`);
    // Pasa de nuevo por los interceptores: con _retry activo un 2.º 401 ya no renueva.
    return this.axiosInstance.request(original);
  }

  /** Token a usar para reintentar: el que dejó otra petición/pestaña, o uno recién renovado. */
  private async obtenerTokenVigente(original: ConfigRenovable): Promise<string> {
    const enviado = original.headers?.get?.('Authorization');
    const actual = localStorage.getItem('auth_token');
    // Si el token cambió desde que salió esta petición, otra petición (o pestaña) ya renovó:
    // renovar de nuevo gastaría un refresh token de un solo uso sin necesidad.
    if (actual && enviado !== `Bearer ${actual}`) return actual;
    return this.renovarToken();
  }

  /** Single-flight: todas las llamadas simultáneas comparten la misma renovación. */
  private renovarToken(): Promise<string> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.ejecutarRenovacion().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async ejecutarRenovacion(): Promise<string> {
    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) throw new Error('No hay refresh token disponible');

    try {
      const response = await this.axiosInstance.post<
        ApiResponse<{ accessToken: string; refreshToken: string }>
      >(
        API_CONFIG.ENDPOINTS.AUTH.REFRESH,
        { refreshToken },
        { timeout: TIMEOUT_RENOVACION_MS, _skipRefresh: true } as AxiosRequestConfig
      );
      const tokens = response.data?.data;
      if (!response.data?.success || !tokens?.accessToken || !tokens?.refreshToken) {
        throw new Error('Respuesta de renovación inválida');
      }

      // Mismo almacenamiento que el login: localStorage (lo lee el interceptor de request y
      // sessionReplacedGuard, que ve el mismo usuario y no interrumpe) + store persistido.
      localStorage.setItem('auth_token', tokens.accessToken);
      localStorage.setItem('refresh_token', tokens.refreshToken);
      useAuthStore.setState({ token: tokens.accessToken });
      return tokens.accessToken;
    } catch (error) {
      // Carrera entre pestañas: cada refresh token es de un solo uso; si otra pestaña lo
      // rotó primero, localStorage ya trae el par nuevo y se puede seguir con él.
      const refreshActual = localStorage.getItem('refresh_token');
      const accesoActual = localStorage.getItem('auth_token');
      if (refreshActual && refreshActual !== refreshToken && accesoActual) return accesoActual;
      throw error;
    }
  }

  /** Cierra la sesión local por completo y manda a /login (sin recargar si ya está ahí). */
  private cerrarSesionYRedirigir(): void {
    useAuthStore.getState().logout(); // limpia auth_token, refresh_token y el store persistido
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }

  /**
   * Manejo centralizado de errores
   */
  private handleError(error: AxiosError<ApiResponse>): Promise<never> {
    if (!error.response) {
      // Error de red
      console.error('Network Error:', error.message);
      return Promise.reject({
        success: false,
        message: MESSAGES.ERROR.NETWORK,
        error: error.message,
      });
    }

    const { status, data } = error.response;

    switch (status) {
      case HTTP_STATUS.UNAUTHORIZED:
        // Sesión expirada (y la renovación no fue posible o no aplica) - redirigir a login
        console.error('Unauthorized - redirecting to login');
        // Si fue por sesión única, se deja el aviso (sessionStorage) para mostrarlo una vez en /login
        if (esSesionReemplazada(data)) marcarAvisoSesionReemplazada();
        this.cerrarSesionYRedirigir();
        return Promise.reject({
          success: false,
          message: MESSAGES.ERROR.UNAUTHORIZED,
          error: data?.error,
        });

      case HTTP_STATUS.FORBIDDEN:
        console.error('Forbidden:', data?.error);
        return Promise.reject({
          success: false,
          code: (data as any)?.code,
          message: (data as any)?.message || MESSAGES.ERROR.FORBIDDEN,
          error: data?.error,
        });

      case HTTP_STATUS.NOT_FOUND:
        console.error('Not Found:', data?.error);
        return Promise.reject({
          success: false,
          message: MESSAGES.ERROR.NOT_FOUND,
          error: data?.error,
        });

      case HTTP_STATUS.BAD_REQUEST:
        console.error('Bad Request:', data?.error);
        return Promise.reject({
          success: false,
          message: data?.message || 'Error en la solicitud',
          errors: (data as any)?.errors,
          error: data?.error,
        });

      case HTTP_STATUS.CONFLICT:
        console.error('Conflict (409):', data?.message);
        return Promise.reject({
          success: false,
          status: 409,
          message: data?.message || 'Conflicto de datos',
          data: (data as any)?.data,  // { lote_fallido, disponible, lotes_actuales }
          error: data?.error,
        });

      case HTTP_STATUS.UNPROCESSABLE_ENTITY:
        console.error('Unprocessable (422):', data?.message);
        return Promise.reject({
          success: false,
          status: 422,
          message: data?.message || 'Datos inválidos',
          data: (data as any)?.data,
          error: data?.error,
        });

      case HTTP_STATUS.INTERNAL_SERVER_ERROR:
        console.error('Server Error:', data?.error);
        return Promise.reject({
          success: false,
          message: MESSAGES.ERROR.SERVER,
          error: data?.error,
        });

      case 429:
        console.error('Rate Limited (429):', data?.error);
        return Promise.reject({
          success: false,
          status: 429,
          message: (data as any)?.error?.message || 'Estás haciendo demasiadas solicitudes seguidas. Espera unos segundos e intenta de nuevo.',
          error: data?.error,
        });

      case 502:
        console.error('SAP Error (502):', data?.message);
        return Promise.reject({
          success: false,
          status: 502,
          message: (data as any)?.message || 'Error al comunicarse con SAP',
          data: (data as any)?.data,  // { reintentable, lote_fallido, alternativas }
          error: data?.error,
        });

      default:
        console.error('Unknown Error:', status, data?.error);
        return Promise.reject({
          success: false,
          status,
          message: data?.message || MESSAGES.ERROR.UNKNOWN,
          data: (data as any)?.data,
          error: data?.error,
        });
    }
  }

  /**
   * GET request
   */
  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    const response = await this.axiosInstance.get<ApiResponse<T>>(url, config);
    return response.data;
  }

  /**
   * POST request
   */
  async post<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    const response = await this.axiosInstance.post<ApiResponse<T>>(url, data, config);
    return response.data;
  }

  /**
   * PUT request
   */
  async put<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    const response = await this.axiosInstance.put<ApiResponse<T>>(url, data, config);
    return response.data;
  }

  /**
   * PATCH request
   */
  async patch<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    const response = await this.axiosInstance.patch<ApiResponse<T>>(url, data, config);
    return response.data;
  }

  /**
   * DELETE request
   */
  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    const response = await this.axiosInstance.delete<ApiResponse<T>>(url, config);
    return response.data;
  }
}

// Exportar instancia única
export const apiService = new ApiService();

// Exportar como apiClient para compatibilidad
export const apiClient = apiService;

/**
 * Helper para manejar respuestas de API
 */
export function handleApiResponse<T>(response: ApiResponse<T>): T {
  if (response.success && response.data !== undefined) {
    return response.data;
  }
  throw new Error(response.error || response.message || 'Error desconocido');
}

/**
 * Helper para manejar errores de API
 */
export function handleApiError(error: any): never {
  console.error('API Error:', error);
  throw error;
}

export default apiService;
