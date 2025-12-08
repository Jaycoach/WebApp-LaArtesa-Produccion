const { Pool } = require('pg');
const config = require('../config');
const logger = require('../utils/logger');

class Database {
  constructor() {
    this.pool = null;
    this.connected = false;
  }

  /**
   * Conectar a la base de datos
   */
  async connect() {
    try {
      this.pool = new Pool({
        host: config.database.host,
        port: config.database.port,
        database: config.database.name,
        user: config.database.user,
        password: config.database.password,
        ssl: config.database.ssl,
        min: config.database.pool.min,
        max: config.database.pool.max,
        idleTimeoutMillis: config.database.pool.idle,
        connectionTimeoutMillis: 5000,
      });

      // Eventos del pool
      this.pool.on('connect', () => {
        logger.debug('Nueva conexión establecida con PostgreSQL');
      });

      this.pool.on('error', (err) => {
        logger.error('Error inesperado en el pool de conexiones:', err);
      });

      this.pool.on('remove', () => {
        logger.debug('Conexión removida del pool');
      });

      // Verificar conexión
      const client = await this.pool.connect();
      const result = await client.query('SELECT NOW()');
      client.release();

      this.connected = true;
      logger.info(`Conectado a PostgreSQL: ${config.database.name}@${config.database.host}:${config.database.port}`);
      logger.debug(`Tiempo del servidor DB: ${result.rows[0].now}`);

      return this.pool;
    } catch (error) {
      this.connected = false;
      logger.error('Error al conectar con PostgreSQL:', error);
      throw error;
    }
  }

  /**
   * Desconectar de la base de datos
   */
  async disconnect() {
    try {
      if (this.pool) {
        await this.pool.end();
        this.connected = false;
        logger.info('Desconectado de PostgreSQL');
      }
    } catch (error) {
      logger.error('Error al desconectar de PostgreSQL:', error);
      throw error;
    }
  }

  /**
   * Verificar si está conectado
   */
  isConnected() {
    return this.connected;
  }

  /**
   * Ejecutar query
   */
  async query(text, params) {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      if (config.server.env === 'development') {
        logger.debug(`Query ejecutado en ${duration}ms:`, { text, params });
      }
      
      return result;
    } catch (error) {
      logger.error('Error ejecutando query:', { text, params, error: error.message });
      throw error;
    }
  }

  /**
   * Obtener un cliente del pool para transacciones
   */
  async getClient() {
    try {
      const client = await this.pool.connect();
      
      // Agregar método de release mejorado
      const release = client.release;
      client.release = () => {
        client.release = release;
        return release.apply(client);
      };
      
      return client;
    } catch (error) {
      logger.error('Error obteniendo cliente del pool:', error);
      throw error;
    }
  }

  /**
   * Ejecutar transacción
   */
  async transaction(callback) {
    const client = await this.getClient();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error en transacción, rollback ejecutado:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Verificar que existan las tablas principales
   */
  async verifyTables() {
    try {
      const requiredTables = [
        'usuarios',
        'ordenes_produccion',
        'etapas_proceso',
        'control_calidad',
        'recetas',
        'lotes',
        'sap_sync_log',
        'auditoria',
      ];

      const query = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND table_name = ANY($1)
      `;

      const result = await this.query(query, [requiredTables]);
      const existingTables = result.rows.map(row => row.table_name);

      const missingTables = requiredTables.filter(
        table => !existingTables.includes(table)
      );

      if (missingTables.length > 0) {
        logger.warn(`⚠️  Tablas faltantes: ${missingTables.join(', ')}`);
        logger.warn('Ejecute las migraciones: npm run db:migrate');
      } else {
        logger.info(`✅ Todas las tablas requeridas existen (${existingTables.length})`);
      }

      return existingTables;
    } catch (error) {
      logger.error('Error verificando tablas:', error);
      throw error;
    }
  }

  /**
   * Estadísticas del pool de conexiones
   */
  getPoolStats() {
    if (!this.pool) return null;

    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };
  }

  /**
   * Health check de la base de datos
   */
  async healthCheck() {
    try {
      const start = Date.now();
      await this.query('SELECT 1');
      const responseTime = Date.now() - start;

      return {
        status: 'healthy',
        responseTime,
        pool: this.getPoolStats(),
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        pool: this.getPoolStats(),
      };
    }
  }
}

// Exportar instancia singleton
const db = new Database();

module.exports = db;
