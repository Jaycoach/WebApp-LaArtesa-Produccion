const { AppError } = require('./errorHandler');

const notFound = (req, res, next) => {
  const error = new AppError(
    `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
    404
  );
  next(error);
};

module.exports = { notFound };
