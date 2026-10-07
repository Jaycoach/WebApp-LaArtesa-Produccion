/**
 * Reglas de complejidad de contraseña. DEBEN reflejar el validador del backend
 * (backend/src/validators/user.validator.js → resetPasswordValidation / auth.validator.js):
 * mínimo 8 caracteres, una minúscula, una mayúscula, un número y un carácter especial (@$!%*?&#).
 * El backend es quien decide; esto solo permite validar antes de enviar y mostrar las reglas.
 */

export const CARACTERES_ESPECIALES = '@$!%*?&#';
export const LONGITUD_MINIMA_PASSWORD = 8;

/** Misma expresión que el backend. */
export const REGEX_PASSWORD_BACKEND = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]/;

export interface ReglaPassword {
  id: 'longitud' | 'minuscula' | 'mayuscula' | 'numero' | 'especial';
  texto: string;
  cumple: boolean;
}

export function evaluarReglasPassword(password: string): ReglaPassword[] {
  return [
    { id: 'longitud', texto: `Al menos ${LONGITUD_MINIMA_PASSWORD} caracteres`, cumple: password.length >= LONGITUD_MINIMA_PASSWORD },
    { id: 'minuscula', texto: 'Una letra minúscula', cumple: /[a-z]/.test(password) },
    { id: 'mayuscula', texto: 'Una letra mayúscula', cumple: /[A-Z]/.test(password) },
    { id: 'numero', texto: 'Un número', cumple: /\d/.test(password) },
    { id: 'especial', texto: `Un carácter especial (${CARACTERES_ESPECIALES})`, cumple: /[@$!%*?&#]/.test(password) },
  ];
}

/** ¿Cumple todas las reglas (incluida la forma exacta que valida el backend)? */
export function passwordCumpleReglas(password: string): boolean {
  return evaluarReglasPassword(password).every((r) => r.cumple) && REGEX_PASSWORD_BACKEND.test(password);
}
