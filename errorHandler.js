'use strict';

const { ZodError } = require('zod');
const logger = require('../lib/logger');
const config = require('../config/env');

/** Wrap an async handler so rejected promises reach the error middleware. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function notFound(req, res) {
  res.status(404).json({ error: 'not_found', path: req.originalUrl });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'validation_failed',
      details: err.flatten().fieldErrors,
    });
  }

  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    logger.error({ err, path: req.originalUrl }, 'unhandled server error');
  } else {
    logger.warn({ msg: err.message, path: req.originalUrl }, 'request rejected');
  }

  res.status(status).json({
    error: err.code || (status >= 500 ? 'internal_error' : 'request_failed'),
    message: status >= 500 && config.isProduction ? 'Something went wrong.' : err.message,
  });
}

module.exports = { asyncHandler, notFound, errorHandler };
