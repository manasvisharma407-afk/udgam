'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const pinoHttp = require('pino-http');

const config = require('./config/env');
const logger = require('./lib/logger');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

function buildCorsOptions() {
  const allowlist = new Set(config.corsOrigins);

  return {
    origin(origin, callback) {
      // Same-origin / curl / native app requests have no Origin header.
      if (!origin) return callback(null, true);
      if (allowlist.has(origin)) return callback(null, true);

      // Vercel preview deployments get a fresh subdomain per push, so match
      // the project pattern rather than pinning every URL by hand.
      if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return callback(null, true);

      logger.warn({ origin }, 'blocked by CORS allowlist');
      return callback(new Error('not_allowed_by_cors'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key', 'x-org-id', 'x-demo-profile'],
  };
}

function createApp() {
  const app = express();

  app.set('trust proxy', 1); // Render terminates TLS at its proxy.
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON only; the CSP that matters lives on the Vercel side.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );
  app.use(compression());
  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: '256kb' }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/ping' || req.url === '/api/health' },
    })
  );

  app.use('/api', routes);
  app.get('/', (req, res) =>
    res.json({ service: 'raahsaathi-backend', docs: '/api/health' })
  );

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp, buildCorsOptions };
