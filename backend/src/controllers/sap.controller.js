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
        `SELECT id, codigo_masa, tipo_masa, fase_actual, estado
         FROM masas_produccion
         WHERE DATE(fecha_produccion) = $1`,
        [fechaProduccion]
      );

      for (const masa of masasExistentes.rows) {
        const esPlanificacion =
          masa.fase_actual === 'PLANIFICACION' && masa.estado === 'PLANIFICACION';

        if (esPlanificacion) {
          await client.query(
            `DELETE FROM masas_produccion WHERE id = $1`,
            [masa.id]
          );
          masasEliminadas++;
          logger.info(`Masa eliminada (PLANIFICACION): ${masa.codigo_masa}`);
        } else {
          tiposMasaEnProceso.push(masa.tipo_masa);
          logger.info(`Masa PRESERVADA (${masa.fase_actual}): ${masa.codigo_masa}`);
        }
      }

      if (masasEliminadas > 0)
        logger.info(`${masasEliminadas} masas en PLANIFICACION eliminadas para ${fechaProduccion}`);
      if (tiposMasaEnProceso.length > 0)
        logger.info(`${tiposMasaEnProceso.length} masas preservadas (en producción): [${tiposMasaEnProceso.join(', ')}]`);

    } else {
      const existenResult = await client.query(
        `SELECT COUNT(*) as count FROM masas_produccion WHERE DATE(fecha_produccion) = $1`,
        [fechaProduccion]
      );
      if (parseInt(existenResult.rows[0].count) > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Ya existen masas para esta fecha. Use forzar=true para re-sincronizar las que están en PLANIFICACION.',
          data: { masas_existentes: parseInt(existenResult.rows[0].count) }
        });
      }
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
      // Omitir tipos de masa que ya están en producción
      if (tiposMasaEnProceso.includes(tipoMasa)) {
        masasOmitidas.push(tipoMasa);
        logger.info(`Tipo de masa OMITIDO (ya en producción): ${tipoMasa}`);
        ordenCounter++;
        continue;
      }

      const grupo = masasAgrupadas[tipoMasa];
      const codigoMasa = `MASA-OV-${fechaProduccion.replace(/-/g, '')}-${String(ordenCounter).padStart(3, '0')}`;
      const porcentajeMerma = 5.0;

      const docEntriesUnicos = [...new Set(grupo.productos.map(p => p.docEntry))];

      const masaResult = await client.query(
        `INSERT INTO masas_produccion (
           codigo_masa, tipo_masa, nombre_masa, fecha_produccion,
           total_kilos_base, total_kilos_con_merma, porcentaje_merma, factor_absorcion_usado,
           estado, fase_actual,
           fecha_sap_referencia, total_ordenes, total_productos
         ) VALUES ($1, $2, $3, $4, 0, 0, $5, $6, 'PLANIFICACION', 'PLANIFICACION', $7, $8, $9)
         RETURNING id, uuid`,
        [
          codigoMasa,
          tipoMasa,
          tipoMasa,
          fechaProduccion,
          porcentajeMerma,
          factorAbsorcion,
          fechaProduccion,
          docEntriesUnicos.length,
          grupo.productos.length
        ]
      );

      const masaId = masaResult.rows[0].id;

      // Insertar productos; ON CONFLICT acumula si el mismo ItemCode aparece en varias OV
      for (const prod of grupo.productos) {
        await client.query(
          `INSERT INTO productos_por_masa (
             masa_id, producto_codigo, producto_nombre, presentacion,
             gramaje_unitario,
             unidades_pedidas, unidades_programadas, kilos_pedidos, kilos_programados,
             sap_item_code, unidades_por_paquete, cantidad_paquetes, sap_doc_entry, sap_doc_num
           ) VALUES ($1, $2, $3, 'Por definir', $4, $5, $5, $6, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (masa_id, sap_item_code) DO UPDATE SET
             unidades_pedidas     = productos_por_masa.unidades_pedidas     + EXCLUDED.unidades_pedidas,
             unidades_programadas = productos_por_masa.unidades_programadas + EXCLUDED.unidades_programadas,
             cantidad_paquetes    = productos_por_masa.cantidad_paquetes    + EXCLUDED.cantidad_paquetes,
             kilos_pedidos        = productos_por_masa.kilos_pedidos        + EXCLUDED.kilos_pedidos,
             kilos_programados    = productos_por_masa.kilos_programados    + EXCLUDED.kilos_programados`,
          [
            masaId,
            prod.itemCode,          // $2 producto_codigo
            prod.descripcion,       // $3 producto_nombre
            prod.gramaje,           // $4 gramaje_unitario
            prod.unidadesPedidas,   // $5 unidades_pedidas / unidades_programadas
            prod.kilosPedidos,      // $6 kilos_pedidos / kilos_programados
            prod.itemCode,          // $7 sap_item_code
            prod.unidadesPorPaquete, // $8
            prod.cantidadPaquetes,  // $9
            prod.docEntry,          // $10
            String(prod.docNum)     // $11
          ]
        );
      }

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
             (item_code, item_name, tipo_masa, sales_qty_per_pack, gramaje, activo, synced_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (item_code) DO UPDATE SET
             item_name          = EXCLUDED.item_name,
             tipo_masa          = EXCLUDED.tipo_masa,
             sales_qty_per_pack = EXCLUDED.sales_qty_per_pack,
             gramaje            = EXCLUDED.gramaje,
             activo             = true,
             synced_at          = CURRENT_TIMESTAMP,
             updated_at         = CURRENT_TIMESTAMP`,
          [
            articulo.itemCode,
            articulo.itemName,
            articulo.tipoMasa,
            articulo.salesQtyPerPack,
            articulo.gramaje,
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
};
