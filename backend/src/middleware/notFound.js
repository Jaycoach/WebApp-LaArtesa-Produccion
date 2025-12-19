/**
 * Este archivo se mantiene por compatibilidad, pero la función notFound
 * ahora está en errorHandler.js y se exporta desde allí
 */

const { notFound } = require('./errorHandler');

module.exports = { notFound };
