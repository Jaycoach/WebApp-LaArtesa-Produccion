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
  // Errores de validación por campo (ej. POST /users con createUserValidation) —
  // backend/src/validators/user.validator.js: errors.array().map(err => ({field, message}))
  errors?: { field: string; message: string }[];
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
  total_kilos_pesado_real: number;
  porcentaje_merma: number;
  total_ordenes: number;
  total_productos: number;
  total_unidades_pedidas: number;
  total_unidades_programadas: number;
  total_panes?: number;
  division_completada_total?: boolean;
  total_panes_cortados?: number;
  productos_resumen?: {
    producto_nombre: string;
    sap_item_code: string | null;
    unidades_por_paquete: number;
    cantidad_paquetes: number;
    unidades_producidas?: number;
    division_completada?: boolean;
    apto_produccion?: boolean;
    campos_incompletos?: string[] | null;
  }[];
  es_repeticion: boolean;
  es_adicional?: boolean;
  prioridad?: boolean;
  es_subdivision?: boolean;
  sap_doc_entry_pesaje?: number | null;
  masa_adicional_referencia_id?: number | null;
  lote_produccion?: string;
  numeros_ov?: string[];
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
  sap_item_code?: string;
  producto_nombre: string;
  presentacion: string;
  gramaje_unitario: number;
  peso_masa_dividida?: number | null;
  unidades_pedidas: number;
  unidades_programadas: number;
  unidades_producidas: number;
  unidades_ajustadas?: number;
  unidades_excedente?: number;
  kilos_pedidos: number;
  kilos_programados: number;
  kilos_producidos: number;
  unidades_por_paquete: number;
  cantidad_paquetes: number;
  apto_produccion?: boolean;
  campos_incompletos?: string[] | null;
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
  // Lotes SAP disponibles para este ítem (sap_lotes_mp), distinto de `lote` (el
  // lote único legado) — backend/src/controllers/pesaje.controller.js getChecklist
  lotes?: {
    item_code: string;
    batch: string;
    status?: string;
    admission_date?: string | null;
    expiration_date?: string | null;
    cantidad_disponible: number;
  }[];
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
  codigo_masa: string;
  tipo_masa: string;
  fase_actual?: string;
  es_repeticion: boolean;
  fecha_inicio?: string;
  usuario_responsable?: string;
  ingredientes: IngredienteMasa[];
  todosDisponibles: boolean;
  todosVerificados: boolean;
  todosPesados: boolean;
  completado: boolean;
  progreso: number; // 0-100
  productos_con_ajuste?: any[];
  hay_ajustes_divisor?: boolean;
  pesaje_transmitido?: boolean;
  pesaje_completado: boolean;
  sap_doc_num_pesaje?: number | null;
  sin_stock_count: number;
  ingredientes_sin_stock?: string[];
  productos_resumen?: {
    producto_nombre: string;
    sap_item_code: string;
    unidades_pedidas: number;
    unidades_por_paquete: number;
    panes_totales: number;
  }[];
}

export interface LoteConsumo {
  batch: string;
  cantidad_kg: number;
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
  lotes_consumo?: LoteConsumo[];
}

export interface LoteFallidoInfo {
  lote_fallido: string | null;
  disponible: number | null;
  lotes_actuales: { batch: string; cantidad_disponible: number; expiration_date?: string }[];
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
  sap_doc_num?: number | null;
  sap_doc_entry?: number | null;
}

// Response de sincronización SAP
export interface SincronizacionSAPResponse {
  success: boolean;
  masas_creadas: number;
  ordenes_procesadas: number;
  errores?: string[];
  message: string;
}

// Response de sincronización BOM (listas de materiales)
export interface SincronizacionBOMResponse {
  articulos_procesados: number;
  bom_sincronizados: number;
  sin_bom: number;
  errores?: Array<{ itemCode: string; error: string }>;
  item_codes_no_encontrados?: string[];
}

export interface SincronizacionInventarioMPResponse {
  sincronizados: number;
  lotes_sincronizados: number;
  articulos_pt_actualizados: number;
}

export interface SincronizacionLotesItemResponse {
  itemCodesProcesados: string[];
  lotesSincronizados: number;
  detallePorItem: Record<string, number>;
  itemCodesSinLotesEncontrados: string[];
  itemCodesInvalidos: string[];
  itemCodesSinBatch: string[];
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

// ─────────────────────────────────────────────
// Respuesta de completar fase (con subdivisión)
// ─────────────────────────────────────────────

export interface SubMasaInfo {
  id: number;
  codigo: string;
  letra: 'A' | 'B';
}

export interface SubdivisionInfo {
  realizada: boolean;
  motivo: string;
  limite_kg: number;
  total_kg: number;
  n_tandas: number;
  kg_por_tanda: number;
  masa_padre_id: number;
  sub_masas: SubMasaInfo[];
}

export interface CompletarFaseResponse {
  success: boolean;
  message: string;
  data?: unknown;
  siguiente_fase?: unknown;
  subdivision: SubdivisionInfo | null;
  ingredientes_generados?: number;
}