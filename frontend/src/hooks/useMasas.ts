// frontend/src/hooks/useMasas.ts

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { masasService } from '../services/masasService';
import { MESSAGES } from '../config/api.config';

/**
 * Query keys para React Query
 */
export const MASAS_QUERY_KEYS = {
  all: ['masas'] as const,
  byFecha: (fecha: string) => ['masas', 'fecha', fecha] as const,
  detail: (id: number) => ['masas', 'detail', id] as const,
  composicion: (id: number) => ['masas', 'composicion', id] as const,
  productos: (id: number) => ['masas', 'productos', id] as const,
};

/**
 * Hook para obtener masas por fecha
 */
export const useMasasByFecha = (fecha: string) => {
  return useQuery({
    queryKey: MASAS_QUERY_KEYS.byFecha(fecha),
    queryFn: () => masasService.getMasasByFecha(fecha),
    enabled: !!fecha,
    staleTime: 30000, // 30 segundos
  });
};

/**
 * Hook para obtener detalle de una masa
 */
export const useMasaDetail = (masaId: number) => {
  return useQuery({
    queryKey: MASAS_QUERY_KEYS.detail(masaId),
    queryFn: () => masasService.getMasaById(masaId),
    enabled: !!masaId,
  });
};

/**
 * Hook para obtener composición de una masa
 */
export const useComposicion = (masaId: number) => {
  return useQuery({
    queryKey: MASAS_QUERY_KEYS.composicion(masaId),
    queryFn: () => masasService.getComposicion(masaId),
    enabled: !!masaId,
  });
};

/**
 * Hook para obtener productos de una masa
 */
export const useProductos = (masaId: number) => {
  return useQuery({
    queryKey: MASAS_QUERY_KEYS.productos(masaId),
    queryFn: () => masasService.getProductos(masaId),
    enabled: !!masaId,
  });
};

/**
 * Hook para sincronizar con SAP
 */
export const useSincronizarSAP = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params?: { fecha?: string; forzar?: boolean }) => masasService.sincronizarSAP(params?.fecha, params?.forzar),
    onSuccess: (data) => {
      // Invalidar todas las queries de masas
      queryClient.invalidateQueries({ queryKey: MASAS_QUERY_KEYS.all });

      return {
        success: true,
        message: `${data.masas_creadas} masas creadas, ${data.ordenes_procesadas} órdenes procesadas`,
      };
    },
    onError: (error: any) => {
      return {
        success: false,
        message: error.message || 'Error al sincronizar con SAP',
      };
    },
  });
};

/**
 * Hook para sincronizar BOM (listas de materiales) desde SAP
 */
export const useSincronizarBOM = () => {
  return useMutation({
    mutationFn: (items?: string) => masasService.sincronizarBOM(items),
    onError: (error: any) => {
      return {
        success: false,
        message: error.message || 'Error al sincronizar BOM',
      };
    },
  });
};
/**
 * Hook para sincronizar Inventario y Lotes completos desde SAP
 */
export const useSincronizarInventarioMP = () => {
  return useMutation({
    mutationFn: () => masasService.sincronizarInventarioMP(),
    onError: (error: any) => {
      if (error?.response?.status === 409) {
        return {
          success: false,
          message: 'Ya hay una sincronización de inventario/lotes en curso. Intenta nuevamente en unos minutos.',
        };
      }
      return {
        success: false,
        message: error.message || 'Error al sincronizar inventario/lotes',
      };
    },
  });
};
/**
 * Hook para sincronizar lotes de ítems puntuales desde SAP
 */
export const useSincronizarLotesItem = () => {
  return useMutation({
    mutationFn: (items: string) => masasService.sincronizarLotesItem(items),
    onError: (error: any) => {
      if (error?.response?.status === 409) {
        return {
          success: false,
          message: 'Ya hay una sincronización de inventario/lotes en curso. Intenta nuevamente en unos minutos.',
        };
      }
      return {
        success: false,
        message: error.message || 'Error al sincronizar los códigos especificados',
      };
    },
  });
};

/**
 * Hook para actualizar unidades programadas
 */
export const useUpdateUnidadesProgramadas = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      masaId,
      productoId,
      unidades,
    }: {
      masaId: number;
      productoId: number;
      unidades: number;
    }) => masasService.updateUnidadesProgramadas(masaId, productoId, unidades),
    onSuccess: (data, variables) => {
      // Invalidar queries relacionadas
      queryClient.invalidateQueries({
        queryKey: MASAS_QUERY_KEYS.productos(variables.masaId),
      });
      queryClient.invalidateQueries({
        queryKey: MASAS_QUERY_KEYS.detail(variables.masaId),
      });
      queryClient.invalidateQueries({
        queryKey: MASAS_QUERY_KEYS.composicion(variables.masaId),
      });

      return {
        success: true,
        message: MESSAGES.SUCCESS.UPDATED,
      };
    },
    onError: (error: any) => {
      return {
        success: false,
        message: error.message || 'Error al actualizar unidades',
      };
    },
  });
};

/**
 * Hook para obtener todas las masas del día actual
 */
export const useMasasHoy = () => {
  const hoy = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return useMasasByFecha(hoy);
};

/**
 * Hook para aprobar una masa (ADMIN/SUPERVISOR)
 */
export const useAprobarMasa = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ masaId, fecha_vencimiento_sugerida, prioridad, hora_entrega }: { masaId: number; fecha_vencimiento_sugerida?: string; prioridad?: boolean; hora_entrega?: string }) =>
      masasService.aprobarMasa(masaId, fecha_vencimiento_sugerida, prioridad, hora_entrega),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MASAS_QUERY_KEYS.all });
    },
  });
};

/**
 * Hook para aprobar múltiples masas de una vez (ADMIN/SUPERVISOR)
 */
export const useAprobarMasaBulk = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, fecha_vencimiento_sugerida, prioridad, hora_entrega }: { ids: number[]; fecha_vencimiento_sugerida?: string; prioridad?: boolean; hora_entrega?: string }) =>
      masasService.aprobarMasaBulk(ids, fecha_vencimiento_sugerida, prioridad, hora_entrega),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MASAS_QUERY_KEYS.all });
    },
  });
};

/**
 * Hook para marcar una masa como pendiente (ADMIN/SUPERVISOR)
 */
export const useMarcarPendiente = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ masaId, motivo }: { masaId: number; motivo?: string }) =>
      masasService.marcarPendiente(masaId, motivo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MASAS_QUERY_KEYS.all });
    },
  });
};

/**
 * Hook para cancelar una masa (ADMIN/SUPERVISOR)
 */
export const useInfoCancelacionMasa = (masaId: number | null) => {
  return useQuery({
    queryKey: ['masas', 'cancelacion-info', masaId],
    queryFn: () => masasService.getInfoCancelacion(masaId as number),
    enabled: !!masaId,
  });
};

export const useCancelarMasa = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ masaId, motivo, confirmarParcial, lineasSeleccionadas }: {
      masaId: number;
      motivo: string;
      confirmarParcial?: boolean;
      lineasSeleccionadas?: { sap_doc_entry: number; sap_line_num: number }[];
    }) =>
      masasService.cancelarMasa(masaId, motivo, confirmarParcial, lineasSeleccionadas),
    onSuccess: () => {
      // Invalida todo lo que empiece con 'masas' EXCEPTO 'cancelacion-info':
      // esa query queda cacheada por cada masa que se abrió en el modal durante
      // la sesión, y si se incluye en el invalidate masivo, vuelve a pedirse
      // para masas ya CANCELADAS de pruebas anteriores, generando 404 en consola
      // sin ningún propósito (una masa cancelada no necesita info de cancelación).
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey as unknown[];
          return key[0] === 'masas' && key[1] !== 'cancelacion-info';
        },
      });
    },
  });
};