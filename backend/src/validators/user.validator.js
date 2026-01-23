/**
 * Validadores para Gestión de Usuarios
 */

const {
  body, param, query, validationResult,
} = require('express-validator');

/**
 * Middleware para manejar errores de validación
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Errores de validación',
      errors: errors.array().map((err) => ({
        field: err.path,
        message: err.msg,
      })),
    });
  }

  next();
};

/**
 * Validaciones para crear usuario
 */
const createUserValidation = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('El username debe tener entre 3 y 50 caracteres')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('El username solo puede contener letras, números, guiones y guiones bajos'),

  body('email')
    .trim()
    .isEmail()
    .withMessage('Email inválido')
    .normalizeEmail(),

  body('password')
    .isLength({ min: 8 })
    .withMessage('La contraseña debe tener al menos 8 caracteres')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]/)
    .withMessage('La contraseña debe contener al menos: una mayúscula, una minúscula, un número y un carácter especial (@$!%*?&#)'),

  body('nombre_completo')
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage('El nombre completo debe tener entre 3 y 100 caracteres'),

  body('rol')
    .isIn(['admin', 'supervisor', 'operador', 'visualizador'])
    .withMessage('Rol inválido. Debe ser: admin, supervisor, operador o visualizador'),

  handleValidationErrors,
];

/**
 * Validaciones para actualizar usuario
 */
const updateUserValidation = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID de usuario inválido'),

  body('nombre_completo')
    .optional()
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage('El nombre completo debe tener entre 3 y 100 caracteres'),

  body('email')
    .optional()
    .trim()
    .isEmail()
    .withMessage('Email inválido')
    .normalizeEmail(),

  body('rol')
    .optional()
    .isIn(['admin', 'supervisor', 'operador', 'visualizador'])
    .withMessage('Rol inválido. Debe ser: admin, supervisor, operador o visualizador'),

  handleValidationErrors,
];

/**
 * Validación de ID de usuario
 */
const userIdValidation = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID de usuario inválido'),

  handleValidationErrors,
];

/**
 * Validaciones para resetear contraseña
 */
const resetPasswordValidation = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID de usuario inválido'),

  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('La contraseña debe tener al menos 8 caracteres')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]/)
    .withMessage('La contraseña debe contener al menos: una mayúscula, una minúscula, un número y un carácter especial (@$!%*?&#)'),

  handleValidationErrors,
];

/**
 * Validaciones para listar usuarios
 */
const listUsersValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('La página debe ser un número mayor a 0'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('El límite debe ser entre 1 y 100'),

  query('rol')
    .optional()
    .isIn(['admin', 'supervisor', 'operador', 'visualizador'])
    .withMessage('Rol inválido'),

  query('activo')
    .optional()
    .isBoolean()
    .withMessage('Activo debe ser true o false'),

  query('sortBy')
    .optional()
    .isIn(['username', 'email', 'nombre_completo', 'rol', 'created_at', 'ultimo_login'])
    .withMessage('Campo de ordenamiento inválido'),

  query('sortOrder')
    .optional()
    .isIn(['ASC', 'DESC', 'asc', 'desc'])
    .withMessage('Orden debe ser ASC o DESC'),

  handleValidationErrors,
];

/**
 * Validaciones para obtener actividad de usuario
 */
const getUserActivityValidation = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID de usuario inválido'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('El límite debe ser entre 1 y 100'),

  handleValidationErrors,
];

module.exports = {
  createUserValidation,
  updateUserValidation,
  userIdValidation,
  resetPasswordValidation,
  listUsersValidation,
  getUserActivityValidation,
};
