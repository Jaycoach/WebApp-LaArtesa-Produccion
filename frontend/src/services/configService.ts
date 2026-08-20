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
    const response = await apiClient.get<ConfiguracionSistema>(
      API_CONFIG.ENDPOINTS.CONFIG.BASE
    );
    return handleApiResponse(response);
  },

  /**
   * Actualizar configuración
   */
  update: async (data: UpdateConfiguracionRequest): Promise<ConfiguracionSistema> => {
    const response = await apiClient.put<ConfiguracionSistema>(
      API_CONFIG.ENDPOINTS.CONFIG.BASE,
      data
    );
    return handleApiResponse(response);
  },

  /**
   * Actualizar factor de absorción
   */
  updateFactorAbsorcion: async (factor: number): Promise<ConfiguracionSistema> => {
    const response = await apiClient.put<ConfiguracionSistema>(
      API_CONFIG.ENDPOINTS.CONFIG.FACTOR_ABSORCION,
      { factorAbsorcion: factor }
    );
    return handleApiResponse(response);
  },

  /**
   * Actualizar emails de notificación
   */
  getCorreos: async (): Promise<{ correos: string }> => {
    const response = await apiClient.get<{ correos: string }>(
      API_CONFIG.ENDPOINTS.CONFIG.CORREOS
    );
    return handleApiResponse(response);
  },

  updateCorreos: async (emails: string[]): Promise<ConfiguracionSistema> => {
    const response = await apiClient.put<ConfiguracionSistema>(
      API_CONFIG.ENDPOINTS.CONFIG.CORREOS,
      { correos: emails.join(',') }
    );
    return handleApiResponse(response);
  },

  /**
   * Obtener costo del agua
   */
  getCostoAgua: async (): Promise<{ costo: number; updated_at: string }> => {
    const response = await apiClient.get<{ costo: number; updated_at: string }>(
      API_CONFIG.ENDPOINTS.CONFIG.COSTO_AGUA
    );
    return handleApiResponse(response);
  },

  /**
   * Actualizar costo del agua por litro
   */
  updateCostoAgua: async (costo: number): Promise<{ costo: number; updated_at: string }> => {
    const response = await apiClient.put<{ costo: number; updated_at: string }>(
      API_CONFIG.ENDPOINTS.CONFIG.COSTO_AGUA,
      { costo }
    );
    return handleApiResponse(response);
  },

  /**
   * Obtener costo del Agua 2 (MP0008)
   */
  getCostoAgua2: async (): Promise<{ costo: number; updated_at: string }> => {
    const response = await apiClient.get<{ costo: number; updated_at: string }>(
      API_CONFIG.ENDPOINTS.CONFIG.COSTO_AGUA2
    );
    return handleApiResponse(response);
  },

  /**
   * Actualizar costo del Agua 2 (MP0008) por litro
   */
  updateCostoAgua2: async (costo: number): Promise<{ costo: number; updated_at: string }> => {
    const response = await apiClient.put<{ costo: number; updated_at: string }>(
      API_CONFIG.ENDPOINTS.CONFIG.COSTO_AGUA2,
      { costo }
    );
    return handleApiResponse(response);
  },
  getCatalogoTiposMasa: async (): Promise<any[]> => {
    const response = await apiClient.get<any[]>(
      API_CONFIG.ENDPOINTS.CONFIG.CATALOGO_TIPOS_MASA
    );
    return handleApiResponse(response);
  },
  getAmasadoras: async (): Promise<any[]> => {
    const response = await apiClient.get<any[]>(
      API_CONFIG.ENDPOINTS.CONFIG.AMASADORAS
    );
    return handleApiResponse(response);
  },
  getMaquinasCorte: async (): Promise<any[]> => {
    const response = await apiClient.get<any[]>(
      API_CONFIG.ENDPOINTS.CONFIG.MAQUINAS_CORTE
    );
    return handleApiResponse(response);
  },
  updateTipoMasaFormado: async (id: number, requiere_formado: boolean): Promise<any> => {
    const response = await apiClient.put<ApiResponse<any>>(
      `${API_CONFIG.ENDPOINTS.CONFIG.CATALOGO_TIPOS_MASA}/${id}`,
      { requiere_formado }
    );
    return handleApiResponse(response);
  },
};

export default configService;
