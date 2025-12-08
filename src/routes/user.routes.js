/**
 * Rutas de Gestión de Usuarios
 */

const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middleware/auth');
const { checkRole } = require('../middleware/roleCheck');
const {
  createUserValidation,
  updateUserValidation,
  userIdValidation,
  resetPasswordValidation,
  listUsersValidation,
  getUserActivityValidation
} = require('../validators/user.validator');

// Todas las rutas requieren autenticación
router.use(authMiddleware);

/**
 * @route   GET /api/users/stats
 * @desc    Obtener estadísticas de usuarios
 * @access  Private (Admin, Supervisor)
 */
router.get('/stats', checkRole(['admin', 'supervisor']), userController.getUserStats);

/**
 * @route   GET /api/users
 * @desc    Listar usuarios con paginación y filtros
 * @access  Private (Admin, Supervisor)
 */
router.get('/', checkRole(['admin', 'supervisor']), listUsersValidation, userController.listUsers);

/**
 * @route   GET /api/users/:id
 * @desc    Obtener usuario por ID
 * @access  Private (Admin, Supervisor)
 */
router.get('/:id', checkRole(['admin', 'supervisor']), userIdValidation, userController.getUserById);

/**
 * @route   POST /api/users
 * @desc    Crear nuevo usuario
 * @access  Private (Admin)
 */
router.post('/', checkRole(['admin']), createUserValidation, userController.createUser);

/**
 * @route   PUT /api/users/:id
 * @desc    Actualizar usuario
 * @access  Private (Admin)
 */
router.put('/:id', checkRole(['admin']), updateUserValidation, userController.updateUser);

/**
 * @route   DELETE /api/users/:id
 * @desc    Eliminar usuario (soft delete)
 * @access  Private (Admin)
 */
router.delete('/:id', checkRole(['admin']), userIdValidation, userController.deleteUser);

/**
 * @route   POST /api/users/:id/activate
 * @desc    Activar usuario
 * @access  Private (Admin)
 */
router.post('/:id/activate', checkRole(['admin']), userIdValidation, userController.activateUser);

/**
 * @route   POST /api/users/:id/deactivate
 * @desc    Desactivar usuario
 * @access  Private (Admin)
 */
router.post('/:id/deactivate', checkRole(['admin']), userIdValidation, userController.deactivateUser);

/**
 * @route   POST /api/users/:id/reset-password
 * @desc    Resetear contraseña de usuario
 * @access  Private (Admin)
 */
router.post('/:id/reset-password', checkRole(['admin']), resetPasswordValidation, userController.resetUserPassword);

/**
 * @route   POST /api/users/:id/unlock
 * @desc    Desbloquear usuario
 * @access  Private (Admin)
 */
router.post('/:id/unlock', checkRole(['admin']), userIdValidation, userController.unlockUser);

/**
 * @route   GET /api/users/:id/activity
 * @desc    Obtener actividad de usuario
 * @access  Private (Admin, Supervisor)
 */
router.get('/:id/activity', checkRole(['admin', 'supervisor']), getUserActivityValidation, userController.getUserActivity);

module.exports = router;