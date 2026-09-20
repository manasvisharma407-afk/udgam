'use strict';

const pino = require('pino');
const config = require('../config/env');

const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'raahsaathi-backend' },
  redact: {
    // Tokens must never reach an aggregated log sink.
    paths: ['req.headers.authorization', 'token', '*.token', '*.accessToken'],
    remove: true,
  },
});

module.exports = logger;
