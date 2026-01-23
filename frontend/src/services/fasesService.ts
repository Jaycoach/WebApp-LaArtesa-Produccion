/**
 * Servicio para gestión de fases de producción
 */
import { apiClient, handleApiResponse } from './api';
import { API_CONFIG } from '@/config/api.config';
import type {
  ProgresoFases,
  UpdateProgresoFaseRequest,
  CompletarFaseRequest,
  ApiResponse,
} from '@/types';

export const fasesService = {
  /**
   * Obtener progreso de fases de una masa
   */
  getByMasa: async (masaId: string): Promise<ProgresoFases> => {
    const response = await apiClient.get<ApiResponse<ProgresoFases>>(
      API_CONFIG.ENDPOINTS.FASES.BY_MASA(masaId)
    );
    return handleApiResponse(response);
  },

  /**
   * Actualizar progreso de una fase
   */
  updateProgreso: async (masaId: string, data: UpdateProgresoFaseRequest): Promise<ProgresoFases> => {
    const response = await apiClient.put<ApiResponse<ProgresoFases>>(
      API_CONFIG.ENDPOINTS.FASES.UPDATE_PROGRESO(masaId),
      data
    );
    return handleApiResponse(response);
  },

  /**
   * Iniciar una fase
   */
  iniciarFase: async (
    masaId: string,
    fase: 'pesaje' | 'amasado' | 'division' | 'formado' | 'fermentacion' | 'horneado',
    responsable?: string
  ): Promise<ProgresoFases> => {
    const response = await apiClient.put<ApiResponse<ProgresoFases>>(
      API_CONFIG.ENDPOINTS.FASES.UPDATE_PROGRESO(masaId),
      {
        fase,
        accion: 'iniciar',
        datos: { responsable },
      }
    );
    return handleApiResponse(response);
  },

  /**
   * Completar una fase
   */
  completarFase: async (
    masaId: string,
    fase: 'pesaje' | 'amasado' | 'division' | 'formado' | 'fermentacion' | 'horneado',
    data?: CompletarFaseRequest
  ): Promise<ProgresoFases> => {
    const response = await apiClient.put<ApiResponse<ProgresoFases>>(
      API_CONFIG.ENDPOINTS.FASES.COMPLETAR_FASE(masaId, fase),
      data
    );
    return handleApiResponse(response);
  },

  /**
   * Obtener fase actual de una masa
   */
  getFaseActual: async (masaId: string): Promise<string> => {
    const progreso = await fasesService.getByMasa(masaId);
    return progreso.faseActual;
  },

  /**
   * Verificar si una fase está completada
   */
  isFaseCompletada: async (
    masaId: string,
    fase: 'pesaje' | 'amasado' | 'division' | 'formado' | 'fermentacion' | 'horneado'
  ): Promise<boolean> => {
    const progreso = await fasesService.getByMasa(masaId);

    switch (fase) {
      case 'pesaje':
        return progreso.pesajeCompletado;
      case 'amasado':
        return progreso.amasadoCompletado;
      case 'division':
        return progreso.divisionCompletada;
      case 'formado':
        return progreso.formadoCompletado;
      case 'fermentacion':
        return progreso.fermentacionCompletada;
      case 'horneado':
        return progreso.horneadoCompletado;
      default:
        return false;
    }
  },
};

export default fasesService;
