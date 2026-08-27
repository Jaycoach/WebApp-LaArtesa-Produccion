// frontend/src/hooks/useChecklist.ts

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { checklistService } from '../services/checklistService';
import { UpdateIngredienteRequest } from '../types/api';

/**
 * Query keys para checklist
 */
export const CHECKLIST_QUERY_KEYS = {
  all: ['checklist'] as const,
  byMasa: (masaId: number) => ['checklist', masaId] as const,
};

/**
 * Hook para obtener checklist de pesaje
 */
export const useChecklist = (masaId: number) => {
  return useQuery({
    queryKey: CHECKLIST_QUERY_KEYS.byMasa(masaId),
    queryFn: () => checklistService.getChecklist(masaId),
    enabled: !!masaId,
    refetchInterval: 5000, // Refrescar cada 5 segundos
    // Con refetchInterval activo, cualquier poll fallido (red inestable en planta)
    // no debe tumbar `checklist` a undefined y disparar "Masa no encontrada".
    placeholderData: keepPreviousData,
  });
};

/**
 * Hook para actualizar ingrediente del checklist
 */
export const useUpdateIngrediente = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      masaId,
      ingredienteId,
      data,
    }: {
      masaId: number;
      ingredienteId: number;
      data: UpdateIngredienteRequest;
    }) => checklistService.updateIngrediente(masaId, ingredienteId, data),
    onSuccess: (_data, variables) => {
      // Invalidar el checklist
      queryClient.invalidateQueries({
        queryKey: CHECKLIST_QUERY_KEYS.byMasa(variables.masaId),
      });

      return {
        success: true,
        message: 'Ingrediente actualizado',
      };
    },
    onError: (error: any) => {
      return {
        success: false,
        message: error.message || 'Error al actualizar ingrediente',
      };
    },
  });
};

/**
 * Hook para marcar ingrediente como disponible
 */
export const useMarcarDisponible = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      masaId,
      ingredienteId,
      disponible,
    }: {
      masaId: number;
      ingredienteId: number;
      disponible: boolean;
    }) => checklistService.marcarDisponible(masaId, ingredienteId, disponible),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: CHECKLIST_QUERY_KEYS.byMasa(variables.masaId),
      });
    },
  });
};

/**
 * Hook para marcar ingrediente como verificado
 */
export const useMarcarVerificado = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      masaId,
      ingredienteId,
      verificado,
    }: {
      masaId: number;
      ingredienteId: number;
      verificado: boolean;
    }) => checklistService.marcarVerificado(masaId, ingredienteId, verificado),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: CHECKLIST_QUERY_KEYS.byMasa(variables.masaId),
      });
    },
  });
};

/**
 * Hook para marcar ingrediente como pesado
 */
export const useMarcarPesado = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      masaId,
      ingredienteId,
      pesado,
      pesoReal,
      lote,
      fechaVencimiento,
    }: {
      masaId: number;
      ingredienteId: number;
      pesado: boolean;
      pesoReal?: number;
      lote?: string;
      fechaVencimiento?: string;
    }) =>
      checklistService.marcarPesado(
        masaId,
        ingredienteId,
        pesado,
        pesoReal,
        lote,
        fechaVencimiento
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: CHECKLIST_QUERY_KEYS.byMasa(variables.masaId),
      });
    },
  });
};

/**
 * Hook para confirmar pesaje completo
 */
export const useConfirmarPesaje = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (masaId: number) => checklistService.confirmarPesaje(masaId),
    onSuccess: (data, masaId) => {
      // Invalidar todas las queries relevantes para refrescar la UI
      queryClient.invalidateQueries({
        queryKey: CHECKLIST_QUERY_KEYS.byMasa(masaId),
      });

      // Invalidar fases con el masaId como string (como lo espera el hook)
      queryClient.invalidateQueries({
        queryKey: ['fases', String(masaId)],
      });

      // Invalidar detalle de masa
      queryClient.invalidateQueries({
        queryKey: ['masas', 'detail', masaId],
      });

      // Invalidar lista de masas
      queryClient.invalidateQueries({
        queryKey: ['masas'],
      });

      return {
        success: true,
        message: `Pesaje confirmado. Fase ${data.fase_desbloqueada} desbloqueada`,
        data,
      };
    },
    onError: (error: any) => {
      return {
        success: false,
        message: error.message || 'Error al confirmar pesaje',
      };
    },
  });
};

/**
 * Hook para enviar correo a empaque
 */
export const useEnviarCorreoEmpaque = () => {
  return useMutation({
    mutationFn: (masaId: number) => checklistService.enviarCorreoEmpaque(masaId),
    onSuccess: (data) => {
      return {
        success: true,
        message: `Correo enviado a: ${data.destinatarios.join(', ')}`,
        data,
      };
    },
    onError: (error: any) => {
      return {
        success: false,
        message: error.message || 'Error al enviar correo',
      };
    },
  });
};

/**
 * Hook para consultar ajustes pendientes de sincronizar con SAP (solo lectura).
 */
export const useAjustesPendientes = (masaId: number, enabled: boolean) => {
  return useQuery({
    queryKey: ['pesaje', 'ajustes-pendientes', masaId],
    queryFn: () => checklistService.getAjustesPendientes(masaId),
    enabled: enabled && !!masaId,
  });
};

/**
 * Hook para transmitir a SAP todos los ajustes pendientes de la masa.
 */
export const useConfirmarAjustesPendientes = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (masaId: number) => checklistService.confirmarAjustesPendientes(masaId),
    onSuccess: (_, masaId) => {
      queryClient.invalidateQueries({ queryKey: CHECKLIST_QUERY_KEYS.byMasa(masaId) });
      queryClient.invalidateQueries({ queryKey: ['pesaje', 'ajustes-pendientes', masaId] });
    },
  });
};

/**
 * Hook para listar transmisiones de pesaje a SAP pendientes de sincronizar
 * (solo admin/supervisor — la ruta backend ya lo exige, `enabled` evita el
 * fetch innecesario para el resto de roles).
 */
export const usePendientesSAP = (enabled: boolean) => {
  return useQuery({
    queryKey: ['pesaje', 'sap-pendientes'],
    queryFn: () => checklistService.getPendientesSAP(),
    enabled,
    refetchInterval: 15000,
  });
};

/**
 * Hook para reintentar en lote (o individualmente) transmisiones pendientes.
 */
export const useReenviarPendientesSAP = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: number[]) => checklistService.reenviarPendientesSAP(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pesaje', 'sap-pendientes'] });
      queryClient.invalidateQueries({ queryKey: CHECKLIST_QUERY_KEYS.all });
    },
  });
};