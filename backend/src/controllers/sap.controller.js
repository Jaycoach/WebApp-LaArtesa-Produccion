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
      estado: 'R' // Solo órdenes liberadas (Released)
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
      const tipoMasaResult = await client.query(tipoMasaQuery, [orden.ItemCode]);

      if (tipoMasaResult.rows.length === 0) {
        ordenesNoMapeadas.push({
          docEntry: orden.DocEntry,
          docNum: orden.DocNum,
          itemCode: orden.ItemCode,
          descripcion: orden.ProductDescription
        });
        logger.warn(`Orden ${orden.DocNum} (${orden.ItemCode}) no tiene tipo de masa mapeado`);
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
          [masaId, orden.DocEntry, orden.DocNum]
        );

        // Insertar productos por masa
        await client.query(
          `INSERT INTO productos_por_masa (
             masa_id, producto_codigo, producto_nombre, presentacion,
             unidades_pedidas, unidades_programadas, kilos_pedidos, kilos_programados
           ) VALUES ($1, $2, $3, $4, $5, $5, $6, $6)`,
          [
            masaId,
            orden.ItemCode,
            orden.ProductDescription,
            'Por definir',
            parseFloat(orden.PlannedQuantity || 0),
            parseFloat(orden.PlannedQuantity || 0)
          ]
        );
      }

      // Obtener ingredientes de la primera orden (todas deberían tener la misma receta)
      const primeraOrden = grupo.ordenes[0];
      const ingredientes = await sapService.getListaMateriales(primeraOrden.DocEntry);

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
        const estado = i === 0 ? 'BLOQUEADA' : 'BLOQUEADA'; // Todas bloqueadas inicialmente

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
      `INSERT INTO sap_sync_log (tipo_sync, registros_procesados, estado, detalles)
       VALUES ('ORDENES_PRODUCCION', $1, 'SUCCESS', $2)`,
      [
        ordenesSAP.length,
        JSON.stringify({
          fecha: fechaProduccion,
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
      `INSERT INTO sap_sync_log (tipo_sync, estado, mensaje_error)
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
        tipo_sync,
        registros_procesados,
        estado,
        mensaje_error,
        detalles,
        fecha_sync
      FROM sap_sync_log
      ORDER BY fecha_sync DESC
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
        DocEntry: 1001,
        DocNum: '1001',
        ItemCode: 'HAMB-GOLD-6',
        ProductDescription: 'Hamburguesa Gold x6',
        PlannedQuantity: 50,
        Status: 'R'
      },
      {
        DocEntry: 1002,
        DocNum: '1002',
        ItemCode: 'HAMB-GOLD-12',
        ProductDescription: 'Hamburguesa Gold x12',
        PlannedQuantity: 30,
        Status: 'R'
      },
      {
        DocEntry: 1003,
        DocNum: '1003',
        ItemCode: 'PAN-ARABE-6',
        ProductDescription: 'Pan Árabe x6',
        PlannedQuantity: 100,
        Status: 'R'
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
      const tipoInfo = tiposMasaMap[orden.ItemCode];
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
            orden.ItemCode,
            orden.ProductDescription,
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

module.exports = {
  sincronizarSAP,
  sincronizarDemo,
  getOrdenes,
  verificarStock,
  getHistorialSync
};
