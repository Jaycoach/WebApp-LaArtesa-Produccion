/**
 * Funciones de validación
 */

/**
 * Validar email
 */
export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validar que un string no esté vacío
 */
export const isNotEmpty = (value: string): boolean => {
  return value.trim().length > 0;
};

/**
 * Validar que un número sea positivo
 */
export const isPositiveNumber = (value: number): boolean => {
  return !isNaN(value) && value > 0;
};

/**
 * Validar que un número esté en un rango
 */
export const isInRange = (value: number, min: number, max: number): boolean => {
  return !isNaN(value) && value >= min && value <= max;
};

/**
 * Validar formato de fecha YYYY-MM-DD
 */
export const isValidDateFormat = (date: string): boolean => {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  return dateRegex.test(date);
};

/**
 * Validar formato de hora HH:mm
 */
export const isValidTimeFormat = (time: string): boolean => {
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
  return timeRegex.test(time);
};

/**
 * Validar temperatura ambiente (entre 15 y 35 grados)
 */
export const isValidTemperature = (temp: number): boolean => {
  return isInRange(temp, 15, 35);
};

/**
 * Validar humedad (entre 0 y 100%)
 */
export const isValidHumidity = (humidity: number): boolean => {
  return isInRange(humidity, 0, 100);
};

/**
 * Validar factor de absorción (entre 0.5 y 1.0)
 */
export const isValidAbsorptionFactor = (factor: number): boolean => {
  return isInRange(factor, 0.5, 1.0);
};

/**
 * Validar peso (mayor a 0, menor a 10000 kg)
 */
export const isValidWeight = (weight: number): boolean => {
  return isInRange(weight, 0.001, 10000);
};

/**
 * Validar porcentaje (entre 0 y 100)
 */
export const isValidPercentage = (percentage: number): boolean => {
  return isInRange(percentage, 0, 100);
};

/**
 * Validar código de masa (formato: MAxx-YYYYMMDD)
 */
export const isValidMasaCode = (code: string): boolean => {
  const codeRegex = /^MA\d{2}-\d{8}$/;
  return codeRegex.test(code);
};

/**
 * Validar código de producto SAP
 */
export const isValidSAPCode = (code: string): boolean => {
  // Formato típico SAP: 10-12 dígitos
  const codeRegex = /^\d{10,12}$/;
  return codeRegex.test(code);
};

/**
 * Validar username (solo letras, números y guión bajo, 3-20 caracteres)
 */
export const isValidUsername = (username: string): boolean => {
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  return usernameRegex.test(username);
};

/**
 * Validar contraseña (mínimo 8 caracteres, al menos una mayúscula, una minúscula y un número)
 */
export const isValidPassword = (password: string): boolean => {
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
  return passwordRegex.test(password);
};

/**
 * Validar turno
 */
export const isValidTurno = (turno: string): boolean => {
  return ['mañana', 'tarde', 'noche'].includes(turno);
};

/**
 * Validar estado de masa
 */
export const isValidEstadoMasa = (estado: string): boolean => {
  return ['pendiente', 'en_proceso', 'completada', 'cancelada'].includes(estado);
};

/**
 * Validar fase de producción
 */
export const isValidFase = (fase: string): boolean => {
  return ['pesaje', 'amasado', 'division', 'formado', 'fermentacion', 'horneado'].includes(fase);
};

/**
 * Resultado de validación
 */
export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validador de formulario de masa
 */
export const validateMasaForm = (data: {
  nombre: string;
  codigoMasa: string;
  fecha: string;
  turno: string;
  pesoTotal: number;
}): ValidationResult => {
  if (!isNotEmpty(data.nombre)) {
    return { isValid: false, error: 'El nombre es requerido' };
  }

  if (!isValidMasaCode(data.codigoMasa)) {
    return { isValid: false, error: 'Código de masa inválido (formato: MAxx-YYYYMMDD)' };
  }

  if (!isValidDateFormat(data.fecha)) {
    return { isValid: false, error: 'Formato de fecha inválido (YYYY-MM-DD)' };
  }

  if (!isValidTurno(data.turno)) {
    return { isValid: false, error: 'Turno inválido' };
  }

  if (!isValidWeight(data.pesoTotal)) {
    return { isValid: false, error: 'Peso total inválido (debe ser mayor a 0 y menor a 10000 kg)' };
  }

  return { isValid: true };
};

/**
 * Validador de formulario de checklist
 */
export const validateChecklistForm = (data: {
  temperaturaAmbiente?: number;
  humedadAmbiente?: number;
}): ValidationResult => {
  if (data.temperaturaAmbiente !== undefined && !isValidTemperature(data.temperaturaAmbiente)) {
    return { isValid: false, error: 'Temperatura ambiente inválida (debe estar entre 15 y 35°C)' };
  }

  if (data.humedadAmbiente !== undefined && !isValidHumidity(data.humedadAmbiente)) {
    return { isValid: false, error: 'Humedad ambiente inválida (debe estar entre 0 y 100%)' };
  }

  return { isValid: true };
};
