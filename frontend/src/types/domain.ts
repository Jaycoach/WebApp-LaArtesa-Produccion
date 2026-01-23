/**
 * Tipos del dominio de negocio
 */

// Usuario
export interface Usuario {
  id: string;
  username: string;
  nombre: string;
  rol: 'admin' | 'operador' | 'supervisor';
  email?: string;
  activo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Masa
export interface Masa {
  id: string;
  nombre: string;
  codigoMasa: string;
  fecha: Date;
  turno: 'mañana' | 'tarde' | 'noche';
  estado: 'pendiente' | 'en_proceso' | 'completada' | 'cancelada';
  pesoTotal: number;
  numeroAmasadas?: number;
  observaciones?: string;
  createdAt: Date;
  updatedAt: Date;

  // Relaciones
  productos?: Producto[];
  composicion?: ComposicionIngrediente[];
  checklist?: ChecklistPesaje;
  progreso?: ProgresoFases;
}

// Producto
export interface Producto {
  id: string;
  masaId: string;
  nombre: string;
  codigo: string;
  cantidad: number;
  unidad: 'kg' | 'unidades' | 'piezas';
  pesoUnitario?: number;
  ordenSAP?: string;
  cliente?: string;
  observaciones?: string;
}

// Ingrediente
export interface Ingrediente {
  id: string;
  nombre: string;
  codigo: string;
  tipo: 'harina' | 'agua' | 'sal' | 'levadura' | 'otro';
  unidad: 'kg' | 'g' | 'ml' | 'l';
  stockActual?: number;
  stockMinimo?: number;
}

// Composición de ingredientes
export interface ComposicionIngrediente {
  id: string;
  masaId: string;
  ingredienteId: string;
  ingrediente?: Ingrediente;
  cantidad: number;
  porcentaje?: number;
  orden: number;
}

// Checklist de pesaje
export interface ChecklistPesaje {
  id: string;
  masaId: string;
  verificacionBalanza: boolean;
  limpiezaEquipo: boolean;
  disponibilidadIngredientes: boolean;
  revisionReceta: boolean;
  temperaturaAmbiente?: number;
  humedadAmbiente?: number;
  observaciones?: string;
  verificadoPor?: string;
  fechaVerificacion?: Date;
  completado: boolean;
}

// Progreso de fases
export interface ProgresoFases {
  id: string;
  masaId: string;

  // Fase 1: Pesaje
  pesajeIniciado: boolean;
  pesajeCompletado: boolean;
  pesajeFechaInicio?: Date;
  pesajeFechaFin?: Date;
  pesajeResponsable?: string;

  // Fase 2: Amasado
  amasadoIniciado: boolean;
  amasadoCompletado: boolean;
  amasadoFechaInicio?: Date;
  amasadoFechaFin?: Date;
  amasadoResponsable?: string;
  amasadoTiempo?: number; // minutos
  amasadoTemperatura?: number;

  // Fase 3: División
  divisionIniciada: boolean;
  divisionCompletada: boolean;
  divisionFechaInicio?: Date;
  divisionFechaFin?: Date;
  divisionResponsable?: string;
  divisionNumPiezas?: number;

  // Fase 4: Formado
  formadoIniciado: boolean;
  formadoCompletado: boolean;
  formadoFechaInicio?: Date;
  formadoFechaFin?: Date;
  formadoResponsable?: string;

  // Fase 5: Fermentación
  fermentacionIniciada: boolean;
  fermentacionCompletada: boolean;
  fermentacionFechaInicio?: Date;
  fermentacionFechaFin?: Date;
  fermentacionResponsable?: string;
  fermentacionTiempo?: number; // minutos
  fermentacionTemperatura?: number;
  fermentacionHumedad?: number;

  // Fase 6: Horneado
  horneadoIniciado: boolean;
  horneadoCompletado: boolean;
  horneadoFechaInicio?: Date;
  horneadoFechaFin?: Date;
  horneadoResponsable?: string;
  horneadoTemperatura?: number;
  horneadoTiempo?: number; // minutos

  // General
  faseActual: 'pesaje' | 'amasado' | 'division' | 'formado' | 'fermentacion' | 'horneado' | 'completado';
  observaciones?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Configuración del sistema
export interface ConfiguracionSistema {
  id: string;
  factorAbsorcion: number;
  temperaturaAmbienteMin: number;
  temperaturaAmbienteMax: number;
  humedadMin: number;
  humedadMax: number;
  emailNotificaciones: string[];
  turnoMañanaInicio: string; // HH:mm
  turnoMañanaFin: string;
  turnoTardeInicio: string;
  turnoTardeFin: string;
  turnoNocheInicio: string;
  turnoNocheFin: string;
  updatedAt: Date;
  updatedBy?: string;
}

// Orden SAP
export interface OrdenSAP {
  id: string;
  numeroOrden: string;
  cliente: string;
  fechaEntrega: Date;
  estado: 'pendiente' | 'en_proceso' | 'completada' | 'cancelada';
  productos: ProductoOrdenSAP[];
  sincronizado: boolean;
  fechaSincronizacion?: Date;
}

export interface ProductoOrdenSAP {
  codigo: string;
  nombre: string;
  cantidad: number;
  unidad: string;
  pesoUnitario?: number;
}

// Estadísticas
export interface EstadisticasProduccion {
  fecha: Date;
  totalMasas: number;
  masasCompletadas: number;
  masasEnProceso: number;
  masasPendientes: number;
  pesoTotalProducido: number;
  tiempoPromedioProduccion: number; // minutos
  eficiencia: number; // porcentaje
}
