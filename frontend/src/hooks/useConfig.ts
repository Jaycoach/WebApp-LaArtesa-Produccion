/**
 * Hook para gestión de configuración con React Query
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { configService } from '@/services';
import type { UpdateConfiguracionRequest } from '@/types';

// Query keys
export const configKeys = {
  all: ['config'] as const,
  detail: () => [...configKeys.all, 'detail'] as const,
};

/**
 * Hook para obtener configuración del sistema
 */
export const useConfig = () => {
  return useQuery({
    queryKey: configKeys.detail(),
    queryFn: () => configService.get(),
    staleTime: 1000 * 60 * 5, // 5 minutos
  });
};

/**
 * Hook para actualizar configuración
 */
export const useUpdateConfig = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateConfiguracionRequest) => configService.update(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configKeys.detail() });
    },
  });
};

/**
 * Hook para actualizar factor de absorción
 */
export const useUpdateFactorAbsorcion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (factor: number) => configService.updateFactorAbsorcion(factor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configKeys.detail() });
    },
  });
};

/**
 * Hook para actualizar emails de notificación
 */
export const useUpdateCorreos = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (emails: string[]) => configService.updateCorreos(emails),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config', 'correos-empaque'] });
    },
  });
};

/**
 * Hook para obtener correos de empaque actuales desde DB
 */
export const useCorreosEmpaque = () => {
  return useQuery({
    queryKey: ['config', 'correos-empaque'],
    queryFn: () => configService.getCorreos(),
    staleTime: 1000 * 60 * 5,
  });
};

/**
 * Hook para obtener el costo del agua
 */
export const useCostoAgua = () => {
  return useQuery({
    queryKey: ['config', 'costo-agua'],
    queryFn: () => configService.getCostoAgua(),
  });
};

/**
 * Hook para actualizar el costo del agua por litro
 */
export const useUpdateCostoAgua = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (costo: number) => configService.updateCostoAgua(costo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config', 'costo-agua'] });
    },
  });
};

/**
 * Hook para obtener el costo del Agua 2 (MP0008)
 */
export const useCostoAgua2 = () => {
  return useQuery({
    queryKey: ['config', 'costo-agua2'],
    queryFn: () => configService.getCostoAgua2(),
  });
};

/**
 * Hook para actualizar el costo del Agua 2 (MP0008) por litro
 */
export const useUpdateCostoAgua2 = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (costo: number) => configService.updateCostoAgua2(costo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config', 'costo-agua2'] });
    },
  });
};
export const useCatalogoTiposMasa = () => {
  return useQuery({
    queryKey: ['catalogo-tipos-masa'],
    queryFn: () => configService.getCatalogoTiposMasa(),
    staleTime: 1000 * 60 * 5,
  });
};
export const useAmasadoras = () => {
  return useQuery({
    queryKey: ['amasadoras'],
    queryFn: () => configService.getAmasadoras(),
    staleTime: 1000 * 60 * 5,
  });
};
export const useMaquinasCorte = () => {
  return useQuery({
    queryKey: ['maquinas-corte'],
    queryFn: () => configService.getMaquinasCorte(),
    staleTime: 1000 * 60 * 5,
  });
};
export const useUpdateTipoMasaFormado = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, requiere_formado }: { id: number; requiere_formado: boolean }) =>
      configService.updateTipoMasaFormado(id, requiere_formado),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalogo-tipos-masa'] });
    },
  });
};
