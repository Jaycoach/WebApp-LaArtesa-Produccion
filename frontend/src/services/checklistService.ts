// frontend/src/services/checklistService.ts

import { apiService } from './api';
import { API_CONFIG } from '../config/api.config';
import {
  ChecklistPesaje,
  IngredienteMasa,
  UpdateIngredienteRequest,
  ConfirmarPesajeResponse,
  EnvioCorreoResponse,
  GrupoPendientesSAP,
  ReenvioSAPResultado,
  ResumenReenvioSAP,
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
   * Lista ajustes pendientes de sincronizar con SAP (excedente/faltante) sin transmitir nada.
   */
  getAjustesPendientes: async (
    masaId: number
  ): Promise<{ pesaje_transmitido: boolean; pendientes: any[] }> => {
    const response = await apiService.get<any>(
      API_CONFIG.ENDPOINTS.PESAJE.AJUSTES_PENDIENTES(masaId)
    );
    return response.data!;
  },

  /**
   * Transmite a SAP todos los ajustes pendientes de la masa (agrupados en
   * un GenExit de excedentes y/o un GenEntry de faltantes).
   */
  confirmarAjustesPendientes: async (
    masaId: number
  ): Promise<{ message: string; data: any }> => {
    const response = await apiService.post<any>(
      API_CONFIG.ENDPOINTS.PESAJE.CONFIRMAR_AJUSTES(masaId)
    );
    return { message: response.message || '', data: response.data };
  },

  /**
   * Lista transmisiones de pesaje a SAP pendientes de sincronizar (SAP estaba
   * inalcanzable por conexión, o falló la autenticación, al confirmar el
   * pesaje), agrupadas por fecha de producción. Solo admin/supervisor. Vive
   * en Sincronizar SAP, no dentro de Pesaje.
   */
  getPendientesSAP: async (): Promise<GrupoPendientesSAP[]> => {
    const response = await apiService.get<GrupoPendientesSAP[]>(
      API_CONFIG.ENDPOINTS.PESAJE.SAP_PENDIENTES
    );
    return response.data || [];
  },

  /**
   * Reintenta transmitir a SAP registros pendientes — por ids explícitos de
   * sap_sync_log, o por grupo (`fechaProduccion`: 'YYYY-MM-DD', o 'todas').
   */
  reenviarPendientesSAP: async (
    seleccion: { ids: number[] } | { fechaProduccion: string }
  ): Promise<{ message: string; data: ReenvioSAPResultado[]; resumen?: ResumenReenvioSAP }> => {
    const body = 'ids' in seleccion
      ? { ids: seleccion.ids }
      : { fecha_produccion: seleccion.fechaProduccion };
    const response = await apiService.post<ReenvioSAPResultado[]>(
      API_CONFIG.ENDPOINTS.PESAJE.SAP_PENDIENTES_REENVIAR,
      body
    );
    return {
      message: response.message || '',
      data: response.data || [],
      resumen: (response as any).resumen,
    };
  },
};

export default checklistService;