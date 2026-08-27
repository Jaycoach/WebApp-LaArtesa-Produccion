/**
 * Jerarquía de roles para autorización de gestión de usuarios.
 *
 * ADMIN > SUPERVISOR > OPERARIO/CALIDAD/AUDITOR (mismo nivel, el más bajo).
 * Ver backend/database/init/01-init.sql (check_rol) para los valores reales
 * de usuarios.rol.
 */
const ROLE_LEVEL = {
  ADMIN: 3,
  SUPERVISOR: 2,
  OPERARIO: 1,
  CALIDAD: 1,
  AUDITOR: 1,
};

const getRoleLevel = (rol) => ROLE_LEVEL[(rol || '').toUpperCase()] || 0;

/**
 * ¿Puede alguien con `requesterRol` modificar a un usuario que actualmente
 * tiene `targetRol`? Un admin puede modificar a cualquiera (incluido otro
 * admin); cualquier otro rol solo puede modificar a alguien de nivel
 * estrictamente inferior al suyo.
 */
const canModifyTarget = (requesterRol, targetRol) => {
  if ((requesterRol || '').toUpperCase() === 'ADMIN') return true;
  return getRoleLevel(requesterRol) > getRoleLevel(targetRol);
};

/**
 * ¿Puede alguien con `requesterRol` asignar `newRol` a un usuario (al
 * crearlo o actualizarlo)? Única restricción explícita: asignar ADMIN
 * requiere ya ser ADMIN. No hay restricción adicional para ascender a
 * SUPERVISOR (decisión confirmada — ver reporte de la tarea).
 */
const canAssignRole = (requesterRol, newRol) => {
  if ((newRol || '').toUpperCase() !== 'ADMIN') return true;
  return (requesterRol || '').toUpperCase() === 'ADMIN';
};

module.exports = {
  ROLE_LEVEL,
  getRoleLevel,
  canModifyTarget,
  canAssignRole,
};
