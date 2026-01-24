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

      // Construir filtro ODATA
      let filter = '';
      const conditions = [];

      if (fecha) {
        // Filtrar por fecha de producción
        conditions.push(`PostingDate eq '${fecha}'`);
      }

      if (estado) {
        // Filtrar por estado (P=Planned, R=Released, C=Closed, L=Canceled)
        conditions.push(`Status eq '${estado}'`);
      } else {
        // Por defecto, solo órdenes planeadas y liberadas
        conditions.push(`(Status eq 'P' or Status eq 'R')`);
      }

      if (conditions.length > 0) {
        filter = `$filter=${conditions.join(' and ')}`;
      }

      // Consultar órdenes de fabricación (tabla OWOR)
      const response = await this.client.get(
        `/ProductionOrders?${filter}&$select=DocEntry,DocNum,ItemCode,ProductDescription,PlannedQuantity,PostingDate,Status,U_TipoMasa`
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
  async getListaMateriales(docEntry) {
    try {
      await this.ensureSession();

      // Obtener líneas de la orden de fabricación
      const response = await this.client.get(
        `/ProductionOrders(${docEntry})?$select=ProductionOrderLines`
      );

      const lines = response.data.ProductionOrderLines || [];

      logger.info(`Se obtuvieron ${lines.length} materiales para orden ${docEntry}`);
      return lines;
    } catch (error) {
      logger.error(`Error al obtener lista de materiales de orden ${docEntry}:`, error.message);
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
}

// Singleton
const sapService = new SAPService();

module.exports = sapService;
