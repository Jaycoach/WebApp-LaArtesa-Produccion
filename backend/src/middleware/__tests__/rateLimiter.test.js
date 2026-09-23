/**
 * Pruebas unitarias para Rate Limiter
 *
 * Ejecutar con: npm test -- --testPathPattern=rateLimiter
 *
 * Recomendado: jest o mocha + chai
 */

const request = require('supertest');
const express = require('express');

const jwt = require('jsonwebtoken');

const JWT_TEST_SECRET = 'test-secret';

// Mock de dependencias
jest.mock('../../config', () => ({
  rateLimit: {
    windowMs: 60000,
    max: 10,
    userMax: 40,
    message: 'Too many requests',
    standardHeaders: true,
    legacyHeaders: false,
  },
  jwt: {
    secret: 'test-secret',
  },
}));

jest.mock('../../utils/logger', () => ({
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
} = require('../rateLimiter');

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
      const response = await request(app).get('/api/test').set('x-real-ip', '10.1.1.1');
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('Debe incluir headers de RateLimit', async () => {
      const response = await request(app).get('/api/test').set('x-real-ip', '10.1.1.2');
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
        const response = await request(app).get('/health').set('x-real-ip', '10.1.1.3');
        expect(response.status).toBe(200);
      }
    });

    test('Debe excluir /version del rate limiting (montado en /api/)', async () => {
      app.get('/api/version', (req, res) => {
        res.json({ version: '1.0.0' });
      });

      // Más peticiones que el límite mockeado (10) y ninguna debe ser bloqueada
      for (let i = 0; i < 12; i++) {
        const response = await request(app).get('/api/version').set('x-real-ip', '10.1.1.4');
        expect(response.status).toBe(200);
      }
    });
  });

  // ============================================================================
  // PRUEBAS: Límite diferenciado por token (C1)
  // ============================================================================

  describe('Límite diferenciado por token JWT', () => {
    beforeEach(() => {
      app.use('/api', general);
      app.get('/api/test', (req, res) => {
        res.json({ success: true });
      });
    });

    test('El límite con token válido (userMax) es distinto del límite sin token (max anónimo)', async () => {
      const validToken = jwt.sign({ id: 999 }, JWT_TEST_SECRET);

      const anonResponse = await request(app)
        .get('/api/test')
        .set('x-real-ip', '10.2.1.1');
      const authResponse = await request(app)
        .get('/api/test')
        .set('x-real-ip', '10.2.1.2')
        .set('Authorization', `Bearer ${validToken}`);

      // Mock de config: rateLimit.max = 10 (anónimo), rateLimit.userMax = 40 (con token)
      expect(Number(anonResponse.headers['ratelimit-limit'])).toBe(10);
      expect(Number(authResponse.headers['ratelimit-limit'])).toBe(40);
      expect(Number(authResponse.headers['ratelimit-limit']))
        .toBeGreaterThan(Number(anonResponse.headers['ratelimit-limit']));
    });

    test('Un token inválido/expirado cae al límite anónimo', async () => {
      const response = await request(app)
        .get('/api/test')
        .set('x-real-ip', '10.2.1.3')
        .set('Authorization', 'Bearer token-invalido');

      expect(Number(response.headers['ratelimit-limit'])).toBe(10);
    });
  });

  // ============================================================================
  // PRUEBAS: Clave por X-Real-IP, no por X-Forwarded-For (C1)
  // ============================================================================

  describe('keyGenerator usa X-Real-IP, ignora X-Forwarded-For falso', () => {
    beforeEach(() => {
      app.use('/api', general);
      app.get('/api/test', (req, res) => {
        res.json({ success: true });
      });
    });

    test('Mismo X-Real-IP con distintos X-Forwarded-For cae en la misma cubeta', async () => {
      const fixedRealIp = '10.3.3.3';

      const first = await request(app)
        .get('/api/test')
        .set('x-real-ip', fixedRealIp)
        .set('x-forwarded-for', '1.1.1.1');
      const second = await request(app)
        .get('/api/test')
        .set('x-real-ip', fixedRealIp)
        .set('x-forwarded-for', '2.2.2.2');

      const firstRemaining = Number(first.headers['ratelimit-remaining']);
      const secondRemaining = Number(second.headers['ratelimit-remaining']);

      // Si la clave usara x-forwarded-for, cada petición estrenaría cubeta propia
      // y el remaining no bajaría entre ellas. Al usar x-real-ip fijo, sí baja.
      expect(secondRemaining).toBe(firstRemaining - 1);
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

    // authLimiter.max = 20 (backend/src/middleware/rateLimiter.js). El comentario
    // del código dice "5 intentos", pero el valor real configurado es 20 — ver
    // hallazgo fuera de alcance en el reporte final.
    const AUTH_LIMITER_MAX = 20;

    test('Debe resetear contador en login exitoso', async () => {
      // Primer intento fallido
      let response = await request(app)
        .post('/api/login')
        .set('x-real-ip', '10.4.1.1')
        .send({ username: 'reset-user', password: 'wrong' });
      expect(response.status).toBe(401);

      // Login exitoso debe resetear
      response = await request(app)
        .post('/api/login')
        .set('x-real-ip', '10.4.1.1')
        .send({ username: 'reset-user', password: 'correct' });
      expect(response.status).toBe(200);

      // Debe permitir más intentos fallidos después
      response = await request(app)
        .post('/api/login')
        .set('x-real-ip', '10.4.1.1')
        .send({ username: 'reset-user', password: 'wrong' });
      expect(response.status).toBe(401);
    });

    test(`Debe bloquear después de ${AUTH_LIMITER_MAX} intentos fallidos`, async () => {
      for (let i = 0; i < AUTH_LIMITER_MAX; i++) {
        const response = await request(app)
          .post('/api/login')
          .set('x-real-ip', '10.4.2.1')
          .send({ username: 'blocked-user', password: 'wrong' });
        expect(response.status).toBe(401);
      }

      // El intento (N+1) debe ser bloqueado por rate limit
      const response = await request(app)
        .post('/api/login')
        .set('x-real-ip', '10.4.2.1')
        .send({ username: 'blocked-user', password: 'wrong' });
      expect(response.status).toBe(429);
      expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(response.body.error.type).toBe('AUTH');
    });

    test('Un login exitoso no consume el cupo (skipSuccessfulRequests)', async () => {
      // N logins exitosos no deben acercarse al límite
      for (let i = 0; i < AUTH_LIMITER_MAX + 5; i++) {
        const response = await request(app)
          .post('/api/login')
          .set('x-real-ip', '10.4.3.1')
          .send({ username: 'success-user', password: 'correct' });
        expect(response.status).toBe(200);
      }
    });

    test('Debe incluir retryAfter en respuesta de bloqueo', async () => {
      // Bloquear
      for (let i = 0; i < AUTH_LIMITER_MAX + 1; i++) {
        await request(app)
          .post('/api/login')
          .set('x-real-ip', '10.4.4.1')
          .send({ username: 'retry-user', password: 'wrong' });
      }

      // Solicitud bloqueada debe incluir retryAfter
      const response = await request(app)
        .post('/api/login')
        .set('x-real-ip', '10.4.4.1')
        .send({ username: 'retry-user', password: 'wrong' });

      expect(response.status).toBe(429);
      expect(response.body.error.retryAfter).toBeDefined();
      expect(response.body.error.resetTime).toBeDefined();
    });

    test('Distinto X-Forwarded-For con el mismo X-Real-IP y usuario cae en la misma cubeta', async () => {
      const first = await request(app)
        .post('/api/login')
        .set('x-real-ip', '10.4.5.1')
        .set('x-forwarded-for', '9.9.9.9')
        .send({ username: 'proxy-user', password: 'wrong' });
      const second = await request(app)
        .post('/api/login')
        .set('x-real-ip', '10.4.5.1')
        .set('x-forwarded-for', '8.8.8.8')
        .send({ username: 'proxy-user', password: 'wrong' });

      expect(first.status).toBe(401);
      expect(second.status).toBe(401);
      expect(Number(second.headers['ratelimit-remaining']))
        .toBe(Number(first.headers['ratelimit-remaining']) - 1);
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
        .set('x-forwarded-for', '10.5.1.1')
        .send({ name: 'John' });
      expect(response.status).toBe(201);
    });

    test('Debe bloquear después de 15 creaciones por minuto', async () => {
      // 15 creaciones
      for (let i = 0; i < 15; i++) {
        const response = await request(app)
          .post('/api/users')
          .set('x-forwarded-for', '10.5.2.1')
          .send({ name: `User${i}` });
        expect(response.status).toBe(201);
      }

      // 16ta debe ser bloqueada
      const response = await request(app)
        .post('/api/users')
        .set('x-forwarded-for', '10.5.2.1')
        .send({ name: 'User16' });
      expect(response.status).toBe(429);
    });
  });

  // ============================================================================
  // PRUEBAS: Delete Limiter
  // ============================================================================

  describe('Delete Limiter', () => {
    beforeEach(() => {
      // Esta app fresca (creada en el beforeEach externo) necesita su propia
      // ruta POST /api/users: el describe 'Create Limiter' registra la suya
      // en una instancia de app distinta.
      app.post('/api/users', create, (req, res) => {
        res.status(201).json({ id: 1, name: req.body.name });
      });
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
          .set('x-forwarded-for', '10.5.3.1')
          .send({ name: `User${i}` });
        createLimitResults.push(response.status);
      }

      // Simular 6 eliminaciones
      for (let i = 1; i <= 6; i++) {
        const response = await request(app)
          .delete(`/api/users/${i}`)
          .set('x-forwarded-for', '10.5.3.2');
        deleteLimitResults.push(response.status);
      }

      // Las 5 primeras creaciones deben pasar
      expect(createLimitResults.slice(0, 5).every((s) => s === 201)).toBe(true);

      // Las 5 primeras eliminaciones deben pasar
      expect(deleteLimitResults.slice(0, 5).every((s) => s === 200)).toBe(true);

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
          .set('x-forwarded-for', '10.5.4.1')
          .send({ newPassword: 'test' });
        expect(response.status).toBe(200);
      }

      // 4to debe ser bloqueado
      const response = await request(app)
        .put('/api/password')
        .set('x-forwarded-for', '10.5.4.1')
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
      loggerMock = require('../../utils/logger');
      loggerMock.logSecurity.mockClear();

      app.post('/api/login', auth, (req, res) => {
        res.status(401).json({ error: 'Invalid' });
      });
    });

    test('Debe loguear intentos de rate limit bloqueados', async () => {
      // Causar bloqueo (authLimiter.max = 20)
      for (let i = 0; i < 21; i++) {
        await request(app)
          .post('/api/login')
          .set('x-real-ip', '10.6.1.1')
          .send({ username: 'logging-user', password: 'wrong' });
      }

      expect(loggerMock.logSecurity).toHaveBeenCalled();
      expect(loggerMock.logSecurity).toHaveBeenCalledWith(
        'RATE_LIMIT_EXCEEDED_AUTH',
        expect.objectContaining({
          ip: expect.any(String),
          path: '/api/login',
          method: 'POST',
        }),
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
      // Bloquear (authLimiter.max = 20)
      for (let i = 0; i < 21; i++) {
        await request(app)
          .post('/api/test')
          .set('x-real-ip', '10.6.2.1')
          .send({ username: 'format-user', password: 'wrong' });
      }

      const response = await request(app)
        .post('/api/test')
        .set('x-real-ip', '10.6.2.1')
        .send({ username: 'format-user', password: 'wrong' });

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
      const response = await request(app).get('/api/test').set('x-real-ip', '10.7.1.1');

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
