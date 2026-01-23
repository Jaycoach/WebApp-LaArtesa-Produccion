/**
 * Hook para gestión de configuración con React Query
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { configService } from '@/services';
import type { ConfiguracionSistema, UpdateConfiguracionRequest } from '@/types';

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
      queryClient.invalidateQueries({ queryKey: configKeys.detail() });
    },
  });
};
