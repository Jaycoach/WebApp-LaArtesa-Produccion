// frontend/src/services/api.ts

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { API_CONFIG, HTTP_STATUS, MESSAGES } from '../config/api.config';
import { ApiResponse } from '../types/api';

/**
 * Instancia de Axios configurada
 */
class ApiService {
  private axiosInstance: AxiosInstance;

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
        return this.handleError(error);
      }
    );
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
        // Sesión expirada - redirigir a login
        console.error('Unauthorized - redirecting to login');
        localStorage.removeItem('auth_token');
        window.location.href = '/login';
        return Promise.reject({
          success: false,
          message: MESSAGES.ERROR.UNAUTHORIZED,
          error: data?.error,
        });

      case HTTP_STATUS.FORBIDDEN:
        console.error('Forbidden:', data?.error);
        return Promise.reject({
          success: false,
          message: MESSAGES.ERROR.FORBIDDEN,
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
          error: data?.error,
        });

      case HTTP_STATUS.INTERNAL_SERVER_ERROR:
        console.error('Server Error:', data?.error);
        return Promise.reject({
          success: false,
          message: MESSAGES.ERROR.SERVER,
          error: data?.error,
        });

      default:
        console.error('Unknown Error:', status, data?.error);
        return Promise.reject({
          success: false,
          message: MESSAGES.ERROR.UNKNOWN,
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
