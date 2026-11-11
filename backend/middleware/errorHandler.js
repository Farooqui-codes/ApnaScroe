function errorHandler(err, req, res, _next) {
  let status = err.statusCode || 500;
  let message = err.message || 'Internal server error';

  if (err.name === 'ValidationError') {
    status = 400;
    const details = Object.values(err.errors || {}).map((e) => e.message);
    message = details.join(', ') || 'Validation error';
  } else if (err.name === 'CastError') {
    status = 400;
    message = `Invalid identifier format for ${err.path}`;
  } else if (err.code === 11000) {
    status = 409;
    const fields = Object.keys(err.keyValue || {});
    message = `Duplicate value for ${fields.join(', ')}`;
  } else if (err.name === 'MulterError') {
    status = 400;
    message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Uploaded image exceeds maximum allowed size (5MB).'
      : err.message;
  }

  if (status >= 500) {
    console.error('[ApnaScore Error]', err);
  }

  res.status(status).json({
    success: false,
    message
  });
}

module.exports = errorHandler;
