/**
 * Servicio para configuración del sistema
 */
import { apiClient, handleApiResponse } from './api';
import { API_CONFIG } from '@/config/api.config';
import type {
  ConfiguracionSistema,
  UpdateConfiguracionRequest,
  ApiResponse,
} from '@/types';

export const configService = {
  /**
   * Obtener configuración del sistema
   */
  get: async (): Promise<ConfiguracionSistema> => {
    const response = await apiClient.get<ApiResponse<ConfiguracionSistema>>(
      API_CONFIG.ENDPOINTS.CONFIG.BASE
    );
    return handleApiResponse(response);
  },

  /**
   * Actualizar configuración
   */
  update: async (data: UpdateConfiguracionRequest): Promise<ConfiguracionSistema> => {
    const response = await apiClient.put<ApiResponse<ConfiguracionSistema>>(
      API_CONFIG.ENDPOINTS.CONFIG.BASE,
      data
    );
    return handleApiResponse(response);
  },

  /**
   * Actualizar factor de absorción
   */
  updateFactorAbsorcion: async (factor: number): Promise<ConfiguracionSistema> => {
    const response = await apiClient.put<ApiResponse<ConfiguracionSistema>>(
      API_CONFIG.ENDPOINTS.CONFIG.FACTOR_ABSORCION,
      { factorAbsorcion: factor }
    );
    return handleApiResponse(response);
  },

  /**
   * Actualizar emails de notificación
   */
  updateCorreos: async (emails: string[]): Promise<ConfiguracionSistema> => {
    const response = await apiClient.put<ApiResponse<ConfiguracionSistema>>(
      API_CONFIG.ENDPOINTS.CONFIG.CORREOS,
      { emailNotificaciones: emails }
    );
    return handleApiResponse(response);
  },
};

export default configService;
