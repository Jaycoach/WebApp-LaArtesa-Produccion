// frontend/src/hooks/useChecklist.ts

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { checklistService } from '../services/checklistService';
import { UpdateIngredienteRequest } from '../types/api';
import { MESSAGES } from '../config/api.config';

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
    onSuccess: (data, variables) => {
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
    onSuccess: (data, variables) => {
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
    onSuccess: (data, variables) => {
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
    onSuccess: (data, variables) => {
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
      // Invalidar checklist y progreso de fases
      queryClient.invalidateQueries({
        queryKey: CHECKLIST_QUERY_KEYS.byMasa(masaId),
      });
      queryClient.invalidateQueries({
        queryKey: ['fases', 'progreso', masaId],
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