/**
 * Hook para gestión de fases de producción con React Query
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fasesService } from '@/services';
import type {
  UpdateProgresoFaseRequest,
  CompletarFaseRequest,
  CompletarFaseResponse,
  SubMasaInfo,
  SubdivisionInfo,
} from '@/types';

export type { CompletarFaseResponse, SubMasaInfo, SubdivisionInfo };

// Query keys
export const fasesKeys = {
  all: ['fases'] as const,
  byMasa: (masaId: string) => [...fasesKeys.all, masaId] as const,
};

/**
 * Hook para obtener progreso de fases de una masa
 */
export const useFases = (masaId: string) => {
  return useQuery({
    queryKey: fasesKeys.byMasa(masaId),
    queryFn: () => fasesService.getByMasa(masaId),
    enabled: !!masaId,
  });
};

/**
 * Hook para actualizar progreso de una fase
 */
export const useUpdateProgreso = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ masaId, data }: { masaId: string; data: UpdateProgresoFaseRequest }) =>
      fasesService.updateProgreso(masaId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: fasesKeys.byMasa(variables.masaId) });
    },
  });
};

/**
 * Hook para iniciar una fase
 */
export const useIniciarFase = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ masaId, fase, responsable }: {
      masaId: string;
      fase: 'pesaje' | 'amasado' | 'division' | 'formado' | 'fermentacion' | 'horneado';
      responsable?: string;
    }) => fasesService.iniciarFase(masaId, fase, responsable),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: fasesKeys.byMasa(variables.masaId) });
    },
  });
};

/**
 * Hook para completar una fase.
 * Cuando hay subdivisión automática, `onSuccess` recibe un `CompletarFaseResponse`
 * con `subdivision.realizada = true` y los IDs de las dos sub-masas creadas.
 */
export const useCompletarFase = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ masaId, fase, data }: {
      masaId: string;
      fase: 'planificacion' | 'pesaje' | 'amasado' | 'division' | 'formado' | 'fermentacion' | 'horneado';
      data?: CompletarFaseRequest;
    }) => fasesService.completarFase(masaId, fase, data),

    onSuccess: (response, variables) => {
      // Invalidar queries de la masa original siempre
      queryClient.invalidateQueries({ queryKey: fasesKeys.byMasa(variables.masaId) });
      queryClient.invalidateQueries({ queryKey: ['masas', 'detail', Number(variables.masaId)] });
      queryClient.invalidateQueries({ queryKey: ['masas'] });
      queryClient.invalidateQueries({ queryKey: ['masas', 'productos', Number(variables.masaId)] });

      // Si hubo subdivisión, invalidar también las sub-masas creadas
      if (response?.subdivision?.realizada) {
        for (const subMasa of response.subdivision.sub_masas) {
          queryClient.invalidateQueries({ queryKey: fasesKeys.byMasa(String(subMasa.id)) });
          queryClient.invalidateQueries({ queryKey: ['masas', 'detail', subMasa.id] });
        }
      }
    },
  });
};

/**
 * Hook para obtener la fase actual de una masa
 */
export const useFaseActual = (masaId: string) => {
  const { data: progreso } = useFases(masaId);
  return progreso?.faseActual;
};

/**
 * Hook para verificar si una fase está completada
 */
export const useFaseCompletada = (
  masaId: string,
  fase: 'pesaje' | 'amasado' | 'division' | 'formado' | 'fermentacion' | 'horneado'
) => {
  const { data: progreso } = useFases(masaId);

  if (!progreso) return false;

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
};
