// frontend/src/types/api.ts

/**
 * Tipos para respuestas de la API
 */

// Estructura base de respuestas
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

// Respuesta con paginación
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Configuración del sistema
export interface FactorAbsorcionConfig {
  factor: number;
  updated_at: string;
  updated_by?: string;
}

export interface CorreosEmpaque {
  correos: string[];
}

// Masa de producción (resumen para lista)
export interface MasaProduccionResumen {
  id: number;
  codigo_masa: string;
  tipo_masa: string;
  nombre_masa: string;
  fecha_produccion: string;
  estado: string;
  fase_actual: string;
  total_kilos_base: number;
  total_kilos_con_merma: number;
  porcentaje_merma: number;
  total_ordenes: number;
  total_productos: number;
  total_unidades_pedidas: number;
  total_unidades_programadas: number;
}

// Masa de producción (detalle completo)
export interface MasaProduccionDetalle extends MasaProduccionResumen {
  factor_absorcion_usado: number;
  fase_bloqueada: boolean;
  created_at: string;
  updated_at: string;
  created_by?: number;
}

// Producto de una masa
export interface ProductoMasa {
  id: number;
  masa_id: number;
  producto_codigo: string;
  producto_nombre: string;
  presentacion: string;
  gramaje_unitario: number;
  unidades_pedidas: number;
  unidades_programadas: number;
  unidades_producidas: number;
  kilos_pedidos: number;
  kilos_programados: number;
  kilos_producidos: number;
}

// Ingrediente de una masa
export interface IngredienteMasa {
  id: number;
  masa_id: number;
  ingrediente_sap_code?: string;
  ingrediente_nombre: string;
  orden_visualizacion: number;
  porcentaje_panadero: number;
  es_harina: boolean;
  es_agua: boolean;
  es_prefermento: boolean;
  cantidad_gramos: number;
  cantidad_kilos: number;
  // Campos de checklist
  disponible: boolean;
  verificado: boolean;
  pesado: boolean;
  peso_real?: number;
  diferencia_gramos?: number;
  lote?: string;
  fecha_vencimiento?: string;
  observaciones?: string;
  usuario_peso?: number;
  timestamp_peso?: string;
}

// Progreso de fase
export interface ProgresoFase {
  id: number;
  masa_id: number;
  fase: string;
  estado: string; // BLOQUEADA, EN_PROGRESO, COMPLETADA, REQUIERE_ATENCION
  porcentaje_completado: number;
  fecha_inicio?: string;
  fecha_completado?: string;
  datos_fase?: Record<string, any>;
  usuario_responsable?: number;
  observaciones?: string;
}

// Checklist de pesaje
export interface ChecklistPesaje {
  masa_id: number;
  tipo_masa: string;
  fecha_inicio?: string;
  usuario_responsable?: string;
  ingredientes: IngredienteMasa[];
  todosDisponibles: boolean;
  todosVerificados: boolean;
  todosPesados: boolean;
  completado: boolean;
  progreso: number; // 0-100
}

// Request para actualizar ingrediente
export interface UpdateIngredienteRequest {
  disponible?: boolean;
  verificado?: boolean;
  pesado?: boolean;
  peso_real?: number;
  lote?: string;
  fecha_vencimiento?: string;
  observaciones?: string;
}

// Request para actualizar unidades programadas
export interface UpdateUnidadesProgramadasRequest {
  unidades_programadas: number;
}

// Response de confirmación de pesaje
export interface ConfirmarPesajeResponse {
  success: boolean;
  fase_desbloqueada: string;
  message: string;
}

// Response de sincronización SAP
export interface SincronizacionSAPResponse {
  success: boolean;
  masas_creadas: number;
  ordenes_procesadas: number;
  errores?: string[];
  message: string;
}

// Response de envío de correo
export interface EnvioCorreoResponse {
  enviado: boolean;
  destinatarios: string[];
  fecha_envio: string;
}

// Request para actualizar progreso de fase
export interface UpdateProgresoFaseRequest {
  fase: string;
  accion: 'iniciar' | 'actualizar' | 'completar';
  datos?: Record<string, any>;
}

// Request para completar una fase
export interface CompletarFaseRequest {
  responsable?: string;
  observaciones?: string;
  datos?: Record<string, any>;
}

// Request para actualizar configuración
export interface UpdateConfiguracionRequest {
  factorAbsorcion?: number;
  emailNotificaciones?: string[];
  temperaturaAmbienteMin?: number;
  temperaturaAmbienteMax?: number;
  humedadMin?: number;
  humedadMax?: number;
}