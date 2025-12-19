/**
 * Pruebas unitarias para Rate Limiter
 * 
 * Ejecutar con: npm test -- --testPathPattern=rateLimiter
 * 
 * Recomendado: jest o mocha + chai
 */

const request = require('supertest');
const express = require('express');

// Mock de dependencias
jest.mock('../config', () => ({
  rateLimit: {
    windowMs: 60000,
    max: 10,
    message: 'Too many requests',
    standardHeaders: true,
    legacyHeaders: false,
  },
}));

jest.mock('../utils/logger', () => ({
  logSecurity: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const {
  general,
  auth,
  create,
  update,
  delete: deleteLimiter,
  sap,
  query,
  admin,
  strict,
  export: exportLimiter,
} = require('../middleware/rateLimiter');

describe('Rate Limiter Middleware', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  // ============================================================================
  // PRUEBAS: General Limiter
  // ============================================================================

  describe('General Limiter', () => {
    beforeEach(() => {
      app.use('/api', general);
      app.get('/api/test', (req, res) => {
        res.json({ success: true });
      });
    });

    test('Debe permitir requests dentro del límite', async () => {
      const response = await request(app).get('/api/test');
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('Debe incluir headers de RateLimit', async () => {
      const response = await request(app).get('/api/test');
      expect(response.headers['ratelimit-limit']).toBeDefined();
      expect(response.headers['ratelimit-remaining']).toBeDefined();
      expect(response.headers['ratelimit-reset']).toBeDefined();
    });

    test('Debe excluir /health del rate limiting', async () => {
      app.use('/health', (req, res) => {
        res.json({ status: 'ok' });
      });

      // Hacer múltiples requests (más que el límite)
      for (let i = 0; i < 15; i++) {
        const response = await request(app).get('/health');
        expect(response.status).toBe(200);
      }
    });
  });

  // ============================================================================
  // PRUEBAS: Auth Limiter
  // ============================================================================

  describe('Auth Limiter', () => {
    beforeEach(() => {
      app.post('/api/login', auth, (req, res) => {
        // Simulación simple: fallido si no hay password correcto
        if (req.body.password === 'correct') {
          res.json({ success: true, token: 'fake-token' });
        } else {
          res.status(401).json({ success: false, error: 'Invalid password' });
        }
      });
    });

    test('Debe resetear contador en login exitoso', async () => {
      // Primer intento fallido
      let response = await request(app)
        .post('/api/login')
        .send({ username: 'user', password: 'wrong' });
      expect(response.status).toBe(401);

      // Login exitoso debe resetear
      response = await request(app)
        .post('/api/login')
        .send({ username: 'user', password: 'correct' });
      expect(response.status).toBe(200);

      // Debe permitir más intentos fallidos después
      response = await request(app)
        .post('/api/login')
        .send({ username: 'user', password: 'wrong' });
      expect(response.status).toBe(401);
    });

    test('Debe bloquear después de 5 intentos fallidos', async () => {
      // 5 intentos fallidos
      for (let i = 0; i < 5; i++) {
        const response = await request(app)
          .post('/api/login')
          .send({ username: 'user', password: 'wrong' });
        expect(response.status).toBe(401);
      }

      // El 6to intento debe ser bloqueado por rate limit
      const response = await request(app)
        .post('/api/login')
        .send({ username: 'user', password: 'wrong' });
      expect(response.status).toBe(429);
      expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(response.body.error.type).toBe('AUTH');
    });

    test('Debe incluir retryAfter en respuesta de bloqueo', async () => {
      // Bloquear
      for (let i = 0; i < 6; i++) {
        await request(app)
          .post('/api/login')
          .send({ username: 'user', password: 'wrong' });
      }

      // Solicitud bloqueada debe incluir retryAfter
      const response = await request(app)
        .post('/api/login')
        .send({ username: 'user', password: 'wrong' });

      expect(response.status).toBe(429);
      expect(response.body.error.retryAfter).toBeDefined();
      expect(response.body.error.resetTime).toBeDefined();
    });
  });

  // ============================================================================
  // PRUEBAS: Create Limiter
  // ============================================================================

  describe('Create Limiter', () => {
    beforeEach(() => {
      app.post('/api/users', create, (req, res) => {
        res.status(201).json({ id: 1, name: req.body.name });
      });
    });

    test('Debe permitir creación dentro del límite', async () => {
      const response = await request(app)
        .post('/api/users')
        .send({ name: 'John' });
      expect(response.status).toBe(201);
    });

    test('Debe bloquear después de 15 creaciones por minuto', async () => {
      // 15 creaciones
      for (let i = 0; i < 15; i++) {
        const response = await request(app)
          .post('/api/users')
          .send({ name: `User${i}` });
        expect(response.status).toBe(201);
      }

      // 16ta debe ser bloqueada
      const response = await request(app)
        .post('/api/users')
        .send({ name: 'User16' });
      expect(response.status).toBe(429);
    });
  });

  // ============================================================================
  // PRUEBAS: Delete Limiter
  // ============================================================================

  describe('Delete Limiter', () => {
    beforeEach(() => {
      app.delete('/api/users/:id', deleteLimiter, (req, res) => {
        res.json({ success: true, deleted: true });
      });
    });

    test('Debe ser más restrictivo que create', async () => {
      // Delete permite 5, create permite 15
      const createLimitResults = [];
      const deleteLimitResults = [];

      // Simular 10 creaciones
      for (let i = 0; i < 10; i++) {
        const response = await request(app)
          .post('/api/users')
          .send({ name: `User${i}` });
        createLimitResults.push(response.status);
      }

      // Simular 6 eliminaciones
      for (let i = 1; i <= 6; i++) {
        const response = await request(app)
          .delete(`/api/users/${i}`);
        deleteLimitResults.push(response.status);
      }

      // Las 5 primeras creaciones deben pasar
      expect(createLimitResults.slice(0, 5).every(s => s === 201)).toBe(true);

      // Las 5 primeras eliminaciones deben pasar
      expect(deleteLimitResults.slice(0, 5).every(s => s === 200)).toBe(true);

      // La 6ta eliminación debe ser bloqueada
      expect(deleteLimitResults[5]).toBe(429);
    });
  });

  // ============================================================================
  // PRUEBAS: Strict Limiter
  // ============================================================================

  describe('Strict Limiter', () => {
    beforeEach(() => {
      app.put('/api/password', strict, (req, res) => {
        res.json({ success: true });
      });
    });

    test('Debe ser muy restrictivo (3 por minuto)', async () => {
      // 3 requests deben pasar
      for (let i = 0; i < 3; i++) {
        const response = await request(app)
          .put('/api/password')
          .send({ newPassword: 'test' });
        expect(response.status).toBe(200);
      }

      // 4to debe ser bloqueado
      const response = await request(app)
        .put('/api/password')
        .send({ newPassword: 'test' });
      expect(response.status).toBe(429);
    });
  });

  // ============================================================================
  // PRUEBAS: Logging
  // ============================================================================

  describe('Security Logging', () => {
    let loggerMock;

    beforeEach(() => {
      loggerMock = require('../utils/logger');
      loggerMock.logSecurity.mockClear();

      app.post('/api/login', auth, (req, res) => {
        res.status(401).json({ error: 'Invalid' });
      });
    });

    test('Debe loguear intentos de rate limit bloqueados', async () => {
      // Causar bloqueo
      for (let i = 0; i < 6; i++) {
        await request(app)
          .post('/api/login')
          .send({ username: 'user', password: 'wrong' });
      }

      expect(loggerMock.logSecurity).toHaveBeenCalled();
      expect(loggerMock.logSecurity).toHaveBeenCalledWith(
        'RATE_LIMIT_EXCEEDED_AUTH',
        expect.objectContaining({
          ip: expect.any(String),
          path: '/api/login',
          method: 'POST',
        })
      );
    });
  });

  // ============================================================================
  // PRUEBAS: Respuesta JSON
  // ============================================================================

  describe('Rate Limit Response Format', () => {
    beforeEach(() => {
      app.post('/api/test', auth, (req, res) => {
        res.status(401).json({ error: 'Invalid' });
      });
    });

    test('Debe retornar estructura JSON correcta cuando es bloqueado', async () => {
      // Bloquear
      for (let i = 0; i < 6; i++) {
        await request(app)
          .post('/api/test')
          .send({ username: 'user', password: 'wrong' });
      }

      const response = await request(app)
        .post('/api/test')
        .send({ username: 'user', password: 'wrong' });

      expect(response.status).toBe(429);
      expect(response.body).toEqual({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          type: 'AUTH',
          message: expect.any(String),
          retryAfter: expect.any(Number),
          resetTime: expect.any(String),
        },
      });
    });
  });

  // ============================================================================
  // PRUEBAS: Headers
  // ============================================================================

  describe('RateLimit Headers', () => {
    beforeEach(() => {
      app.get('/api/test', general, (req, res) => {
        res.json({ ok: true });
      });
    });

    test('Debe incluir headers RateLimit en cada respuesta', async () => {
      const response = await request(app).get('/api/test');

      expect(response.headers).toHaveProperty('ratelimit-limit');
      expect(response.headers).toHaveProperty('ratelimit-remaining');
      expect(response.headers).toHaveProperty('ratelimit-reset');

      // Valores deben ser numéricos
      expect(Number(response.headers['ratelimit-limit'])).toBeGreaterThan(0);
      expect(Number(response.headers['ratelimit-remaining'])).toBeGreaterThanOrEqual(0);
    });
  });
});

/**
 * PRUEBAS ADICIONALES PARA ENTORNO DE PRODUCCIÓN
 * 
 * Considera agregar pruebas para:
 * 1. Comportamiento con Redis habilitado
 * 2. Sincronización entre múltiples instancias
 * 3. Reset correcto después de la ventana de tiempo
 * 4. IP detrás de proxies (X-Forwarded-For)
 * 5. Comportamiento bajo carga alta
 * 6. Métricas y monitoreo de rate limiting
 */
