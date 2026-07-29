// frontend/src/services/checklistService.ts

import { apiService } from './api';
import { API_CONFIG } from '../config/api.config';
import {
  ChecklistPesaje,
  IngredienteMasa,
  UpdateIngredienteRequest,
  ConfirmarPesajeResponse,
  EnvioCorreoResponse,
} from '../types/api';

/**
 * Servicio para operaciones con checklist de pesaje
 */
export const checklistService = {
  /**
   * Obtener checklist de pesaje de una masa
   */
  getChecklist: async (masaId: number): Promise<ChecklistPesaje> => {
    const response = await apiService.get<ChecklistPesaje>(
      API_CONFIG.ENDPOINTS.PESAJE.CHECKLIST(masaId)
    );
    return response.data!;
  },

  /**
   * Actualizar estado de un ingrediente en el checklist
   */
  updateIngrediente: async (
    masaId: number,
    ingredienteId: number,
    data: UpdateIngredienteRequest
  ): Promise<IngredienteMasa> => {
    const response = await apiService.patch<IngredienteMasa>(
      API_CONFIG.ENDPOINTS.PESAJE.UPDATE_INGREDIENTE(masaId, ingredienteId),
      data
    );
    return response.data!;
  },

  /**
   * Marcar ingrediente como disponible
   */
  marcarDisponible: async (
    masaId: number,
    ingredienteId: number,
    disponible: boolean
  ): Promise<IngredienteMasa> => {
    return checklistService.updateIngrediente(masaId, ingredienteId, {
      disponible,
    });
  },

  /**
   * Marcar ingrediente como verificado
   */
  marcarVerificado: async (
    masaId: number,
    ingredienteId: number,
    verificado: boolean
  ): Promise<IngredienteMasa> => {
    return checklistService.updateIngrediente(masaId, ingredienteId, {
      verificado,
    });
  },

  /**
   * Marcar ingrediente como pesado
   */
  marcarPesado: async (
    masaId: number,
    ingredienteId: number,
    pesado: boolean,
    pesoReal?: number,
    lote?: string,
    fechaVencimiento?: string
  ): Promise<IngredienteMasa> => {
    return checklistService.updateIngrediente(masaId, ingredienteId, {
      pesado,
      peso_real: pesoReal,
      lote,
      fecha_vencimiento: fechaVencimiento,
    });
  },

  /**
   * Confirmar que todo el pesaje está completo
   */
  confirmarPesaje: async (masaId: number): Promise<ConfirmarPesajeResponse> => {
    const ahora = new Date();
    const fecha_local = `${ahora.getFullYear()}-${String(ahora.getMonth()+1).padStart(2,'0')}-${String(ahora.getDate()).padStart(2,'0')}`;
    const response = await apiService.post<ConfirmarPesajeResponse>(
      API_CONFIG.ENDPOINTS.PESAJE.CONFIRMAR(masaId),
      { fecha_local }
    );
    return response.data!;
  },

  /**
   * Enviar correo al área de empaque
   */
  enviarCorreoEmpaque: async (masaId: number): Promise<EnvioCorreoResponse> => {
    const response = await apiService.post<EnvioCorreoResponse>(
      API_CONFIG.ENDPOINTS.PESAJE.ENVIAR_CORREO(masaId)
    );
    return response.data!;
  },

  /**
   * Transmite a SAP el excedente/faltante de un ingrediente editado
   * después de que el pesaje ya fue confirmado.
   */
  ajustarSap: async (
    masaId: number,
    ingredienteId: number
  ): Promise<{ aplica: boolean; tipo?: string; delta_gramos?: number; sap_doc_num?: string; message: string }> => {
    const response = await apiService.post<any>(
      API_CONFIG.ENDPOINTS.PESAJE.AJUSTAR_SAP(masaId, ingredienteId)
    );
    return response.data!;
  },
};

export default checklistService;