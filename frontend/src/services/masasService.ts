// frontend/src/services/masasService.ts

import { apiService } from './api';
import { API_CONFIG } from '../config/api.config';
import {
  MasaProduccionResumen,
  MasaProduccionDetalle,
  ProductoMasa,
  IngredienteMasa,
  UpdateUnidadesProgramadasRequest,
  SincronizacionSAPResponse,
  SincronizacionBOMResponse,
} from '../types/api';

/**
 * Servicio para operaciones con masas de producción
 */
export const masasService = {
  /**
   * Sincronizar órdenes desde SAP
   */
  sincronizarSAP: async (fecha?: string, forzar?: boolean): Promise<SincronizacionSAPResponse> => {
    const response = await apiService.post<SincronizacionSAPResponse>(
      API_CONFIG.ENDPOINTS.SAP.SINCRONIZAR,
      { fecha, forzar }
    );
    return response.data!;
  },

  /**
   * Sincronizar Listas de Materiales (BOM) desde SAP
   */
  sincronizarBOM: async (): Promise<SincronizacionBOMResponse> => {
    const response = await apiService.post<SincronizacionBOMResponse>(
      API_CONFIG.ENDPOINTS.SAP.SINCRONIZAR_BOM
    );
    return response.data!;
  },

  /**
   * Obtener lista de masas por fecha
   */
  getMasasByFecha: async (fecha: string, fase?: string): Promise<MasaProduccionResumen[]> => {
    const response = await apiService.get<MasaProduccionResumen[]>(
      `${API_CONFIG.ENDPOINTS.MASAS.LIST}?fecha=${fecha}${fase ? `&fase=${fase}` : ''}`
    );
    return response.data!;
  },

  /**
   * Obtener detalle de una masa
   */
  getMasaById: async (masaId: number): Promise<MasaProduccionDetalle> => {
    const response = await apiService.get<MasaProduccionDetalle>(
      API_CONFIG.ENDPOINTS.MASAS.DETAIL(masaId)
    );
    return response.data!;
  },

  /**
   * Obtener composición de ingredientes de una masa
   */
  getComposicion: async (masaId: number): Promise<IngredienteMasa[]> => {
    const response = await apiService.get<IngredienteMasa[]>(
      API_CONFIG.ENDPOINTS.MASAS.COMPOSICION(masaId)
    );
    return response.data!;
  },

  /**
   * Obtener productos de una masa
   */
  getProductos: async (masaId: number): Promise<ProductoMasa[]> => {
    const response = await apiService.get<ProductoMasa[]>(
      API_CONFIG.ENDPOINTS.MASAS.PRODUCTOS(masaId)
    );
    return response.data!;
  },

  /**
   * Actualizar unidades programadas de un producto
   */
  updateUnidadesProgramadas: async (
    masaId: number,
    productoId: number,
    unidades: number
  ): Promise<ProductoMasa> => {
    const data: UpdateUnidadesProgramadasRequest = {
      unidades_programadas: unidades,
    };

    const response = await apiService.patch<ProductoMasa>(
      API_CONFIG.ENDPOINTS.MASAS.UPDATE_PRODUCTO(masaId, productoId),
      data
    );
    return response.data!;
  },

  /**
   * Aprobar una masa (ADMIN/SUPERVISOR)
   */
  aprobarMasa: async (masaId: number): Promise<any> => {
    const response = await apiService.patch<any>(`/masas/${masaId}/aprobar`);
    return response.data!;
  },

  /**
   * Marcar una masa como pendiente (ADMIN/SUPERVISOR)
   */
  marcarPendiente: async (masaId: number, motivo?: string): Promise<any> => {
    const response = await apiService.patch<any>(`/masas/${masaId}/pendiente`, { motivo });
    return response.data!;
  },
};

export default masasService;