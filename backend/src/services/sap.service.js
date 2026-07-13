/**
 * Servicio de integración con SAP Business One
 * Utiliza SAP Service Layer API
 */

const axios = require('axios');
const https = require('https');
const logger = require('../utils/logger');
const config = require('../config');

// Fallback: infiere tamaño/forma desde el nombre del producto cuando el UDF viene null en SAP.
// Mismo patrón que el fallback de unidades_por_paquete (regex sobre el nombre).
const TAMANIOS_CONOCIDOS = ['GRANDE', 'MEDIANO', 'MEDIANA', 'PEQUEÑO', 'PEQUEÑA', 'JUNIOR', 'JR'];
const FORMAS_CONOCIDAS = ['CUADRADO', 'CUADRADA', 'REDONDO', 'REDONDA', 'TRIANGULAR', 'RECTANGULAR', 'OVALADO', 'ALARGADO'];

function inferirTamanioForma(itemName) {
  const nombre = (itemName || '').toUpperCase();
  const tamanio = TAMANIOS_CONOCIDOS.find(t => nombre.includes(t)) || null;
  const forma = FORMAS_CONOCIDAS.find(f => nombre.includes(f)) || null;
  return { tamanio, forma };
}

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
          lineNum: linea.LineNum ?? 0,
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
          $select: 'ItemCode,ItemName,SalesQtyPerPackUnit,U_JZ_Tipos_Masa,SalesUnitWeight1,U_JZ_MultiploDivisor,U_JZ_Tamanio,U_JZ_Forma,Valid,Frozen',
          $top: BATCH,
        },
      });

      for (const item of (response.data.value || [])) {
        if (item.Valid === 'tNO' || item.Frozen === 'tYES') {
          logger.warn(`SAP OV: artículo inactivo/congelado omitido: ${item.ItemCode} (Valid=${item.Valid}, Frozen=${item.Frozen})`);
          continue;
        }
        const fallbackAtributos = inferirTamanioForma(item.ItemName);
        resultado[item.ItemCode] = {
          itemName:            item.ItemName,
          salesQtyPerPackUnit: item.SalesQtyPerPackUnit || 1,
          tipoMasa:            item.U_JZ_Tipos_Masa || 'SIN_CLASIFICAR',
          gramaje:             item.SalesUnitWeight1 || 0,
          multiploDivisor:     item.U_JZ_MultiploDivisor != null ? Math.round(item.U_JZ_MultiploDivisor) : 0,
          tamanio:             item.U_JZ_Tamanio || fallbackAtributos.tamanio,
          forma:               item.U_JZ_Forma || fallbackAtributos.forma,
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
    if (process.env.SAP_READ_MODE === 'hana') {
      return this._getDatosParaSincronizacionHANA(fecha);
    }

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
        lineNum: linea.lineNum ?? 0,
        itemCode: linea.itemCode,
        descripcion: art.itemName || linea.itemDescription,
        tipoMasa: art.tipoMasa,
        unidadesPedidas,
        unidadesPorPaquete,
        cantidadPaquetes,
        gramaje,
        kilosPedidos,
        multiploDivisor: art.multiploDivisor || 0,
        tamanio: art.tamanio || null,
        forma: art.forma || null,
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
    if (process.env.SAP_READ_MODE === 'hana') {
      return this._getTiposMasaHANA();
    }

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
    return todos.map(item => ({
      code: item.Code,
      name: item.Name,
      // TOSCANO mantiene fallback de 130kg si el UDF viene null; el resto cae a 90kg (ver fases.controller.js)
      maxDiv: item.U_JZ_MaxDiv != null ? Number(item.U_JZ_MaxDiv) : null,
    }));
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
          $select: 'ItemCode,ItemName,U_JZ_Tipos_Masa,SalesQtyPerPackUnit,SalesUnitWeight1,U_JZ_MultiploDivisor,U_JZ_Tamanio,U_JZ_Forma,Valid,Frozen',
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

    return todos.map(item => {
      const fallbackAtributos = inferirTamanioForma(item.ItemName);
      return {
        itemCode:        item.ItemCode,
        itemName:        item.ItemName,
        tipoMasa:        item.U_JZ_Tipos_Masa,
        salesQtyPerPack: item.SalesQtyPerPackUnit || 1,
        gramaje:         item.SalesUnitWeight1 || 0,
        multiploDivisor: item.U_JZ_MultiploDivisor != null ? Math.round(item.U_JZ_MultiploDivisor) : 0,
        tamanio:         item.U_JZ_Tamanio || fallbackAtributos.tamanio,
        forma:           item.U_JZ_Forma || fallbackAtributos.forma,
      };
    });
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
            `/Items('${itemCode}')?$select=ItemCode,InventoryUOM,ItemsGroupCode,U_JZ_Decoracion`
          );
          resultado[itemCode] = {
            uom:          response.data.InventoryUOM || null,
            grupoSap:     response.data.ItemsGroupCode || null,
            esDecoracion: String(response.data.U_JZ_Decoracion || '').trim().toUpperCase() === 'SI',
          };
        } catch (error) {
          // Si el artículo no existe en SAP, lo marcamos sin uom
          logger.warn(`getItemsUoM: no se encontró ${itemCode} en SAP`);
          resultado[itemCode] = { uom: null, grupoSap: null, esDecoracion: false };
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

    if (process.env.SAP_READ_MODE === 'hana') {
      return this._getLotesMateriaPrimaHANA(itemCodes);
    }

    await this.ensureSession();

    // Estrategia: artlot_ individual por ítem via SQLQuery (OBTN+OBTQ filtrado por ItemCode+ALMP).
    // Concurrencia de 5 ítems en paralelo — HBT_ARTESA tarda ~28s por ítem en OBTQ full scan.
    // Promise.allSettled garantiza que un ítem fallido no cancela los demás.
    const CONCURRENCIA = 5;
    const resultado = {};

    const parseFechaSAP = (val) => {
      if (!val) return null;
      const s = String(val).replace(/\D/g, '');
      if (s.length === 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
      return null;
    };

    const retryConBackoff = async (fn, etiqueta, intentos = 3, delayBaseMs = 3000) => {
      let ultimoError;
      for (let intento = 1; intento <= intentos; intento++) {
        try {
          return await fn();
        } catch (err) {
          ultimoError = err;
          const esUltimoIntento = intento === intentos;
          if (!esUltimoIntento) {
            const delay = delayBaseMs * intento; // 3s, 6s — backoff lineal
            logger.warn(`SAP: [${etiqueta}] intento ${intento}/${intentos} falló (${err.message}). Reintentando en ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
          } else {
            logger.error(`SAP: [${etiqueta}] falló tras ${intentos} intentos. Último error: ${err.message}`);
          }
        }
      }
      throw ultimoError;
    };
    const obtenerLotesItem = async (itemCode) => {
      const sqlCode = `artlot_${itemCode.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const sqlText = `SELECT "OBTN"."DistNumber", "OBTQ"."Quantity", "OBTN"."ExpDate", "OBTN"."MnfDate", "OBTN"."CreateDate" FROM "OBTN" INNER JOIN "OBTQ" ON "OBTN"."ItemCode" = "OBTQ"."ItemCode" AND "OBTN"."SysNumber" = "OBTQ"."SysNumber" WHERE "OBTN"."ItemCode" = '${itemCode}' AND "OBTQ"."WhsCode" = 'ALMP' AND "OBTQ"."Quantity" > 0`;
      try {
        await this.client.delete(`/SQLQueries('${sqlCode}')`, { timeout: 10000 });
      } catch { /* no existe aún — ignorar */ }
      await this.client.post('/SQLQueries', {
        SqlCode: sqlCode, SqlName: sqlCode, SqlText: sqlText,
      }, { timeout: 10000 });
      const resp = await this.client.get(
        `/SQLQueries('${sqlCode}')/List`,
        { timeout: 60000 }
      );
      return { itemCode, rows: resp.data?.value || [] };
    };

    const itemsFallidos = [];
    // Procesar en grupos de CONCURRENCIA ítems en paralelo
    logger.info(`SAP: lotes MP — ${itemCodes.length} ítems, concurrencia ${CONCURRENCIA}`);
    for (let i = 0; i < itemCodes.length; i += CONCURRENCIA) {
      const grupo = itemCodes.slice(i, i + CONCURRENCIA);
      const resultados = await Promise.allSettled(grupo.map(code => retryConBackoff(() => obtenerLotesItem(code), code)));
      for (let j = 0; j < resultados.length; j++) {
        const res = resultados[j];
        const code = grupo[j];
        if (res.status === 'rejected') {
          itemsFallidos.push(code);
          logger.warn(`SAP: lotes fallaron para un ítem del grupo: ${res.reason?.message}`);
          continue;
        }
        const { itemCode, rows } = res.value;
        if (rows.length === 0) continue;
        resultado[itemCode] = rows.map(row => ({
          batch:               row.DistNumber,
          cantidad_disponible: parseFloat(parseFloat(row.Quantity).toFixed(3)),
          admissionDate:       parseFechaSAP(row.CreateDate),
          expirationDate:      parseFechaSAP(row.ExpDate),
          manufacturingDate:   parseFechaSAP(row.MnfDate),
          status:              'released',
        })).sort((a, b) => {
          if (!a.admissionDate) return 1;
          if (!b.admissionDate) return -1;
          return a.admissionDate.localeCompare(b.admissionDate);
        });
        logger.info(`SAP: lotes ALMP para ${itemCode}: ${resultado[itemCode].length} lotes`);
      }
      logger.info(`SAP: lotes grupo ${Math.floor(i/CONCURRENCIA)+1}/${Math.ceil(itemCodes.length/CONCURRENCIA)} completado`);
    }

    logger.info(`SAP: lotes obtenidos para ${Object.keys(resultado).length} ítems via artlot_ individual`);
    return { lotes: resultado, itemsFallidos };
  }

  /**
   * Extrae lotes de materia prima directo de HANA vía script Python (hdbcli).
   * Reemplaza las 19 llamadas artlot_{ITEM_CODE} por una sola consulta consolidada.
   * Mismo shape de retorno que getLotesMateriaPrima (Service Layer).
   */
  async _getLotesMateriaPrimaHANA(itemCodes) {
    const { execFile } = require('child_process');
    const path = require('path');

    return new Promise((resolve) => {
      const scriptPath = path.join(__dirname, '../../scripts/hana_lotes_mp.py');
      const child = execFile('python3', [scriptPath], {
        timeout: 30000,
        env: process.env,
      }, (error, stdout, stderr) => {
        if (error) {
          logger.error(`HANA lotes: error ejecutando script Python: ${error.message}. stderr: ${stderr}`);
          // Fallback: todos los ítems marcados como fallidos, igual que un timeout de Service Layer
          return resolve({ lotes: {}, itemsFallidos: itemCodes });
        }
        try {
          const parsed = JSON.parse(stdout);
          if (parsed.error) {
            logger.error(`HANA lotes: error reportado por script: ${parsed.error}`);
            return resolve({ lotes: {}, itemsFallidos: itemCodes });
          }
          logger.info(`HANA lotes: obtenidos para ${Object.keys(parsed.lotes).length}/${itemCodes.length} ítems vía HANA directo`);
          resolve(parsed);
        } catch (parseErr) {
          logger.error(`HANA lotes: respuesta no parseable: ${parseErr.message}. stdout: ${stdout}`);
          resolve({ lotes: {}, itemsFallidos: itemCodes });
        }
      });
      child.stdin.write(JSON.stringify(itemCodes));
      child.stdin.end();
    });
  }

  /**
   * Extrae tipos de masa directo de HANA vía script Python (hdbcli).
   * Reemplaza la llamada Service Layer a /U_JZ_TIPOMASA. Mismo shape de retorno.
   */
  async _getTiposMasaHANA() {
    const { execFile } = require('child_process');
    const path = require('path');

    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, '../../scripts/hana_tipos_masa.py');
      execFile('python3', [scriptPath], {
        timeout: 15000,
        env: process.env,
      }, (error, stdout, stderr) => {
        if (error) {
          logger.error(`HANA tipos de masa: error ejecutando script Python: ${error.message}. stderr: ${stderr}`);
          return reject(error);
        }
        try {
          const parsed = JSON.parse(stdout);
          if (parsed.error) {
            logger.error(`HANA tipos de masa: error reportado por script: ${parsed.error}`);
            return reject(new Error(parsed.error));
          }
          logger.info(`HANA tipos de masa: ${parsed.tipos.length} tipos obtenidos vía HANA directo`);
          resolve(parsed.tipos);
        } catch (parseErr) {
          logger.error(`HANA tipos de masa: respuesta no parseable: ${parseErr.message}. stdout: ${stdout}`);
          reject(parseErr);
        }
      });
    });
  }

  /**
   * Extrae artículos con tipo de masa + su BOM completo (componentes con UoM/grupo/decoración)
   * directo de HANA vía script Python. Reemplaza getArticulosConTipoMasa() + getBOM() +
   * getItemsUoM() (Service Layer, secuencial por artículo) por una sola consulta consolidada.
   */
  async getArticulosConTipoMasaConBOMHANA() {
    const { execFile } = require('child_process');
    const path = require('path');

    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, '../../scripts/hana_bom_completo.py');
      execFile('python3', [scriptPath], {
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 20, // 20MB — el dataset completo puede ser grande
        env: process.env,
      }, (error, stdout, stderr) => {
        if (error) {
          logger.error(`HANA BOM completo: error ejecutando script Python: ${error.message}. stderr: ${stderr}`);
          return reject(error);
        }
        try {
          const parsed = JSON.parse(stdout);
          if (parsed.error) {
            logger.error(`HANA BOM completo: error reportado por script: ${parsed.error}`);
            return reject(new Error(parsed.error));
          }
          logger.info(`HANA BOM completo: ${parsed.articulos.length} artículos obtenidos vía HANA directo`);
          resolve(parsed.articulos);
        } catch (parseErr) {
          logger.error(`HANA BOM completo: respuesta no parseable: ${parseErr.message}`);
          reject(parseErr);
        }
      });
    });
  }

  /**
   * Obtiene OV abiertas + info de artículos directo de HANA vía script Python (hdbcli).
   * Reemplaza getOrdenesVenta() + getArticulosInfo() (Service Layer) por una sola
   * consulta consolidada ORDR/RDR1/OITM. Mismo shape de retorno que getDatosParaSincronizacion.
   * A diferencia de _getLotesMateriaPrimaHANA, un fallo aquí SÍ debe propagarse como error
   * (no hay fallback silencioso: una sincronización de OV fallida no puede reportarse
   * como "0 OV encontradas", sería un falso negativo peligroso para producción).
   */
  async _getDatosParaSincronizacionHANA(fecha) {
    const { execFile } = require('child_process');
    const path = require('path');

    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, '../../scripts/hana_ov_sync.py');
      const child = execFile('python3', [scriptPath], {
        timeout: 30000,
        env: process.env,
      }, (error, stdout, stderr) => {
        if (error) {
          logger.error(`HANA OV sync: error ejecutando script Python: ${error.message}. stderr: ${stderr}`);
          return reject(new Error(`Fallo en sincronización OV vía HANA: ${error.message}`));
        }
        try {
          const parsed = JSON.parse(stdout);
          if (parsed && parsed.error) {
            logger.error(`HANA OV sync: error reportado por script: ${parsed.error}`);
            return reject(new Error(`Fallo en sincronización OV vía HANA: ${parsed.error}`));
          }
          const resumen = parsed.reduce((acc, p) => {
            acc[p.tipoMasa] = (acc[p.tipoMasa] || 0) + p.cantidadPaquetes;
            return acc;
          }, {});
          logger.info(`HANA OV sync: ${parsed.length} líneas obtenidas para ${fecha} - Resumen por masa:`, resumen);
          resolve(parsed);
        } catch (parseErr) {
          logger.error(`HANA OV sync: respuesta no parseable: ${parseErr.message}. stdout: ${stdout}`);
          reject(new Error(`Fallo en sincronización OV vía HANA: respuesta no parseable`));
        }
      });
      child.stdin.write(JSON.stringify({ fecha }));
      child.stdin.end();
    });
  }
}

// Singleton
const sapService = new SAPService();

module.exports = sapService;
