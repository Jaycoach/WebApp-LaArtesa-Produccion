/**
 * Configuración de Swagger / OpenAPI
 * Define el esquema de documentación de la API
 */

const config = require('../config');

const swaggerConfig = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: config.swagger.title,
      description: config.swagger.description,
      version: config.swagger.version,
      contact: config.swagger.contact,
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: config.swagger.servers,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT Token - Incluye el token en el header: Authorization: Bearer <token>',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              example: 'fail',
            },
            message: {
              type: 'string',
              example: 'Algo salió mal',
            },
            stack: {
              type: 'string',
              example: 'Error: ...',
            },
          },
        },
        SuccessResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true,
            },
            message: {
              type: 'string',
              example: 'Operación exitosa',
            },
            data: {
              type: 'object',
            },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              example: 1,
            },
            email: {
              type: 'string',
              format: 'email',
              example: 'usuario@example.com',
            },
            firstName: {
              type: 'string',
              example: 'Juan',
            },
            lastName: {
              type: 'string',
              example: 'Pérez',
            },
            role: {
              type: 'string',
              enum: ['admin', 'supervisor', 'user'],
              example: 'user',
            },
            isActive: {
              type: 'boolean',
              example: true,
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        AuthToken: {
          type: 'object',
          properties: {
            accessToken: {
              type: 'string',
              example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
            },
            refreshToken: {
              type: 'string',
              example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
            },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
    tags: [
      {
        name: 'Health',
        description: 'Verificación de estado del servidor',
      },
      {
        name: 'Authentication',
        description: 'Endpoints de autenticación y gestión de sesiones',
      },
      {
        name: 'Users',
        description: 'Endpoints de gestión de usuarios (requiere autenticación)',
      },
    ],
    paths: {}, // Los paths se generarán automáticamente desde los comentarios JSDoc
  },
  apis: [
    require('path').join(__dirname, '../routes/**/*.routes.js'),
    require('path').join(__dirname, '../server.js'),
  ],
};

module.exports = swaggerConfig;
