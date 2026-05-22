/**
 * Servicio de integración con SAP Business One
 * Utiliza SAP Service Layer API
 */

const axios = require('axios');
const https = require('https');
const logger = require('../utils/logger');
const config = require('../config');

class SAPService {
  constructor() {
    this.baseURL = config.sap.url;
    this.companyDB = config.sap.companyDB;
    this.username = config.sap.username;
    this.password = config.sap.password;
    this.sessionId = null;
    this.sessionTimeout = null;

    // Configurar cliente axios
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
      // Ignorar certificados SSL auto-firmados en desarrollo
      httpsAgent: new https.Agent({
        rejectUnauthorized: config.server.env === 'production'
      })
    });

    // Interceptor para agregar sesión a requests
    this.client.interceptors.request.use(
      (config) => {
        if (this.sessionId) {
          config.headers['Cookie'] = `B1SESSION=${this.sessionId}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Interceptor de RESPUESTA — re-login automático en 401
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const status = error.response?.status;
        // SAP retorna 401 cuando la sesión expiró
        if (status === 401 && !error.config._retry) {
          error.config._retry = true;
          logger.warn('Sesión SAP expirada (401). Re-autenticando...');
          try {
            await this.login();
            // Reintentar el request original con la nueva sesión
            error.config.headers['Cookie'] = `B1SESSION=${this.sessionId}`;
            return this.client(error.config);
          } catch (loginError) {
            logger.error('Re-login SAP fallido:', loginError.message);
            return Promise.reject(loginError);
          }
        }
        // Para otros errores, loguear el detalle que SAP retorna
        if (error.response) {
          logger.warn('SAP HTTP Error:', {
            status: error.response.status,
            url: error.config?.url,
            message: error.response.data?.error?.message?.value || error.response.statusText,
          });
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Iniciar sesión en SAP Business One
   */
  async login() {
    try {
      logger.info('Iniciando sesión en SAP Business One...');

      const response = await this.client.post('/Login', {
        CompanyDB: this.companyDB,
        UserName: this.username,
        Password: this.password
      });

      this.sessionId = response.data.SessionId;

      // Renovar sesión automáticamente antes de que expire (cada 25 minutos)
      if (this.sessionTimeout) {
        clearTimeout(this.sessionTimeout);
      }
      this.sessionTimeout = setTimeout(() => {
        this.login();
      }, 25 * 60 * 1000);

      logger.info('Sesión SAP iniciada correctamente');
      return this.sessionId;
    } catch (error) {
      logger.error('Error al iniciar sesión en SAP:', error.message);
      throw new Error(`Error de autenticación SAP: ${error.message}`);
    }
  }

  /**
   * Cerrar sesión en SAP
   */
  async logout() {
    try {
      if (this.sessionId) {
        await this.client.post('/Logout');
        this.sessionId = null;

        if (this.sessionTimeout) {
          clearTimeout(this.sessionTimeout);
          this.sessionTimeout = null;
        }

        logger.info('Sesión SAP cerrada');
      }
    } catch (error) {
      logger.error('Error al cerrar sesión SAP:', error.message);
    }
  }

  /**
   * Asegurar que hay sesión activa
   */
  async ensureSession() {
    if (!this.sessionId) {
      await this.login();
    }
  }

  /**
   * Obtener órdenes de fabricación de SAP
   * @param {Object} filters - Filtros para las órdenes
   * @returns {Array} Lista de órdenes de fabricación
   */
  async getOrdenesProduccion(filters = {}) {
    try {
      await this.ensureSession();

      const { fecha, estado } = filters;
      const conditions = [];

      if (fecha) {
        conditions.push(`PostingDate eq '${fecha}'`);
      }

      // Campo correcto: ProductionOrderStatus
      // Valores: boposPlanned, boposReleased, boposClosed, boposCancelled
      if (estado) {
        conditions.push(`ProductionOrderStatus eq '${estado}'`);
      } else {
        conditions.push(`(ProductionOrderStatus eq 'boposPlanned' or ProductionOrderStatus eq 'boposReleased')`);
      }

      const filter = conditions.length > 0 ? `$filter=${conditions.join(' and ')}` : '';

      // Campos correctos según metadata
      const response = await this.client.get(
        `/ProductionOrders?${filter}&$select=AbsoluteEntry,DocumentNumber,ItemNo,PlannedQuantity,PostingDate,ProductionOrderStatus`
      );

      logger.info(`Se obtuvieron ${response.data.value.length} órdenes de SAP`);
      return response.data.value;
    } catch (error) {
      logger.error('Error al obtener órdenes de SAP:', error.message);
      throw new Error(`Error al consultar SAP: ${error.message}`);
    }
  }

  /**
   * Obtener lista de materiales (BOM) de una orden de fabricación
   * @param {Number} docEntry - DocEntry de la orden de fabricación
   * @returns {Array} Lista de materiales
   */
  async getListaMateriales(absEntry) {
    try {
      await this.ensureSession();

      const response = await this.client.get(
        `/ProductionOrders(${absEntry})?$select=ProductionOrderLines`
      );

      const lines = response.data.ProductionOrderLines || [];
      logger.info(`Se obtuvieron ${lines.length} materiales para orden ${absEntry}`);
      return lines;
    } catch (error) {
      logger.error(`Error al obtener lista de materiales:`, error.message);
      throw new Error(`Error al obtener lista de materiales: ${error.message}`);
    }
  }

  /**
   * Actualizar estado de orden de fabricación en SAP
   * @param {Number} docEntry - DocEntry de la orden
   * @param {String} status - Nuevo estado (P, R, C, L)
   */
  async actualizarEstadoOrden(docEntry, status) {
    try {
      await this.ensureSession();

      await this.client.patch(`/ProductionOrders(${docEntry})`, {
        Status: status
      });

      logger.info(`Estado de orden ${docEntry} actualizado a ${status}`);
    } catch (error) {
      logger.error(`Error al actualizar estado de orden ${docEntry}:`, error.message);
      throw new Error(`Error al actualizar orden en SAP: ${error.message}`);
    }
  }

  /**
   * Registrar consumo de materiales en SAP
   * @param {Number} docEntry - DocEntry de la orden
   * @param {Array} materiales - Lista de materiales consumidos
   */
  async registrarConsumo(docEntry, materiales) {
    try {
      await this.ensureSession();

      // Crear documento de emisión de inventario (Inventory Gen Exit)
      const response = await this.client.post('/InventoryGenExits', {
        DocDate: new Date().toISOString().split('T')[0],
        Comments: `Consumo de producción - Orden ${docEntry}`,
        DocumentLines: materiales.map(mat => ({
          ItemCode: mat.itemCode,
          Quantity: mat.quantity,
          WarehouseCode: mat.warehouseCode,
          BaseEntry: docEntry,
          BaseType: 202 // Orden de fabricación
        }))
      });

      logger.info(`Consumo registrado para orden ${docEntry}: DocEntry ${response.data.DocEntry}`);
      return response.data;
    } catch (error) {
      logger.error(`Error al registrar consumo para orden ${docEntry}:`, error.message);
      throw new Error(`Error al registrar consumo en SAP: ${error.message}`);
    }
  }

  /**
   * Registrar recepción de producción en SAP
   * @param {Number} docEntry - DocEntry de la orden
   * @param {Number} quantity - Cantidad producida
   * @param {String} warehouseCode - Código de bodega
   */
  async registrarRecepcion(docEntry, quantity, warehouseCode) {
    try {
      await this.ensureSession();

      // Crear documento de entrada de inventario (Inventory Gen Entry)
      const response = await this.client.post('/InventoryGenEntries', {
        DocDate: new Date().toISOString().split('T')[0],
        Comments: `Recepción de producción - Orden ${docEntry}`,
        DocumentLines: [{
          BaseEntry: docEntry,
          BaseType: 202, // Orden de fabricación
          Quantity: quantity,
          WarehouseCode: warehouseCode
        }]
      });

      logger.info(`Recepción registrada para orden ${docEntry}: DocEntry ${response.data.DocEntry}`);
      return response.data;
    } catch (error) {
      logger.error(`Error al registrar recepción para orden ${docEntry}:`, error.message);
      throw new Error(`Error al registrar recepción en SAP: ${error.message}`);
    }
  }

  /**
   * Obtener información de un artículo
   * @param {String} itemCode - Código del artículo
   */
  async getArticulo(itemCode) {
    try {
      await this.ensureSession();

      const response = await this.client.get(
        `/Items('${itemCode}')?$select=ItemCode,ItemName,ItemType,InventoryUOM,ItemWarehouseInfoCollection`
      );

      return response.data;
    } catch (error) {
      logger.error(`Error al obtener artículo ${itemCode}:`, error.message);
      throw new Error(`Error al consultar artículo en SAP: ${error.message}`);
    }
  }

  // ─── ÓRDENES DE VENTA ─────────────────────────────────────────────

  /**
   * Obtiene todas las OV abiertas de una fecha con sus líneas.
   * Maneja paginación automáticamente.
   * @param {string} fecha - formato 'YYYY-MM-DD'
   * @returns {Array} líneas aplanadas con campos del artículo y OV
   */
  async getOrdenesVenta(fecha) {
    await this.ensureSession();

    const todasLasOrdenes = [];
    let skip = 0;
    const top = 20;

    while (true) {
      const response = await this.client.get('/Orders', {
        params: {
          $filter: `DocDate eq '${fecha}' and DocumentStatus eq 'bost_Open'`,
          $select: 'DocEntry,DocNum,DocDate,Series,DocumentLines',
          $top: top,
          $skip: skip,
        },
      });

      const ordenes = response.data.value || [];
      todasLasOrdenes.push(...ordenes);

      if (ordenes.length < top) break;
      skip += top;
    }

    logger.info(`SAP: ${todasLasOrdenes.length} OV encontradas para ${fecha}`);

    const lineas = [];
    for (const orden of todasLasOrdenes) {
      for (const linea of (orden.DocumentLines || [])) {
        if (linea.LineStatus !== 'bost_Open') continue;

        // Excluir líneas de costo de envío
        if (linea.ItemDescription && linea.ItemDescription.toUpperCase().includes('COSTO DE ENVIO')) {
          continue;
        }
        // También por ItemCode por si acaso
        if (linea.ItemCode && linea.ItemCode.toUpperCase().includes('ENVIO')) {
          continue;
        }

        // Excluir artículos que no son de producción
        const ITEMS_EXCLUIDOS = ['PASPT12'];
        if (ITEMS_EXCLUIDOS.includes(linea.ItemCode)) continue;

        lineas.push({
          docEntry: orden.DocEntry,
          docNum: orden.DocNum,
          series: orden.Series,
          itemCode: linea.ItemCode,
          itemDescription: linea.ItemDescription,
          quantity: linea.Quantity,
        });
      }
    }

    return lineas;
  }

  /**
   * Obtiene info de múltiples artículos en lote (SalesQtyPerPackUnit, U_JZ_Tipos_Masa).
   * @param {string[]} itemCodes - array de códigos únicos
   * @returns {Object} mapa { itemCode: { itemName, salesQtyPerPackUnit, tipoMasa } }
   */
  async getArticulosInfo(itemCodes) {
    await this.ensureSession();

    if (!itemCodes || itemCodes.length === 0) return {};

    const BATCH = 20;
    const resultado = {};

    for (let i = 0; i < itemCodes.length; i += BATCH) {
      const lote = itemCodes.slice(i, i + BATCH);
      const filterParts = lote.map(code => `ItemCode eq '${code}'`).join(' or ');

      const response = await this.client.get('/Items', {
        params: {
          $filter: filterParts,
          $select: 'ItemCode,ItemName,SalesQtyPerPackUnit,U_JZ_Tipos_Masa,SalesUnitWeight1,U_JZ_MultiploDivisor,Valid,Frozen',
          $top: BATCH,
        },
      });

      for (const item of (response.data.value || [])) {
        if (item.Valid === 'tNO' || item.Frozen === 'tYES') {
          logger.warn(`SAP OV: artículo inactivo/congelado omitido: ${item.ItemCode} (Valid=${item.Valid}, Frozen=${item.Frozen})`);
          continue;
        }
        resultado[item.ItemCode] = {
          itemName:            item.ItemName,
          salesQtyPerPackUnit: item.SalesQtyPerPackUnit || 1,
          tipoMasa:            item.U_JZ_Tipos_Masa || 'SIN_CLASIFICAR',
          gramaje:             item.SalesUnitWeight1 || 0,
          multiploDivisor:     item.U_JZ_MultiploDivisor != null ? Math.round(item.U_JZ_MultiploDivisor) : 0,
        };
      }
    }

    logger.info(`SAP: info obtenida para ${Object.keys(resultado).length} artículos`);
    return resultado;
  }

  /**
   * Combina OV + artículos listos para sincronización.
   * Equivale al JOIN OV × Items con el cálculo Quantity × SalesQtyPerPackUnit.
   * @param {string} fecha - formato 'YYYY-MM-DD'
   * @returns {Array} productos agrupables por tipoMasa
   */
  async getDatosParaSincronizacion(fecha) {
    await this.ensureSession();

    const lineas = await this.getOrdenesVenta(fecha);

    if (lineas.length === 0) {
      logger.warn(`SAP: No hay OV abiertas para ${fecha}`);
      return [];
    }

    const itemCodesUnicos = [...new Set(lineas.map(l => l.itemCode))];
    const articulos = await this.getArticulosInfo(itemCodesUnicos);

    const resultado = lineas
      .filter(linea => {
        if (!articulos[linea.itemCode]) {
          logger.warn(`SAP sync OV: artículo ${linea.itemCode} inactivo/congelado/sin tipo masa — línea OV ${linea.docNum} omitida`);
          return false;
        }
        return true;
      })
      .map(linea => {
      const art = articulos[linea.itemCode];

      const unidadesPedidas = linea.quantity;
      const descripcion = art.itemName || linea.itemDescription || '';
      const unidadesPorPaquete = (art.salesQtyPerPackUnit && art.salesQtyPerPackUnit > 1)
        ? art.salesQtyPerPackUnit
        : (() => { const m = descripcion.match(/ X ?(\d+)/i); return m ? parseInt(m[1]) : 1; })();
      const cantidadPaquetes = unidadesPedidas;

      const gramaje = art.gramaje || 0;
      const kilosPedidos = gramaje * unidadesPedidas;

      return {
        docEntry: linea.docEntry,
        docNum: linea.docNum,
        series: linea.series,
        itemCode: linea.itemCode,
        descripcion: art.itemName || linea.itemDescription,
        tipoMasa: art.tipoMasa,
        unidadesPedidas,
        unidadesPorPaquete,
        cantidadPaquetes,
        gramaje,
        kilosPedidos,
        multiploDivisor: art.multiploDivisor || 0,
      };
    });

    const resumen = resultado.reduce((acc, p) => {
      acc[p.tipoMasa] = (acc[p.tipoMasa] || 0) + p.cantidadPaquetes;
      return acc;
    }, {});
    logger.info(`SAP sync OV ${fecha} - Resumen por masa:`, resumen);

    return resultado;
  }

  // ─── TIPOS DE MASA ────────────────────────────────────────────────

  /**
   * Obtiene todos los tipos de masa desde la tabla de usuario @JZ_TIPOMASA en SAP.
   * Maneja paginación automáticamente.
   * @returns {Array} [{ code, name }]
   */
  async getTiposMasa() {
    await this.ensureSession();

    const todos = [];
    let skip = 0;
    const top = 20;

    while (true) {
      const response = await this.client.get('/U_JZ_TIPOMASA', {
        params: { $top: top, $skip: skip },
      });

      const items = response.data.value || [];
      todos.push(...items);

      if (items.length < top) break;
      skip += top;
    }

    logger.info(`SAP: ${todos.length} tipos de masa obtenidos de U_JZ_TIPOMASA`);
    return todos.map(item => ({ code: item.Code, name: item.Name }));
  }

  // ─── BOM ──────────────────────────────────────────────────────────

  /**
   * Obtiene todos los artículos con U_JZ_Tipos_Masa configurado (paginado automático).
   * @returns {Array} [{ itemCode, itemName, tipoMasa, salesQtyPerPack, gramaje }]
   */
  async getArticulosConTipoMasa() {
    await this.ensureSession();

    const todos = [];
    let skip = 0;
    const top = 20; // SAP limita a 20 registros por página en este ambiente

    while (true) {
      const response = await this.client.get('/Items', {
        params: {
          $filter: "U_JZ_Tipos_Masa ne null and U_JZ_Tipos_Masa ne '' and Valid eq 'tYES' and Frozen eq 'tNO'",
          $select: 'ItemCode,ItemName,U_JZ_Tipos_Masa,SalesQtyPerPackUnit,SalesUnitWeight1,U_JZ_MultiploDivisor,Valid,Frozen',
          $top: top,
          $skip: skip,
        },
      });

      const items = response.data.value || [];
      todos.push(...items);
      if (items.length < top) break;
      skip += top;
    }

    logger.info(`SAP BOM: ${todos.length} artículos con tipo de masa encontrados`);

    return todos.map(item => ({
      itemCode:        item.ItemCode,
      itemName:        item.ItemName,
      tipoMasa:        item.U_JZ_Tipos_Masa,
      salesQtyPerPack: item.SalesQtyPerPackUnit || 1,
      gramaje:         item.SalesUnitWeight1 || 0,
      multiploDivisor: item.U_JZ_MultiploDivisor != null ? Math.round(item.U_JZ_MultiploDivisor) : 0,
    }));
  }

  /**
   * Obtiene el BOM (ProductTrees) de un artículo específico.
   * Retorna null si el artículo no tiene lista de materiales en SAP.
   * @param {string} itemCode
   * @returns {Array|null} líneas del BOM o null
   */
  async getBOM(itemCode) {
    try {
      await this.ensureSession();

      const response = await this.client.get(
        `/ProductTrees('${itemCode}')?$select=TreeCode,TreeType,Quantity,ProductTreeLines`
      );

      const lines = response.data.ProductTreeLines || [];
      logger.info(`SAP BOM: ${lines.length} componentes para ${itemCode}`);
      return lines;

    } catch (error) {
      // Código -2028 = No matching records found → artículo sin BOM, no es error crítico
      if (error.response?.data?.error?.code === '-2028') {
        logger.warn(`SAP BOM: ${itemCode} no tiene lista de materiales`);
        return null;
      }
      throw error;
    }
  }

  // ─── UOM ──────────────────────────────────────────────────────────
  /**
   * Obtiene InventoryUOM e ItemsGroupCode de una lista de artículos en lote.
   * SAP no expone UoM en ProductTreeLines, hay que consultarla desde Items.
   *
   * @param {string[]} itemCodes - Array de códigos de artículo
   * @returns {Object} mapa { itemCode: { uom, grupoSap } }
   */
  async getItemsUoM(itemCodes) {
    if (!itemCodes || itemCodes.length === 0) return {};

    await this.ensureSession();

    const resultado = {};

    // SAP Service Layer no soporta bien $filter con OR para muchos items,
    // consultamos en lotes de 10 para evitar URLs largas
    const BATCH_SIZE = 10;

    for (let i = 0; i < itemCodes.length; i += BATCH_SIZE) {
      const lote = itemCodes.slice(i, i + BATCH_SIZE);

      for (const itemCode of lote) {
        try {
          const response = await this.client.get(
            `/Items('${itemCode}')?$select=ItemCode,InventoryUOM,ItemsGroupCode`
          );
          resultado[itemCode] = {
            uom:      response.data.InventoryUOM || null,
            grupoSap: response.data.ItemsGroupCode || null,
          };
        } catch (error) {
          // Si el artículo no existe en SAP, lo marcamos sin uom
          logger.warn(`getItemsUoM: no se encontró ${itemCode} en SAP`);
          resultado[itemCode] = { uom: null, grupoSap: null };
        }
      }
    }

    logger.info(`getItemsUoM: ${Object.keys(resultado).length} artículos consultados`);
    return resultado;
  }

  // ─── STOCK ────────────────────────────────────────────────────────

  /**
   * Verificar disponibilidad de stock
   * @param {String} itemCode - Código del artículo
   * @param {String} warehouseCode - Código de bodega
   */
  async verificarStock(itemCode, warehouseCode) {
    try {
      await this.ensureSession();

      const response = await this.client.get(
        `/Items('${itemCode}')/ItemWarehouseInfoCollection?$filter=WarehouseCode eq '${warehouseCode}'&$select=InStock,Committed,OnOrder`
      );

      if (response.data.value.length > 0) {
        const stock = response.data.value[0];
        return {
          disponible: stock.InStock - stock.Committed,
          enStock: stock.InStock,
          comprometido: stock.Committed,
          enOrden: stock.OnOrder
        };
      }

      return {
        disponible: 0,
        enStock: 0,
        comprometido: 0,
        enOrden: 0
      };
    } catch (error) {
      logger.error(`Error al verificar stock de ${itemCode}:`, error.message);
      throw new Error(`Error al consultar stock en SAP: ${error.message}`);
    }
  }

  async getStockMateriaPrima(itemCodes) {
    await this.ensureSession();

    if (!itemCodes || itemCodes.length === 0) return {};

    const resultado = {};

    for (const itemCode of itemCodes) {
      try {
        const response = await this.client.get(
          `/Items('${itemCode}')?$select=ItemCode,ItemName,MovingAveragePrice,InventoryUOM,ManageBatchNumbers,ItemWarehouseInfoCollection`
        );

        const item       = response.data;
        const bodegaAlmp = (item.ItemWarehouseInfoCollection || [])
          .find(b => b.WarehouseCode === 'ALMP');

        resultado[itemCode] = {
          itemCode:             item.ItemCode,
          itemName:             item.ItemName,
          uom:                  item.InventoryUOM,
          manageBatchNumbers:   item.ManageBatchNumbers === 'tYES',
          costoPromedio:        bodegaAlmp?.StandardAveragePrice || item.MovingAveragePrice || 0,
          stockAlmp:            bodegaAlmp?.InStock      || 0,
          committedAlmp:        bodegaAlmp?.Committed    || 0,
          orderedAlmp:          bodegaAlmp?.Ordered      || 0,
        };
      } catch (error) {
        logger.warn(`SAP: no se pudo obtener stock para ${itemCode}: ${error.message}`);
        resultado[itemCode] = null;
      }
    }

    logger.info(`SAP: stock obtenido para ${Object.keys(resultado).length} ítems`);
    return resultado;
  }
  /**
   * Obtiene lotes de materia prima desde BatchNumberDetails (SAP) con cantidades
   * distribuidas proporcionalmente desde stock total por ítem.
   * No usa SQLQuery — evita timeouts 502 del Service Layer de Heinsohn.
   * @param {string[]} itemCodes
   * @param {Object} stockPorItem - mapa itemCode → QuantityOnStock (ya obtenido)
   * @returns {Object} mapa itemCode → array de lotes
   */
  async getLotesMateriaPrima(itemCodes, stockPorItem = {}) {
    if (!itemCodes || itemCodes.length === 0) return {};
    await this.ensureSession();

    // Estrategia: una sola SQLQuery con IN (...) para todos los ítems + paginación $skip.
    // Validado: 84 ítems → 78 lotes en 4 páginas × ~0.3s = ~1-2s total
    // (vs. el enfoque anterior: 1 query por ítem × 3 llamadas × 49 ítems = ~2 minutos)
    const SQL_CODE = 'artesa_lotes_mp_batch';
    const resultado = {};

    const parseFechaSAP = (val) => {
      if (!val) return null;
      const s = String(val).replace(/\D/g, '');
      if (s.length === 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
      return null;
    };

    try {
      // 1. Partir itemCodes en chunks de 15 para evitar timeouts en SAP
      const CHUNK_SIZE = 15;
      const chunks = [];
      for (let i = 0; i < itemCodes.length; i += CHUNK_SIZE) {
        chunks.push(itemCodes.slice(i, i + CHUNK_SIZE));
      }
      logger.info(`SAP: lotes MP — ${itemCodes.length} ítems en ${chunks.length} chunks de ${CHUNK_SIZE}`);

      const todasLasFilas = [];

      for (const [idx, chunk] of chunks.entries()) {
        const inClause = chunk.map(c => `'${c}'`).join(',');
        const sqlText = `SELECT "OBTN"."ItemCode", "OBTN"."DistNumber", "OBTQ"."Quantity", "OBTN"."ExpDate", "OBTN"."MnfDate", "OBTN"."CreateDate" FROM "OBTN" INNER JOIN "OBTQ" ON "OBTN"."ItemCode" = "OBTQ"."ItemCode" AND "OBTN"."SysNumber" = "OBTQ"."SysNumber" WHERE "OBTN"."ItemCode" IN (${inClause}) AND "OBTQ"."WhsCode" = 'ALMP' AND "OBTQ"."Quantity" > 0`;
        try {
          await this.client.delete(`/SQLQueries('${SQL_CODE}')`, { timeout: 10000 });
        } catch {
          // No existe aún — ignorar
        }
        await this.client.post('/SQLQueries', {
          SqlCode: SQL_CODE,
          SqlName: SQL_CODE,
          SqlText: sqlText,
        }, { timeout: 10000 });
        // Paginar con $skip hasta agotar resultados (SAP devuelve máx 20 por página)
        let skip = 0;
        while (true) {
          const resp = await this.client.get(
            `/SQLQueries('${SQL_CODE}')/List?$skip=${skip}`,
            { timeout: 30000 }
          );
          const rows = resp.data?.value || [];
          todasLasFilas.push(...rows);
          if (rows.length < 20) break;
          skip += 20;
        }
        logger.info(`SAP: lotes chunk ${idx + 1}/${chunks.length} — ${chunk.length} ítems OK`);
      }
      logger.info(`SAP: lotes MP batch — ${todasLasFilas.length} filas totales para ${itemCodes.length} ítems`);

      // 3. Agrupar por ItemCode
      for (const row of todasLasFilas) {
        const itemCode = row.ItemCode;
        if (!itemCode) continue;
        if (!resultado[itemCode]) resultado[itemCode] = [];
        resultado[itemCode].push({
          batch:               row.DistNumber,
          cantidad_disponible: parseFloat(parseFloat(row.Quantity).toFixed(3)),
          admissionDate:       parseFechaSAP(row.CreateDate),
          expirationDate:      parseFechaSAP(row.ExpDate),
          manufacturingDate:   parseFechaSAP(row.MnfDate),
          status:              'released',
        });
      }

      // 4. Ordenar lotes por fecha de ingreso (FIFO)
      for (const itemCode of Object.keys(resultado)) {
        resultado[itemCode].sort((a, b) => {
          if (!a.admissionDate) return 1;
          if (!b.admissionDate) return -1;
          return a.admissionDate.localeCompare(b.admissionDate);
        });
        logger.info(`SAP: lotes ALMP para ${itemCode}: ${resultado[itemCode].length} lotes via batch`);
      }

    } catch (err) {
      logger.error(`SAP: getLotesMateriaPrima batch falló: ${err?.message}. Sin lotes disponibles.`);
      // Retorna vacío — el inventario MP ya se sincronizó correctamente (stock/costo)
    }

    logger.info(`SAP: lotes obtenidos para ${Object.keys(resultado).length} ítems via batch OBTQ`);
    return resultado;
  }
}

// Singleton
const sapService = new SAPService();

module.exports = sapService;
