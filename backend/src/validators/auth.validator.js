/**
 * Validadores para Autenticación
 * Valida los inputs antes de procesarlos
 */

const { body, validationResult } = require('express-validator');

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
 * Validaciones para registro
 */
const registerValidation = [
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
    .optional()
    .isIn(['ADMIN', 'SUPERVISOR', 'OPERARIO', 'CALIDAD', 'AUDITOR'])
    .withMessage('Rol inválido'),

  handleValidationErrors,
];

/**
 * Validaciones para login
 */
const loginValidation = [
  body('username')
    .trim()
    .notEmpty()
    .withMessage('Username o email requerido'),

  body('password')
    .notEmpty()
    .withMessage('Contraseña requerida'),

  handleValidationErrors,
];

/**
 * Validaciones para refresh token
 */
const refreshTokenValidation = [
  body('refreshToken')
    .notEmpty()
    .withMessage('Refresh token requerido')
    .isString()
    .withMessage('Refresh token debe ser una cadena'),

  handleValidationErrors,
];

/**
 * Validaciones para forgot password
 */
const forgotPasswordValidation = [
  body('email')
    .trim()
    .isEmail()
    .withMessage('Email inválido')
    .normalizeEmail(),

  handleValidationErrors,
];

/**
 * Validaciones para reset password
 */
const resetPasswordValidation = [
  body('resetToken')
    .notEmpty()
    .withMessage('Token de recuperación requerido'),

  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('La contraseña debe tener al menos 8 caracteres')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]/)
    .withMessage('La contraseña debe contener al menos: una mayúscula, una minúscula, un número y un carácter especial (@$!%*?&#)'),

  handleValidationErrors,
];

/**
 * Validaciones para change password
 */
const changePasswordValidation = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Contraseña actual requerida'),

  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('La nueva contraseña debe tener al menos 8 caracteres')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]/)
    .withMessage('La nueva contraseña debe contener al menos: una mayúscula, una minúscula, un número y un carácter especial (@$!%*?&#)')
    .custom((value, { req }) => {
      if (value === req.body.currentPassword) {
        throw new Error('La nueva contraseña debe ser diferente a la actual');
      }
      return true;
    }),

  handleValidationErrors,
];

/**
 * Validaciones para actualizar perfil
 */
const updateProfileValidation = [
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

  handleValidationErrors,
];

module.exports = {
  registerValidation,
  loginValidation,
  refreshTokenValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
  changePasswordValidation,
  updateProfileValidation,
};
