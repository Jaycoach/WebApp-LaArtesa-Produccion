/**
 * Store para estado global de producción con Zustand
 */
import { create } from 'zustand';
import type { Masa } from '@/types';

interface ProduccionState {
  // Masa actual seleccionada
  masaActual: Masa | null;

  // Fecha y turno seleccionados
  fechaSeleccionada: string; // YYYY-MM-DD
  turnoSeleccionado: 'mañana' | 'tarde' | 'noche' | null;

  // Filtros y vistas
  estadoFiltro: 'todos' | 'pendiente' | 'en_proceso' | 'completada' | 'cancelada';
  vistaActual: 'lista' | 'calendario' | 'kanban';

  // Modal/Dialog states
  modalCrearMasaAbierto: boolean;
  modalEditarMasaAbierto: boolean;
  modalEliminarMasaAbierto: boolean;

  // Acciones
  setMasaActual: (masa: Masa | null) => void;
  setFechaSeleccionada: (fecha: string) => void;
  setTurnoSeleccionado: (turno: 'mañana' | 'tarde' | 'noche' | null) => void;
  setEstadoFiltro: (estado: 'todos' | 'pendiente' | 'en_proceso' | 'completada' | 'cancelada') => void;
  setVistaActual: (vista: 'lista' | 'calendario' | 'kanban') => void;
  toggleModalCrearMasa: () => void;
  toggleModalEditarMasa: () => void;
  toggleModalEliminarMasa: () => void;
  resetFiltros: () => void;
}

// Función para obtener la fecha actual en formato YYYY-MM-DD
const getCurrentDate = (): string => {
  const now = new Date();
  return now.toISOString().split('T')[0];
};

// Función para obtener el turno actual basado en la hora
const getCurrentTurno = (): 'mañana' | 'tarde' | 'noche' => {
  const hour = new Date().getHours();

  if (hour >= 6 && hour < 14) {
    return 'mañana';
  } else if (hour >= 14 && hour < 22) {
    return 'tarde';
  } else {
    return 'noche';
  }
};

export const useProduccionStore = create<ProduccionState>((set) => ({
  // Estado inicial
  masaActual: null,
  fechaSeleccionada: getCurrentDate(),
  turnoSeleccionado: getCurrentTurno(),
  estadoFiltro: 'todos',
  vistaActual: 'lista',
  modalCrearMasaAbierto: false,
  modalEditarMasaAbierto: false,
  modalEliminarMasaAbierto: false,

  // Acciones
  setMasaActual: (masa) => set({ masaActual: masa }),

  setFechaSeleccionada: (fecha) => set({ fechaSeleccionada: fecha }),

  setTurnoSeleccionado: (turno) => set({ turnoSeleccionado: turno }),

  setEstadoFiltro: (estado) => set({ estadoFiltro: estado }),

  setVistaActual: (vista) => set({ vistaActual: vista }),

  toggleModalCrearMasa: () =>
    set((state) => ({ modalCrearMasaAbierto: !state.modalCrearMasaAbierto })),

  toggleModalEditarMasa: () =>
    set((state) => ({ modalEditarMasaAbierto: !state.modalEditarMasaAbierto })),

  toggleModalEliminarMasa: () =>
    set((state) => ({ modalEliminarMasaAbierto: !state.modalEliminarMasaAbierto })),

  resetFiltros: () =>
    set({
      estadoFiltro: 'todos',
      fechaSeleccionada: getCurrentDate(),
      turnoSeleccionado: getCurrentTurno(),
    }),
}));
