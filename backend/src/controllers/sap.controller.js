/**
 * Controlador para integración con SAP Business One
 * Sincronización de órdenes de fabricación y agrupación por masas
 */

const db = require('../database/connection');
const sapService = require('../services/sap.service');
const logger = require('../utils/logger');

/**
 * @desc    Sincronizar órdenes desde SAP y crear masas de producción
 * @route   POST /api/sap/sincronizar
 * @access  Private (Admin/Supervisor)
 */
const sincronizarSAP = async (req, res, next) => {
  const client = await db.getClient();

  try {
    const { fecha, forzar } = req.body;
    const fechaProduccion = fecha || new Date().toISOString().split('T')[0];

    logger.info(`Iniciando sincronización SAP para fecha: ${fechaProduccion}`);

    await client.query('BEGIN');

    // 1. Verificar si ya existen masas para esta fecha
    if (!forzar) {
      const existenQuery = `
        SELECT COUNT(*) as count
        FROM masas_produccion
        WHERE DATE(fecha_produccion) = $1
      `;
      const existenResult = await client.query(existenQuery, [fechaProduccion]);

      if (parseInt(existenResult.rows[0].count) > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Ya existen masas para esta fecha. Use forzar=true para sobrescribir.',
          data: {
            masas_existentes: parseInt(existenResult.rows[0].count)
          }
        });
      }
    }

    // 2. Obtener órdenes de fabricación desde SAP
    const ordenesSAP = await sapService.getOrdenesProduccion({
      fecha: fechaProduccion,
      estado: 'boposReleased' // Solo órdenes liberadas (Released)
    });

    if (ordenesSAP.length === 0) {
      await client.query('ROLLBACK');
      return res.json({
        success: true,
        message: 'No se encontraron órdenes de fabricación en SAP para esta fecha',
        data: {
          ordenes_procesadas: 0,
          masas_creadas: 0
        }
      });
    }

    logger.info(`Se encontraron ${ordenesSAP.length} órdenes en SAP`);

    // 3. Obtener factor de absorción actual
    const factorQuery = `
      SELECT valor FROM configuracion_sistema WHERE clave = 'factor_absorcion_harina'
    `;
    const factorResult = await client.query(factorQuery);
    const factorAbsorcion = parseFloat(factorResult.rows[0]?.valor || 60);

    // 4. Agrupar órdenes por tipo de masa
    const masasAgrupadas = {};
    const ordenesNoMapeadas = [];

    for (const orden of ordenesSAP) {
      // Buscar tipo de masa en catálogo
      const tipoMasaQuery = `
        SELECT tipo_masa, nombre_masa, requiere_reposo_pre_division, requiere_formado, requiere_camara_frio
        FROM catalogo_tipos_masa
        WHERE codigo_sap = $1 AND activo = TRUE
      `;
      const tipoMasaResult = await client.query(tipoMasaQuery, [orden.ItemNo]);

      if (tipoMasaResult.rows.length === 0) {
        ordenesNoMapeadas.push({
          docEntry: orden.AbsoluteEntry,
          docNum: orden.DocumentNumber,
          itemCode: orden.ItemNo,
          descripcion: orden.ItemNo
        });
        logger.warn(`Orden ${orden.DocumentNumber} (${orden.ItemNo}) no tiene tipo de masa mapeado`);
        continue;
      }

      const tipoMasa = tipoMasaResult.rows[0].tipo_masa;
      const nombreMasa = tipoMasaResult.rows[0].nombre_masa;

      // Agrupar por tipo de masa
      if (!masasAgrupadas[tipoMasa]) {
        masasAgrupadas[tipoMasa] = {
          tipo_masa: tipoMasa,
          nombre_masa: nombreMasa,
          ordenes: [],
          total_kilos: 0,
          requiere_reposo_pre_division: tipoMasaResult.rows[0].requiere_reposo_pre_division,
          requiere_formado: tipoMasaResult.rows[0].requiere_formado,
          requiere_camara_frio: tipoMasaResult.rows[0].requiere_camara_frio
        };
      }

      masasAgrupadas[tipoMasa].ordenes.push(orden);
      masasAgrupadas[tipoMasa].total_kilos += parseFloat(orden.PlannedQuantity || 0);
    }

    // 5. Crear masas de producción
    const masasCreadas = [];
    let ordenCounter = 1;

    for (const tipoMasa in masasAgrupadas) {
      const grupo = masasAgrupadas[tipoMasa];
      const codigoMasa = `MASA-${fechaProduccion.replace(/-/g, '')}-${String(ordenCounter).padStart(3, '0')}`;

      // Calcular merma (configuración por defecto: 5%)
      const porcentajeMerma = 5.0;
      const totalKilosConMerma = grupo.total_kilos * (1 + porcentajeMerma / 100);

      // Crear masa de producción
      const insertMasaQuery = `
        INSERT INTO masas_produccion (
          codigo_masa,
          tipo_masa,
          nombre_masa,
          fecha_produccion,
          total_kilos_base,
          total_kilos_con_merma,
          porcentaje_merma,
          factor_absorcion_usado,
          estado,
          fase_actual
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PLANIFICACION', 'PLANIFICACION')
        RETURNING id, uuid
      `;

      const masaResult = await client.query(insertMasaQuery, [
        codigoMasa,
        grupo.tipo_masa,
        grupo.nombre_masa,
        fechaProduccion,
        grupo.total_kilos,
        totalKilosConMerma,
        porcentajeMerma,
        factorAbsorcion
      ]);

      const masaId = masaResult.rows[0].id;

      // Insertar relación con órdenes SAP
      for (const orden of grupo.ordenes) {
        await client.query(
          `INSERT INTO orden_masa_relacion (masa_id, orden_sap_docentry, orden_sap_docnum)
           VALUES ($1, $2, $3)`,
          [masaId, orden.AbsoluteEntry, orden.DocumentNumber]
        );

        // Insertar productos por masa
        await client.query(
          `INSERT INTO productos_por_masa (
             masa_id, producto_codigo, producto_nombre, presentacion,
             unidades_pedidas, unidades_programadas, kilos_pedidos, kilos_programados
           ) VALUES ($1, $2, $3, $4, $5, $5, $6, $6)`,
          [
            masaId,
            orden.ItemNo,
            orden.ItemNo,
            'Por definir',
            parseFloat(orden.PlannedQuantity || 0),
            parseFloat(orden.PlannedQuantity || 0)
          ]
        );
      }

      // Obtener ingredientes de la primera orden (todas deberían tener la misma receta)
      const primeraOrden = grupo.ordenes[0];
      const ingredientes = await sapService.getListaMateriales(primeraOrden.AbsoluteEntry);

      // Insertar ingredientes escalados al total de la masa
      let ordenVisualizacion = 1;
      for (const ingrediente of ingredientes) {
        // Escalar cantidad al total de la masa
        const cantidadPorOrden = parseFloat(ingrediente.PlannedQuantity || 0);
        const cantidadTotal = (cantidadPorOrden / grupo.ordenes[0].PlannedQuantity) * totalKilosConMerma;

        const esHarina = ingrediente.ItemName?.toLowerCase().includes('harina') || false;
        const esAgua = ingrediente.ItemName?.toLowerCase().includes('agua') || false;
        const esPrefermento = ingrediente.ItemName?.toLowerCase().includes('prefermento') || false;

        await client.query(
          `INSERT INTO ingredientes_masa (
             masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
             es_harina, es_agua, es_prefermento, cantidad_gramos, cantidad_kilos
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            masaId,
            ingrediente.ItemCode,
            ingrediente.ItemName,
            ordenVisualizacion++,
            esHarina,
            esAgua,
            esPrefermento,
            cantidadTotal * 1000, // Convertir a gramos
            cantidadTotal
          ]
        );
      }

      // Crear registros de progreso para todas las fases
      const fases = ['PLANIFICACION', 'PESAJE', 'AMASADO', 'DIVISION', 'FORMADO', 'FERMENTACION', 'HORNEADO'];
      for (let i = 0; i < fases.length; i++) {
        const fase = fases[i];
        // PLANIFICACION inicia EN_PROGRESO, las demás bloqueadas
        const estado = i === 0 ? 'EN_PROGRESO' : 'BLOQUEADA';

        await client.query(
          `INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado)
           VALUES ($1, $2, $3, 0)`,
          [masaId, fase, estado]
        );
      }

      masasCreadas.push({
        id: masaId,
        uuid: masaResult.rows[0].uuid,
        codigo: codigoMasa,
        tipo_masa: grupo.tipo_masa,
        nombre: grupo.nombre_masa,
        ordenes: grupo.ordenes.length,
        kilos_total: totalKilosConMerma
      });

      ordenCounter++;
    }

    await client.query('COMMIT');

    // Registrar en log de sincronización
    await db.query(
      `INSERT INTO sap_sync_log (tipo_operacion, estado, request_payload, response_payload)
       VALUES ('ORDENES_PRODUCCION', 'SUCCESS', $1, $2)`,
      [
        JSON.stringify({ fecha: fechaProduccion }),
        JSON.stringify({
          ordenes_procesadas: ordenesSAP.length,
          masas_creadas: masasCreadas.length,
          ordenes_no_mapeadas: ordenesNoMapeadas.length
        })
      ]
    );

    logger.info(`Sincronización completada: ${masasCreadas.length} masas creadas`);

    res.json({
      success: true,
      message: 'Sincronización completada exitosamente',
      data: {
        fecha_produccion: fechaProduccion,
        ordenes_procesadas: ordenesSAP.length,
        masas_creadas: masasCreadas.length,
        ordenes_no_mapeadas: ordenesNoMapeadas.length,
        masas: masasCreadas,
        advertencias: ordenesNoMapeadas.length > 0 ? [
          `${ordenesNoMapeadas.length} órdenes no pudieron ser mapeadas a un tipo de masa`
        ] : [],
        ordenes_sin_mapeo: ordenesNoMapeadas
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error en sincronización SAP:', error);

    // Registrar error en log
    await db.query(
      `INSERT INTO sap_sync_log (tipo_operacion, estado, error_message)
       VALUES ('ORDENES_PRODUCCION', 'ERROR', $1)`,
      [error.message]
    ).catch(err => logger.error('Error al guardar log:', err));

    res.status(500).json({
      success: false,
      message: 'Error al sincronizar con SAP',
      error: error.message
    });
  } finally {
    client.release();
  }
};

/**
 * @desc    Obtener órdenes de SAP sin sincronizar
 * @route   GET /api/sap/ordenes
 * @access  Private
 */
const getOrdenes = async (req, res, next) => {
  try {
    const { fecha, estado } = req.query;

    const ordenes = await sapService.getOrdenesProduccion({ fecha, estado });

    res.json({
      success: true,
      data: ordenes,
      count: ordenes.length
    });
  } catch (error) {
    logger.error('Error al obtener órdenes de SAP:', error);
    res.status(500).json({
      success: false,
      message: 'Error al consultar SAP',
      error: error.message
    });
  }
};

/**
 * @desc    Verificar disponibilidad de stock para una masa
 * @route   GET /api/sap/stock/:masaId
 * @access  Private
 */
const verificarStock = async (req, res, next) => {
  try {
    const { masaId } = req.params;

    // Obtener ingredientes de la masa
    const ingredientesQuery = `
      SELECT ingrediente_sap_code, ingrediente_nombre, cantidad_kilos
      FROM ingredientes_masa
      WHERE masa_id = $1
      ORDER BY orden_visualizacion
    `;
    const ingredientesResult = await db.query(ingredientesQuery, [masaId]);

    if (ingredientesResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Masa no encontrada o sin ingredientes'
      });
    }

    // Verificar stock de cada ingrediente en SAP
    const stockInfo = [];
    for (const ingrediente of ingredientesResult.rows) {
      try {
        const stock = await sapService.verificarStock(ingrediente.ingrediente_sap_code, 'MP01'); // Bodega MP
        stockInfo.push({
          codigo: ingrediente.ingrediente_sap_code,
          nombre: ingrediente.ingrediente_nombre,
          cantidad_requerida: ingrediente.cantidad_kilos,
          stock: stock,
          suficiente: stock.disponible >= ingrediente.cantidad_kilos
        });
      } catch (error) {
        stockInfo.push({
          codigo: ingrediente.ingrediente_sap_code,
          nombre: ingrediente.ingrediente_nombre,
          cantidad_requerida: ingrediente.cantidad_kilos,
          error: error.message
        });
      }
    }

    const todoDisponible = stockInfo.every(item => item.suficiente === true);

    res.json({
      success: true,
      data: {
        masa_id: masaId,
        todo_disponible: todoDisponible,
        ingredientes: stockInfo
      }
    });
  } catch (error) {
    logger.error('Error al verificar stock:', error);
    res.status(500).json({
      success: false,
      message: 'Error al verificar disponibilidad de stock',
      error: error.message
    });
  }
};

/**
 * @desc    Obtener histórico de sincronizaciones
 * @route   GET /api/sap/historial
 * @access  Private
 */
const getHistorialSync = async (req, res, next) => {
  try {
    const { limit = 50 } = req.query;

    const query = `
      SELECT
        id,
        tipo_operacion,
        estado,
        error_message,
        request_payload,
        response_payload,
        fecha_operacion
      FROM sap_sync_log
      ORDER BY fecha_operacion DESC
      LIMIT $1
    `;

    const result = await db.query(query, [limit]);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    logger.error('Error al obtener historial:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener historial de sincronizaciones',
      error: error.message
    });
  }
};

/**
 * @desc    Sincronización DEMO (sin SAP real) - Para demos y desarrollo
 * @route   POST /api/sap/sincronizar-demo
 * @access  Private (Admin/Supervisor)
 */
const sincronizarDemo = async (req, res, next) => {
  const client = await db.getClient();

  try {
    const { fecha } = req.body;
    const fechaProduccion = fecha || new Date().toISOString().split('T')[0];

    logger.info(`Iniciando sincronización DEMO para fecha: ${fechaProduccion}`);

    await client.query('BEGIN');

    // Datos de órdenes simuladas
    const ordenesSimuladas = [
      {
        AbsoluteEntry: 1001,
        DocumentNumber: '1001',
        ItemNo: 'HAMB-GOLD-6',
        PlannedQuantity: 50,
        ProductionOrderStatus: 'boposReleased'
      },
      {
        AbsoluteEntry: 1002,
        DocumentNumber: '1002',
        ItemNo: 'HAMB-GOLD-12',
        PlannedQuantity: 30,
        ProductionOrderStatus: 'boposReleased'
      },
      {
        AbsoluteEntry: 1003,
        DocumentNumber: '1003',
        ItemNo: 'PAN-ARABE-6',
        PlannedQuantity: 100,
        ProductionOrderStatus: 'boposReleased'
      }
    ];

    logger.info(`Se simularon ${ordenesSimuladas.length} órdenes`);

    // Obtener factor de absorción actual
    const factorQuery = `
      SELECT valor FROM configuracion_sistema WHERE clave = 'factor_absorcion_harina'
    `;
    const factorResult = await client.query(factorQuery);
    const factorAbsorcion = parseFloat(factorResult.rows[0]?.valor || 60);

    // Mapeo simulado de tipos de masa
    const tiposMasaMap = {
      'HAMB-GOLD-6': { tipo: 'GOLD', nombre: 'Hamburguesa Gold' },
      'HAMB-GOLD-12': { tipo: 'GOLD', nombre: 'Hamburguesa Gold' },
      'PAN-ARABE-6': { tipo: 'ARABE', nombre: 'Pan Árabe' }
    };

    // Agrupar órdenes por tipo de masa
    const masasAgrupadas = {};

    for (const orden of ordenesSimuladas) {
      const tipoInfo = tiposMasaMap[orden.ItemNo];
      if (!tipoInfo) continue;

      if (!masasAgrupadas[tipoInfo.tipo]) {
        masasAgrupadas[tipoInfo.tipo] = {
          tipo_masa: tipoInfo.tipo,
          nombre_masa: tipoInfo.nombre,
          ordenes: [],
          total_kilos: 0
        };
      }

      masasAgrupadas[tipoInfo.tipo].ordenes.push(orden);
      masasAgrupadas[tipoInfo.tipo].total_kilos += parseFloat(orden.PlannedQuantity);
    }

    // Crear masas de producción
    const masasCreadas = [];
    let ordenCounter = 1;

    for (const tipoMasa in masasAgrupadas) {
      const grupo = masasAgrupadas[tipoMasa];
      const codigoMasa = `MASA-${fechaProduccion.replace(/-/g, '')}-${tipoMasa}-${ordenCounter}`;

      const porcentajeMerma = 5.0;
      const totalKilosConMerma = grupo.total_kilos * (1 + porcentajeMerma / 100);

      // Crear masa de producción
      const insertMasaQuery = `
        INSERT INTO masas_produccion (
          codigo_masa,
          tipo_masa,
          nombre_masa,
          fecha_produccion,
          total_kilos_base,
          total_kilos_con_merma,
          porcentaje_merma,
          factor_absorcion_usado,
          estado,
          fase_actual,
          created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'EN_PROCESO', 'PESAJE', $9)
        RETURNING id, uuid
      `;

      const masaResult = await client.query(insertMasaQuery, [
        codigoMasa,
        grupo.tipo_masa,
        grupo.nombre_masa,
        fechaProduccion,
        grupo.total_kilos,
        totalKilosConMerma,
        porcentajeMerma,
        factorAbsorcion,
        req.user.id
      ]);

      const masaId = masaResult.rows[0].id;

      // Insertar productos por masa
      for (const orden of grupo.ordenes) {
        await client.query(
          `INSERT INTO productos_por_masa (
             masa_id, producto_codigo, producto_nombre, presentacion, gramaje_unitario,
             unidades_pedidas, unidades_programadas, kilos_pedidos, kilos_programados
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            masaId,
            orden.ItemNo,
            orden.ItemNo,
            'BOLSA_6',
            85, // Gramaje estimado
            parseFloat(orden.PlannedQuantity),
            parseFloat(orden.PlannedQuantity) * 1.05, // Con merma
            parseFloat(orden.PlannedQuantity) * 0.085,
            parseFloat(orden.PlannedQuantity) * 0.085 * 1.05
          ]
        );
      }

      // Insertar ingredientes simulados (básicos)
      const ingredientesBase = [
        { nombre: 'Harina Panadera 000', porcentaje: 100, esHarina: true },
        { nombre: 'Agua', porcentaje: 60, esAgua: true },
        { nombre: 'Sal', porcentaje: 2, esHarina: false },
        { nombre: 'Levadura Fresca', porcentaje: 3, esHarina: false },
        { nombre: 'Azúcar', porcentaje: 8, esHarina: false }
      ];

      let ordenVisualizacion = 1;
      for (const ing of ingredientesBase) {
        const cantidadGramos = (totalKilosConMerma * 1000 * ing.porcentaje) / 100;
        await client.query(
          `INSERT INTO ingredientes_masa (
             masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
             porcentaje_panadero, es_harina, es_agua, cantidad_gramos, cantidad_kilos
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            masaId,
            `MP-${ing.nombre.substring(0,3).toUpperCase()}-001`,
            ing.nombre,
            ordenVisualizacion++,
            ing.porcentaje,
            ing.esHarina || false,
            ing.esAgua || false,
            cantidadGramos,
            cantidadGramos / 1000
          ]
        );
      }

      // Crear registros de progreso
      const fases = ['PESAJE', 'AMASADO', 'DIVISION', 'FORMADO', 'FERMENTACION', 'HORNEADO'];
      for (let i = 0; i < fases.length; i++) {
        const fase = fases[i];
        const estado = i === 0 ? 'EN_PROGRESO' : 'BLOQUEADA';

        await client.query(
          `INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado, fecha_inicio)
           VALUES ($1, $2, $3, 0, $4)`,
          [masaId, fase, estado, i === 0 ? new Date() : null]
        );
      }

      masasCreadas.push({
        id: masaId,
        uuid: masaResult.rows[0].uuid,
        codigo: codigoMasa,
        tipo_masa: grupo.tipo_masa,
        nombre: grupo.nombre_masa,
        ordenes: grupo.ordenes.length,
        kilos_total: totalKilosConMerma
      });

      ordenCounter++;
    }

    await client.query('COMMIT');

    logger.info(`Sincronización DEMO completada: ${masasCreadas.length} masas creadas`);

    res.json({
      success: true,
      message: 'Sincronización DEMO completada exitosamente (sin conexión SAP real)',
      data: {
        fecha_produccion: fechaProduccion,
        ordenes_procesadas: ordenesSimuladas.length,
        masas_creadas: masasCreadas.length,
        masas: masasCreadas,
        modo: 'DEMO'
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error en sincronización DEMO:', error);

    res.status(500).json({
      success: false,
      message: 'Error al sincronizar en modo DEMO',
      error: error.message
    });
  } finally {
    client.release();
  }
};

/**
 * @desc    Sincronizar desde Órdenes de Venta SAP (OV → Empaque)
 *          Agrupa por U_JZ_Tipos_Masa y calcula Quantity × SalesQtyPerPackUnit
 * @route   POST /api/sap/sincronizar-ov
 * @access  Private (Admin/Supervisor)
 */
const sincronizarDesdeOV = async (req, res, next) => {
  const client = await db.getClient();

  try {
    const { fecha, forzar } = req.body;
    const fechaProduccion = fecha || new Date().toISOString().split('T')[0];

    logger.info(`Iniciando sincronización OV SAP para fecha: ${fechaProduccion}`);

    await client.query('BEGIN');

    // ─────────────────────────────────────────────────────────────────
    // LÓGICA NO-DESTRUCTIVA:
    // - forzar=true + masa en PLANIFICACION  → eliminar y recrear
    // - forzar=true + masa en otra fase      → PRESERVAR (no tocar)
    // - forzar=false                         → error si ya existen masas
    // ─────────────────────────────────────────────────────────────────
    let tiposMasaEnProceso = []; // tipos que ya avanzaron → no recrear
    let masasEliminadas = 0;

    if (forzar) {
      const masasExistentes = await client.query(
        `SELECT id, codigo_masa, tipo_masa, fase_actual, estado, masa_padre_id
         FROM masas_produccion
         WHERE DATE(fecha_produccion) = $1`,
        [fechaProduccion]
      );

      for (const masa of masasExistentes.rows) {
        const estaEnPlanificacion = masa.fase_actual === 'PLANIFICACION';
        const estadoEliminable = ['PLANIFICACION', 'CANCELADA', 'SUBDIVIDIDA'].includes(masa.estado);

        // Si es sub-masa, verificar que su padre no esté en producción
        let padreEnProduccion = false;
        if (masa.masa_padre_id) {
          const padreResult = await client.query(
            `SELECT estado, fase_actual FROM masas_produccion WHERE id = $1`,
            [masa.masa_padre_id]
          );
          if (padreResult.rows.length > 0) {
            const padre = padreResult.rows[0];
            padreEnProduccion = padre.fase_actual !== 'PLANIFICACION' ||
                                !['PLANIFICACION', 'CANCELADA', 'SUBDIVIDIDA'].includes(padre.estado);
          }
        }

        if (estaEnPlanificacion && estadoEliminable && !padreEnProduccion) {
          await client.query(
            `DELETE FROM masas_produccion WHERE id = $1`,
            [masa.id]
          );
          masasEliminadas++;
          logger.info(`Masa eliminada (${masa.estado}): ${masa.codigo_masa}`);
        } else {
          tiposMasaEnProceso.push(masa.tipo_masa);
          logger.info(`Masa PRESERVADA (${masa.fase_actual}/${masa.estado}): ${masa.codigo_masa}`);
        }
      }

      if (masasEliminadas > 0)
        logger.info(`${masasEliminadas} masas en PLANIFICACION eliminadas para ${fechaProduccion}`);
      if (tiposMasaEnProceso.length > 0)
        logger.info(`${tiposMasaEnProceso.length} masas preservadas (en producción): [${tiposMasaEnProceso.join(', ')}]`);

    } else {
      // forzar=false: lógica inteligente — no bloquear, sino agregar/crear según estado
      const existenResult = await client.query(
        `SELECT COUNT(*) as count FROM masas_produccion WHERE DATE(fecha_produccion) = $1`,
        [fechaProduccion]
      );
      // Si no existen masas, flujo normal (no hacer nada aquí)
      // Si existen, la lógica por tipo de masa se maneja más abajo en el loop
    }

    // 2. Obtener datos combinados OV + artículos desde SAP
    const productos = await sapService.getDatosParaSincronizacion(fechaProduccion);

    if (productos.length === 0) {
      await client.query('ROLLBACK');
      return res.json({
        success: true,
        message: 'No se encontraron OV abiertas en SAP para esta fecha',
        data: { productos_procesados: 0, masas_creadas: 0 }
      });
    }

    // 3. Obtener factor de absorción
    const factorResult = await client.query(
      `SELECT valor FROM configuracion_sistema WHERE clave = 'factor_absorcion_harina'`
    );
    const factorAbsorcion = parseFloat(factorResult.rows[0]?.valor || 60);

    // 4. Agrupar productos por tipoMasa
    const masasAgrupadas = {};
    for (const prod of productos) {
      if (!masasAgrupadas[prod.tipoMasa]) {
        masasAgrupadas[prod.tipoMasa] = { tipo_masa: prod.tipoMasa, productos: [] };
      }
      masasAgrupadas[prod.tipoMasa].productos.push(prod);
    }

    // 5. Crear masas de producción
    const masasCreadas = [];
    const masasOmitidas = [];
    let ordenCounter = 1;

    for (const tipoMasa in masasAgrupadas) {
      const grupo = masasAgrupadas[tipoMasa];

      // ── CONTROL ANTI-DUPLICACIÓN ─────────────────────────────────────
      // Verificar qué pares docEntry+itemCode ya están importados para esta fecha
      // (el control es por línea de OV, no por OV completa, porque una OV puede
      //  tener productos de múltiples tipos de masa)
      const docEntriesGrupo = [...new Set(grupo.productos.map(p => p.docEntry))];
      const yaImportadosResult = await client.query(
        `SELECT p.sap_doc_entry, p.sap_item_code
         FROM productos_por_masa p
         JOIN masas_produccion m ON p.masa_id = m.id
         WHERE DATE(m.fecha_produccion) = $1
           AND p.sap_doc_entry = ANY($2::int[])`,
        [fechaProduccion, docEntriesGrupo]
      );
      const yaImportadosSet = new Set(
        yaImportadosResult.rows.map(r => `${r.sap_doc_entry}__${r.sap_item_code}`)
      );
      // Filtrar solo productos cuyo par docEntry+itemCode NO esté importado aún
      const productosNuevos = grupo.productos.filter(
        p => !yaImportadosSet.has(`${p.docEntry}__${p.itemCode}`)
      );
      if (productosNuevos.length === 0) {
        logger.info(`Tipo ${tipoMasa} — todos los productos ya importados, omitiendo`);
        ordenCounter++;
        continue;
      }
      // Trabajar solo con los productos nuevos
      grupo.productos = productosNuevos;
      // ─────────────────────────────────────────────────────────────────

      // Verificar si ya existe una masa de este tipo para esta fecha
      const masaExistenteResult = await client.query(
        `SELECT id, codigo_masa, estado, fase_actual
         FROM masas_produccion
         WHERE DATE(fecha_produccion) = $1
           AND tipo_masa = $2
           AND es_subdivision = false
           AND es_adicional = false
           AND masa_padre_id IS NULL
         ORDER BY id DESC
         LIMIT 1`,
        [fechaProduccion, tipoMasa]
      );

      const masaExistente = masaExistenteResult.rows[0] || null;
      // Editable solo si estado Y fase son ambos PLANIFICACION (no aprobada aún)
      const estaEnPlanificacion = masaExistente &&
        masaExistente.fase_actual === 'PLANIFICACION' &&
        masaExistente.estado === 'PLANIFICACION';

      // En producción: aprobada, pendiente, o ya avanzó de fase
      const estaEnProduccion = masaExistente && (
        masaExistente.estado !== 'PLANIFICACION' ||
        masaExistente.fase_actual !== 'PLANIFICACION'
      );

      // Si ya está en producción (forzar=false): crear masa adicional
      if (estaEnProduccion) {
        logger.info(`Tipo ${tipoMasa} ya en fase ${masaExistente.fase_actual} — creando masa ADICIONAL`);
        // continuar el flujo normal de creación pero marcando es_adicional=true
        // (se aplica más abajo en el INSERT)
      }

      // Si ya está en PLANIFICACION (forzar=false): agregar productos a la masa existente
      if (estaEnPlanificacion && !forzar) {
        logger.info(`Tipo ${tipoMasa} en PLANIFICACION — agregando productos a masa ${masaExistente.id}`);

        const masaIdExistente = masaExistente.id;

        for (const prod of grupo.productos) {
          // Verificar por sap_item_code + sap_doc_entry para evitar duplicar la misma OV
          const prodExistenteResult = await client.query(
            `SELECT id FROM productos_por_masa
             WHERE masa_id = $1 AND sap_item_code = $2 AND sap_doc_entry = $3`,
            [masaIdExistente, prod.itemCode, prod.docEntry]
          );

          if (prodExistenteResult.rows.length > 0) {
            // Misma OV, mismo producto — ya estaba registrado, no tocar
            logger.info(`Producto ${prod.itemCode} OV ${prod.docEntry} ya existe en masa ${masaIdExistente} — omitido`);
          } else {
            // OV nueva para este producto — verificar si el item ya existe con otra OV
            const itemExistenteResult = await client.query(
              `SELECT id FROM productos_por_masa
               WHERE masa_id = $1 AND sap_item_code = $2`,
              [masaIdExistente, prod.itemCode]
            );

            if (itemExistenteResult.rows.length > 0) {
              // Mismo producto, OV diferente — sumar unidades
              await client.query(
                `UPDATE productos_por_masa
                 SET unidades_pedidas = unidades_pedidas + $1,
                     unidades_programadas = unidades_programadas + $1,
                     kilos_pedidos = kilos_pedidos + $2,
                     kilos_programados = kilos_programados + $2,
                     updated_at = NOW()
                 WHERE masa_id = $3 AND sap_item_code = $4`,
                [prod.cantidadPaquetes, prod.kilosPedidos || 0, masaIdExistente, prod.itemCode]
              );
              logger.info(`Producto ${prod.itemCode} OV ${prod.docEntry} nueva — sumado a masa ${masaIdExistente} (+${prod.cantidadPaquetes} und)`);
            } else {
              // Producto completamente nuevo en esta masa — insertar
              await client.query(
                `INSERT INTO productos_por_masa (
                   masa_id, producto_codigo, producto_nombre, presentacion,
                   gramaje_unitario, unidades_pedidas, unidades_programadas,
                   kilos_pedidos, kilos_programados,
                   sap_item_code, unidades_por_paquete, cantidad_paquetes,
                   sap_doc_entry, sap_doc_num
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
                [
                  masaIdExistente,
                  prod.itemCode,
                  prod.descripcion,
                  prod.descripcion,
                  prod.gramaje * 1000,
                  prod.cantidadPaquetes,
                  prod.cantidadPaquetes,
                  prod.kilosPedidos || 0,
                  prod.kilosPedidos || 0,
                  prod.itemCode,
                  prod.unidadesPorPaquete,
                  prod.cantidadPaquetes,
                  prod.docEntry,
                  String(prod.docNum)
                ]
              );
              logger.info(`Producto ${prod.itemCode} agregado a masa ${masaIdExistente}`);
            }
          }
        }

        // Actualizar contadores de la masa existente
        await client.query(
          `UPDATE masas_produccion
           SET total_productos = (SELECT COUNT(*) FROM productos_por_masa WHERE masa_id = $1),
               total_ordenes = (SELECT COUNT(DISTINCT sap_doc_entry) FROM productos_por_masa WHERE masa_id = $1),
               updated_at = NOW()
           WHERE id = $1`,
          [masaIdExistente]
        );

        masasCreadas.push({
          id: masaIdExistente,
          uuid: masaExistente.uuid,
          codigo: masaExistente.codigo_masa,
          tipo_masa: tipoMasa,
          accion: 'ACTUALIZADA',
          productos_agregados: grupo.productos.length
        });

        ordenCounter++;
        continue; // no crear masa nueva
      }

      // Omitir tipos que ya están en producción con forzar=true (comportamiento anterior)
      if (tiposMasaEnProceso.includes(tipoMasa) && forzar) {
        masasOmitidas.push(tipoMasa);
        logger.info(`Tipo de masa OMITIDO (ya en producción, forzar=true): ${tipoMasa}`);
        ordenCounter++;
        continue;
      }

      const codigoMasa = `MASA-OV-${fechaProduccion.replace(/-/g, '')}-${String(ordenCounter).padStart(3, '0')}`;
      const porcentajeMerma = 5.0;

      const docEntriesUnicos = [...new Set(grupo.productos.map(p => p.docEntry))];
      const esRepeticion = grupo.productos.some(p => p.series === 89);

      // Determinar si es masa adicional (tipo ya en producción, forzar=false)
      const esAdicional = estaEnProduccion && !forzar;
      const codigoMasaFinal = esAdicional
        ? `${codigoMasa}-ADICIONAL`
        : codigoMasa;

      const masaResult = await client.query(
        `INSERT INTO masas_produccion (
           codigo_masa, tipo_masa, nombre_masa, fecha_produccion,
           total_kilos_base, total_kilos_con_merma, porcentaje_merma, factor_absorcion_usado,
           estado, fase_actual,
           fecha_sap_referencia, total_ordenes, total_productos, es_repeticion,
           es_adicional, masa_adicional_referencia_id
         ) VALUES ($1, $2, $3, $4, 0, 0, $5, $6, 'PLANIFICACION', 'PLANIFICACION', $7, $8, $9, $10, $11, $12)
         RETURNING id, uuid`,
        [
          codigoMasaFinal,
          tipoMasa,
          tipoMasa,
          fechaProduccion,
          porcentajeMerma,
          factorAbsorcion,
          fechaProduccion,
          docEntriesUnicos.length,
          grupo.productos.length,
          esRepeticion,
          esAdicional,
          esAdicional ? masaExistente.id : null
        ]
      );

      const masaId = masaResult.rows[0].id;

      // Calcular kilos por producto desde BOM local (grupo_sap=181, excluyendo empaque)
      const kiloPorItemCode = {};
      const itemCodes = [...new Set(grupo.productos.map(p => p.itemCode))];
      for (const itemCode of itemCodes) {
        const bomResult = await client.query(
          `SELECT COALESCE(SUM(cantidad), 0) as kg_por_unidad
           FROM sap_bom_componentes
           WHERE item_code_padre = $1 AND grupo_sap = 181`,
          [itemCode]
        );
        const kgBOM = parseFloat(bomResult.rows[0].kg_por_unidad || 0);

        if (kgBOM > 0) {
          kiloPorItemCode[itemCode] = kgBOM;
        } else {
          // Fallback: calcular desde gramaje del artículo en sap_articulos
          const artResult = await client.query(
            `SELECT gramaje, sales_qty_per_pack FROM sap_articulos WHERE item_code = $1`,
            [itemCode]
          );
          const gramaje = parseFloat(artResult.rows[0]?.gramaje || 0);
          const qtyPerPack = parseFloat(artResult.rows[0]?.sales_qty_per_pack || 1);
          if (gramaje > 0) {
            // gramaje está en gramos, qty_per_pack es unidades por paquete
            kiloPorItemCode[itemCode] = (gramaje * qtyPerPack) / 1000;
            logger.warn(`BOM vacío para ${itemCode} — usando fallback gramaje: ${gramaje}g × ${qtyPerPack} = ${kiloPorItemCode[itemCode].toFixed(4)} kg/paquete`);
          } else {
            kiloPorItemCode[itemCode] = 0;
            logger.warn(`BOM vacío y gramaje=0 para ${itemCode}. Kilos quedarán en 0. Sincroniza BOM.`);
          }
        }
      }

      // Insertar productos; ON CONFLICT acumula si el mismo ItemCode aparece en varias OV
      for (const prod of grupo.productos) {
        const unidadesPedidas = prod.unidadesPedidas || prod.cantidadPaquetes || 0;
        const multiploDivisor = prod.multiploDivisor || 0;

        // Calcular múltiplo superior: si pedidas no es múltiplo exacto del divisor,
        // redondear hacia arriba al siguiente múltiplo.
        // Ej: pedidas=5, divisor=10 → ajustadas=10, excedente=5
        // Ej: pedidas=20, divisor=20 → ajustadas=20, excedente=0
        // Ej: pedidas=7, divisor=5  → ajustadas=10, excedente=3
        const unidadesAjustadas = (multiploDivisor > 0 && unidadesPedidas % multiploDivisor !== 0)
          ? (Math.floor(unidadesPedidas / multiploDivisor) + 1) * multiploDivisor
          : unidadesPedidas;
        const unidadesExcedente = unidadesAjustadas - unidadesPedidas;

        await client.query(
          `INSERT INTO productos_por_masa (
             masa_id, producto_codigo, producto_nombre, presentacion,
             gramaje_unitario,
             unidades_pedidas, unidades_programadas, kilos_pedidos, kilos_programados,
             sap_item_code, unidades_por_paquete, cantidad_paquetes, sap_doc_entry, sap_doc_num,
             multiplo_divisor, unidades_ajustadas, unidades_excedente
           ) VALUES ($1, $2, $3, 'Por definir', $4, $5, $5, $6, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           ON CONFLICT (masa_id, sap_item_code) DO UPDATE SET
             unidades_pedidas     = productos_por_masa.unidades_pedidas     + EXCLUDED.unidades_pedidas,
             unidades_programadas = productos_por_masa.unidades_programadas + EXCLUDED.unidades_programadas,
             cantidad_paquetes    = productos_por_masa.cantidad_paquetes    + EXCLUDED.cantidad_paquetes,
             kilos_pedidos        = productos_por_masa.kilos_pedidos        + EXCLUDED.kilos_pedidos,
             kilos_programados    = productos_por_masa.kilos_programados    + EXCLUDED.kilos_programados,
             multiplo_divisor     = EXCLUDED.multiplo_divisor,
             unidades_ajustadas   = CASE
               WHEN EXCLUDED.multiplo_divisor > 0 AND
                    (productos_por_masa.unidades_programadas + EXCLUDED.unidades_programadas) % EXCLUDED.multiplo_divisor != 0
               THEN (FLOOR((productos_por_masa.unidades_programadas + EXCLUDED.unidades_programadas)::float / EXCLUDED.multiplo_divisor) + 1) * EXCLUDED.multiplo_divisor
               ELSE (productos_por_masa.unidades_programadas + EXCLUDED.unidades_programadas)
             END,
             unidades_excedente   = CASE
               WHEN EXCLUDED.multiplo_divisor > 0 AND
                    (productos_por_masa.unidades_programadas + EXCLUDED.unidades_programadas) % EXCLUDED.multiplo_divisor != 0
               THEN ((FLOOR((productos_por_masa.unidades_programadas + EXCLUDED.unidades_programadas)::float / EXCLUDED.multiplo_divisor) + 1) * EXCLUDED.multiplo_divisor) - (productos_por_masa.unidades_programadas + EXCLUDED.unidades_programadas)
               ELSE 0
             END`,
          [
            masaId,
            prod.itemCode,                                          // $2 producto_codigo
            prod.descripcion,                                       // $3 producto_nombre
            kiloPorItemCode[prod.itemCode] * 1000,                  // $4 gramaje_unitario (en gramos)
            prod.unidadesPedidas,                                   // $5 unidades_pedidas / unidades_programadas
            kiloPorItemCode[prod.itemCode] * prod.cantidadPaquetes, // $6 kilos_pedidos / kilos_programados
            prod.itemCode,                                          // $7 sap_item_code
            prod.unidadesPorPaquete,                                // $8
            prod.cantidadPaquetes,                                  // $9
            prod.docEntry,                                          // $10
            String(prod.docNum),                                    // $11
            multiploDivisor,                                        // $12
            unidadesAjustadas,                                      // $13
            unidadesExcedente,                                      // $14
          ]
        );
      }

      // Calcular total_kilos_base sumando kilos de todos los productos
      const totalKilosBase = grupo.productos.reduce((sum, prod) => {
        const unidades = prod.cantidadPaquetes || prod.unidadesPedidas || 0;
        return sum + (kiloPorItemCode[prod.itemCode] || 0) * unidades;
      }, 0);
      const totalKilosConMerma = totalKilosBase * (1 + porcentajeMerma / 100);

      // Actualizar masas_produccion con los kilos reales calculados desde BOM
      await client.query(
        `UPDATE masas_produccion
         SET total_kilos_base = $1, total_kilos_con_merma = $2
         WHERE id = $3`,
        [totalKilosBase, totalKilosConMerma, masaId]
      );

      logger.info(`Masa ${masaId} (${tipoMasa}): ${totalKilosBase.toFixed(2)} kg base calculados desde BOM`);

      // ── Poblar ingredientes_masa desde BOM (solo materias primas, sin empaques) ──
      const todosItemCodes = [...new Set(grupo.productos.map(p => p.itemCode))];

      // Acumular ingredientes sumando cantidades × unidades de cada producto
      const ingredientesMap = {}; // key: item_code_comp
      for (const itemCode of todosItemCodes) {
        const unidadesProducto = grupo.productos
          .filter(p => p.itemCode === itemCode)
          .reduce((sum, p) => sum + (p.cantidadPaquetes || p.unidadesPedidas || 0), 0);

        const bomIngResult = await client.query(
          `SELECT item_code_comp, item_name_comp, cantidad, uom, es_empaque,
                  grupo_sap, es_empaque
           FROM sap_bom_componentes
           WHERE item_code_padre = $1
             AND es_empaque = false
             AND grupo_sap = 181`,
          [itemCode]
        );

        for (const ing of bomIngResult.rows) {
          const cantidadTotal = parseFloat(ing.cantidad) * unidadesProducto;
          if (ingredientesMap[ing.item_code_comp]) {
            ingredientesMap[ing.item_code_comp].cantidad_kilos += cantidadTotal;
          } else {
            ingredientesMap[ing.item_code_comp] = {
              item_code_comp: ing.item_code_comp,
              item_name_comp: ing.item_name_comp,
              cantidad_kilos: cantidadTotal,
              uom:            ing.uom,
            };
          }
        }
      }

      // Insertar ingredientes en ingredientes_masa
      let ordenIng = 1;
      for (const ing of Object.values(ingredientesMap)) {
        const cantidadGramos = ing.cantidad_kilos * 1000;
        await client.query(
          `INSERT INTO ingredientes_masa (
             masa_id, ingrediente_sap_code, ingrediente_nombre,
             orden_visualizacion, porcentaje_panadero,
             cantidad_gramos, cantidad_kilos, uom,
             es_harina, es_agua, es_prefermento, es_empaque
           ) VALUES ($1, $2, $3, $4, 0, $5, $6, $7, false, false, false, false)`,
          [
            masaId,
            ing.item_code_comp,
            ing.item_name_comp,
            ordenIng++,
            cantidadGramos,
            ing.cantidad_kilos,
            ing.uom || 'Kg',
          ]
        );
      }
      logger.info(`Masa ${masaId}: ${Object.keys(ingredientesMap).length} ingredientes poblados desde BOM`);
      // ── Fin población ingredientes_masa ──────────────────────────────

      // Crear registros de progreso para todas las fases
      const fases = ['PLANIFICACION', 'PESAJE', 'AMASADO', 'DIVISION', 'FORMADO', 'FERMENTACION', 'HORNEADO'];
      for (let i = 0; i < fases.length; i++) {
        await client.query(
          `INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado)
           VALUES ($1, $2, $3, 0)`,
          [masaId, fases[i], i === 0 ? 'EN_PROGRESO' : 'BLOQUEADA']
        );
      }

      masasCreadas.push({
        id: masaId,
        uuid: masaResult.rows[0].uuid,
        codigo: codigoMasa,
        tipo_masa: tipoMasa,
        ordenes: docEntriesUnicos.length,
        productos: grupo.productos.length
      });

      ordenCounter++;
    }

    await client.query('COMMIT');

    await db.query(
      `INSERT INTO sap_sync_log (tipo_operacion, estado, request_payload, response_payload)
       VALUES ('ORDENES_VENTA', 'SUCCESS', $1, $2)`,
      [
        JSON.stringify({ fecha: fechaProduccion }),
        JSON.stringify({ productos_procesados: productos.length, masas_creadas: masasCreadas.length })
      ]
    );

    logger.info(`Sync OV completada: ${masasCreadas.length} masas creadas`);

    res.json({
      success: true,
      message: 'Sincronización desde OV completada exitosamente',
      data: {
        fecha_produccion: fechaProduccion,
        productos_procesados: productos.length,
        masas_creadas: masasCreadas.length,
        masas_preservadas: tiposMasaEnProceso.length,
        masas: masasCreadas,
        advertencia: masasOmitidas.length > 0
          ? `Los siguientes tipos ya están en producción y NO fueron re-sincronizados: ${masasOmitidas.join(', ')}`
          : null
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error en sincronización OV:', error);

    await db.query(
      `INSERT INTO sap_sync_log (tipo_operacion, estado, error_message)
       VALUES ('ORDENES_VENTA', 'ERROR', $1)`,
      [error.message]
    ).catch(err => logger.error('Error al guardar log:', err));

    res.status(500).json({
      success: false,
      message: 'Error al sincronizar desde OV SAP',
      error: error.message
    });
  } finally {
    client.release();
  }
};

/**
 * @desc    Test de conexión con SAP Service Layer
 * @route   GET /api/sap/test
 * @access  Private (Admin/Supervisor)
 */
const testConexionSAP = async (req, res, next) => {
  try {
    await sapService.login();
    logger.info(`Test SAP exitoso. Usuario: ${req.user.username}`);
    return res.json({
      success: true,
      message: 'Conexión con SAP Service Layer exitosa',
    });
  } catch (error) {
    logger.error('Error de conexión SAP:', error);
    return res.status(500).json({
      success: false,
      message: 'No se pudo conectar con SAP Service Layer',
      error: error.message,
    });
  }
};

/**
 * @desc    Preview de OV SAP sin sincronizar (solo lectura, sin tocar BD)
 * @route   GET /api/sap/ordenes-ov
 * @access  Private
 */
const getOrdenesVenta = async (req, res, next) => {
  const { fecha } = req.query;
  const fechaConsulta = fecha || new Date().toISOString().split('T')[0];

  try {
    const productos = await sapService.getDatosParaSincronizacion(fechaConsulta);

    const agrupado = productos.reduce((acc, p) => {
      if (!acc[p.tipoMasa]) {
        acc[p.tipoMasa] = { tipoMasa: p.tipoMasa, productos: [], totalUnidades: 0, totalKilos: 0 };
      }
      acc[p.tipoMasa].productos.push(p);
      acc[p.tipoMasa].totalUnidades += p.cantidadPaquetes;
      acc[p.tipoMasa].totalKilos += p.kilosPedidos;
      return acc;
    }, {});

    return res.json({
      success: true,
      data: {
        fecha: fechaConsulta,
        total_productos: productos.length,
        masas: Object.values(agrupado),
      },
    });
  } catch (error) {
    logger.error('Error obteniendo OV de SAP:', error);
    return res.status(500).json({
      success: false,
      message: 'Error consultando SAP',
      error: error.message,
    });
  }
};

/**
 * @desc    Sincronizar tipos de masa desde SAP (@JZ_TIPOMASA → catalogo_tipos_masa)
 *          Solo inserta registros nuevos (upsert por codigo_sap). No elimina existentes.
 * @route   POST /api/sap/sincronizar-tipos-masa
 * @access  Private (Admin/Supervisor)
 */
const sincronizarTiposMasa = async (req, res, next) => {
  try {
    logger.info('Iniciando sincronización de tipos de masa desde SAP...');

    const tiposSAP = await sapService.getTiposMasa();

    if (tiposSAP.length === 0) {
      return res.json({
        success: true,
        message: 'SAP no retornó tipos de masa',
        data: { total_sap: 0, insertados: 0, ya_existian: 0 },
      });
    }

    let insertados = 0;
    let yaExistian = 0;

    for (const tipo of tiposSAP) {
      if (!tipo.code || !tipo.name) continue;

      const result = await db.query(
        `INSERT INTO catalogo_tipos_masa (codigo_sap, tipo_masa, nombre_masa)
         VALUES ($1, $2, $3)
         ON CONFLICT (codigo_sap) DO NOTHING`,
        [tipo.code, tipo.code, tipo.name]
      );

      if (result.rowCount > 0) {
        insertados++;
        logger.info(`Tipo de masa insertado: ${tipo.code} - ${tipo.name}`);
      } else {
        yaExistian++;
      }
    }

    await db.query(
      `INSERT INTO sap_sync_log (tipo_operacion, estado, request_payload, response_payload)
       VALUES ('TIPOS_MASA', 'SUCCESS', $1, $2)`,
      [
        JSON.stringify({}),
        JSON.stringify({ total_sap: tiposSAP.length, insertados, ya_existian: yaExistian }),
      ]
    );

    logger.info(`Sync tipos de masa: ${insertados} nuevos, ${yaExistian} ya existían`);

    return res.json({
      success: true,
      message: `Sincronización completada: ${insertados} tipos nuevos, ${yaExistian} ya existían`,
      data: { total_sap: tiposSAP.length, insertados, ya_existian: yaExistian },
    });
  } catch (error) {
    logger.error('Error sincronizando tipos de masa:', error);

    await db.query(
      `INSERT INTO sap_sync_log (tipo_operacion, estado, error_message)
       VALUES ('TIPOS_MASA', 'ERROR', $1)`,
      [error.message]
    ).catch(err => logger.error('Error al guardar log:', err));

    return res.status(500).json({
      success: false,
      message: 'Error al sincronizar tipos de masa',
      error: error.message,
    });
  }
};

/**
 * @desc    Sincronizar Listas de Materiales (BOM) desde SAP
 *          Trae artículos con U_JZ_Tipos_Masa + sus ProductTrees y los guarda en
 *          sap_articulos y sap_bom_componentes.
 *          v2: guarda uom, grupo_sap y es_empaque en sap_bom_componentes.
 * @route   POST /api/sap/sincronizar-bom
 * @access  Private (Admin/Supervisor)
 */
const sincronizarBOM = async (req, res, next) => {
  try {
    logger.info('Iniciando sincronización de BOM desde SAP...');

    // 1. Traer todos los artículos con tipo de masa desde SAP
    const articulos = await sapService.getArticulosConTipoMasa();

    if (articulos.length === 0) {
      return res.json({
        success: true,
        message: 'SAP no retornó artículos con tipo de masa configurado',
        data: { articulos_procesados: 0, bom_sincronizados: 0, sin_bom: 0 },
      });
    }

    let articulosUpserted = 0;
    let bomSincronizados  = 0;
    let sinBOM            = 0;
    const errores         = [];

    for (const articulo of articulos) {
      try {
        // 2. Upsert en sap_articulos
        await db.query(
          `INSERT INTO sap_articulos
             (item_code, item_name, tipo_masa, sales_qty_per_pack, gramaje, multiplo_divisor, activo, synced_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (item_code) DO UPDATE SET
             item_name          = EXCLUDED.item_name,
             tipo_masa          = EXCLUDED.tipo_masa,
             sales_qty_per_pack = EXCLUDED.sales_qty_per_pack,
             gramaje            = EXCLUDED.gramaje,
             multiplo_divisor   = EXCLUDED.multiplo_divisor,
             activo             = true,
             synced_at          = CURRENT_TIMESTAMP,
             updated_at         = CURRENT_TIMESTAMP`,
          [
            articulo.itemCode,
            articulo.itemName,
            articulo.tipoMasa,
            articulo.salesQtyPerPack,
            articulo.gramaje,
            articulo.multiploDivisor || 0,
          ]
        );
        articulosUpserted++;

        // 3. Obtener BOM del artículo desde SAP
        const bomLines = await sapService.getBOM(articulo.itemCode);

        if (!bomLines || bomLines.length === 0) {
          sinBOM++;
          continue;
        }

        // 4. Obtener UoM e ItemsGroupCode de todos los componentes en lote
        const itemCodeComp = bomLines.map(l => l.ItemCode);
        const uomMap       = await sapService.getItemsUoM(itemCodeComp);

        // 5. Upsert de cada componente con uom y grupo_sap
        for (const line of bomLines) {
          const uomInfo  = uomMap[line.ItemCode] || { uom: null, grupoSap: null };
          const esEmpaque = uomInfo.grupoSap === 182;

          await db.query(
            `INSERT INTO sap_bom_componentes
               (item_code_padre, item_code_comp, item_name_comp,
                cantidad, warehouse, issue_method, visual_order,
                uom, grupo_sap, es_empaque,
                synced_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_TIMESTAMP)
             ON CONFLICT (item_code_padre, item_code_comp) DO UPDATE SET
               item_name_comp = EXCLUDED.item_name_comp,
               cantidad       = EXCLUDED.cantidad,
               warehouse      = EXCLUDED.warehouse,
               issue_method   = EXCLUDED.issue_method,
               visual_order   = EXCLUDED.visual_order,
               uom            = EXCLUDED.uom,
               grupo_sap      = EXCLUDED.grupo_sap,
               es_empaque     = EXCLUDED.es_empaque,
               synced_at      = CURRENT_TIMESTAMP`,
            [
              articulo.itemCode,
              line.ItemCode,
              line.ItemName,
              line.Quantity,
              line.Warehouse,
              line.IssueMethod,
              line.VisualOrder || 0,
              uomInfo.uom,
              uomInfo.grupoSap,
              esEmpaque,
            ]
          );
        }
        bomSincronizados++;

      } catch (err) {
        logger.error(`Error procesando BOM de ${articulo.itemCode}:`, err.message);
        errores.push({ itemCode: articulo.itemCode, error: err.message });
      }
    }

    // Marcar como inactivos los artículos que ya no vienen de SAP (cancelados/eliminados)
    const itemCodesActivos = articulos.map(a => a.itemCode);
    if (itemCodesActivos.length > 0) {
      const inactivadosResult = await db.query(
        `UPDATE sap_articulos SET activo = false, updated_at = CURRENT_TIMESTAMP
         WHERE item_code != ALL($1::varchar[]) AND activo = true`,
        [itemCodesActivos]
      );
      if (inactivadosResult.rowCount > 0)
        logger.info(`BOM sync: ${inactivadosResult.rowCount} artículos marcados inactivos (ya no están en SAP)`);
    }

    // 6. Registrar en log de sincronización
    await db.query(
      `INSERT INTO sap_sync_log (tipo_operacion, estado, request_payload, response_payload)
       VALUES ('BOM', 'SUCCESS', $1, $2)`,
      [
        JSON.stringify({}),
        JSON.stringify({
          articulos_procesados: articulosUpserted,
          bom_sincronizados:    bomSincronizados,
          sin_bom:              sinBOM,
          errores:              errores.length,
        }),
      ]
    );

    logger.info(`Sync BOM completada: ${articulosUpserted} artículos, ${bomSincronizados} con BOM, ${sinBOM} sin BOM`);

    return res.json({
      success: true,
      message: `BOM sincronizado: ${bomSincronizados} artículos con lista de materiales`,
      data: {
        articulos_procesados: articulosUpserted,
        bom_sincronizados:    bomSincronizados,
        sin_bom:              sinBOM,
        errores:              errores.length > 0 ? errores : undefined,
      },
    });

  } catch (error) {
    logger.error('Error en sincronización BOM:', error);

    await db.query(
      `INSERT INTO sap_sync_log (tipo_operacion, estado, error_message)
       VALUES ('BOM', 'ERROR', $1)`,
      [error.message]
    ).catch(err => logger.error('Error al guardar log:', err));

    return res.status(500).json({
      success: false,
      message: 'Error al sincronizar BOM desde SAP',
      error: error.message,
    });
  }
};

const sincronizarInventarioMP = async (_req, res, next) => {
  try {
    // Obtener todos los ítems MP del BOM
    const itemsResult = await db.query(
      `SELECT DISTINCT item_code_comp AS item_code
       FROM sap_bom_componentes
       WHERE grupo_sap = 181 AND es_empaque = false`
    );

    const todosItemCodes = itemsResult.rows.map(r => r.item_code);

    if (todosItemCodes.length === 0) {
      return res.json({
        success: true,
        message: 'No hay ítems de materia prima en BOM',
        data: { sincronizados: 0, lotes_sincronizados: 0 },
      });
    }

    // Siempre sincronizar lotes de todos los ítems MP presentes en cualquier masa activa
    // (PLANIFICACION → HORNEADO) para mantener stock consistente con SAP
    const activasResult = await db.query(
      `SELECT DISTINCT im.ingrediente_sap_code AS item_code
       FROM ingredientes_masa im
       JOIN masas_produccion mp ON im.masa_id = mp.id
       WHERE mp.fase_actual NOT IN ('EMPAQUE','COMPLETADA','CANCELADA')
       AND im.es_empaque = false
       AND im.ingrediente_sap_code IS NOT NULL`
    );
    let itemCodesLotes = activasResult.rows.length > 0
      ? activasResult.rows.map(r => r.item_code)
      : todosItemCodes;
    logger.info(`Sync lotes: ${itemCodesLotes.length} ítems de masas activas`);

    // Stock siempre sincroniza todos los ítems del BOM
    const itemCodes = todosItemCodes;

    // 1. Sincronizar stock y costo promedio
    const stocks = await sapService.getStockMateriaPrima(itemCodes);
    let sincronizados = 0;

    for (const [itemCode, datos] of Object.entries(stocks)) {
      if (!datos) continue;

      await db.query(
        `INSERT INTO sap_inventario_mp
           (item_code, item_name, uom, stock_almp, committed_almp, ordered_almp, costo_promedio, manage_batch_numbers, ultimo_sync)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (item_code) DO UPDATE SET
           item_name            = EXCLUDED.item_name,
           uom                  = EXCLUDED.uom,
           stock_almp           = EXCLUDED.stock_almp,
           committed_almp       = EXCLUDED.committed_almp,
           ordered_almp         = EXCLUDED.ordered_almp,
           costo_promedio       = EXCLUDED.costo_promedio,
           manage_batch_numbers = EXCLUDED.manage_batch_numbers,
           ultimo_sync          = NOW()`,
        [itemCode, datos.itemName, datos.uom, datos.stockAlmp,
         datos.committedAlmp, datos.orderedAlmp, datos.costoPromedio,
         datos.manageBatchNumbers ?? false]
      );
      sincronizados++;
    }

    // 2. Sincronizar lotes — solo ítems con manage_batch_numbers=true
    const itemCodesConLotes = itemCodesLotes.filter(code => {
      const inv = stocks[code];
      return inv && inv.manageBatchNumbers === true;
    });

    const lotesMap = itemCodesConLotes.length > 0
      ? await sapService.getLotesMateriaPrima(itemCodesConLotes, stocks)
      : {};
    let lotesSincronizados = 0;

    // Limpiar lotes sin stock de los ítems que se van a sincronizar
    // para evitar acumulación de registros basura con cantidad=0
    if (Object.keys(lotesMap).length > 0) {
      const itemsConLotesNuevos = Object.keys(lotesMap);
      await db.query(
        `DELETE FROM sap_lotes_mp
         WHERE item_code = ANY($1)
           AND cantidad_disponible = 0`,
        [itemsConLotesNuevos]
      );
    }

    for (const [itemCode, lotes] of Object.entries(lotesMap)) {
      for (const lote of lotes) {
        // Restar lo ya reservado localmente en pesaje_lotes_consumo para no sobreescribir
        // consumos que aún no fueron enviados a SAP como InventoryGenExit
        const reservadoResult = await db.query(
          `SELECT COALESCE(SUM(cantidad_kg), 0) AS reservado
           FROM pesaje_lotes_consumo
           WHERE item_code = $1 AND batch = $2`,
          [itemCode, lote.batch],
        );
        const reservado = parseFloat(reservadoResult.rows[0].reservado);
        const cantidadNeta = Math.max(0, (lote.cantidad_disponible || 0) - reservado);

        await db.query(
          `INSERT INTO sap_lotes_mp
             (item_code, item_name, batch, status, admission_date, manufacturing_date, expiration_date, cantidad_disponible, ultimo_sync)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (item_code, batch) DO UPDATE SET
             status              = EXCLUDED.status,
             admission_date      = EXCLUDED.admission_date,
             manufacturing_date  = EXCLUDED.manufacturing_date,
             expiration_date     = EXCLUDED.expiration_date,
             cantidad_disponible = EXCLUDED.cantidad_disponible,
             ultimo_sync         = NOW()`,
          [
            itemCode,
            stocks[itemCode]?.itemName || null,
            lote.batch,
            lote.status,
            lote.admissionDate || null,
            lote.manufacturingDate || null,
            lote.expirationDate || null,
            cantidadNeta,
          ]
        );
        lotesSincronizados++;
      }
    }

    logger.info(`Inventario MP sincronizado: ${sincronizados} ítems, ${lotesSincronizados} lotes`);

    return res.json({
      success: true,
      message: `Inventario sincronizado: ${sincronizados} materias primas, ${lotesSincronizados} lotes`,
      data: { sincronizados, lotes_sincronizados: lotesSincronizados },
    });
  } catch (error) {
    logger.error('Error sincronizando inventario MP:', error);
    return next(error);
  }
};

const getInventarioMP = async (req, res, next) => {
  try {
    const inventario = await db.query(
      `SELECT item_code, item_name, uom, stock_almp, committed_almp,
              ordered_almp, costo_promedio, ultimo_sync
       FROM sap_inventario_mp
       ORDER BY item_name`
    );

    const lotes = await db.query(
      `SELECT item_code, batch, status, admission_date,
              manufacturing_date, expiration_date, cantidad_disponible
       FROM sap_lotes_mp
       ORDER BY item_code, admission_date ASC NULLS LAST`
    );

    // Agrupar lotes por item_code
    const lotesPorItem = {};
    for (const lote of lotes.rows) {
      if (!lotesPorItem[lote.item_code]) lotesPorItem[lote.item_code] = [];
      lotesPorItem[lote.item_code].push(lote);
    }

    const data = inventario.rows.map(item => ({
      ...item,
      lotes: lotesPorItem[item.item_code] || [],
    }));

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Error obteniendo inventario MP:', error);
    next(error);
  }
};

module.exports = {
  sincronizarSAP,
  sincronizarDemo,
  sincronizarDesdeOV,
  sincronizarTiposMasa,
  sincronizarBOM,
  getOrdenes,
  getOrdenesVenta,
  verificarStock,
  getHistorialSync,
  testConexionSAP,
  sincronizarInventarioMP,
  getInventarioMP,
};
