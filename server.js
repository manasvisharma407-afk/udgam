'use strict';

const http = require('http');
const { Server } = require('socket.io');

const config = require('./src/config/env');
const logger = require('./src/lib/logger');
const { createApp, buildCorsOptions } = require('./src/app');
const { attachSockets } = require('./src/sockets');

const app = createApp();
const server = http.createServer(app);

const io = new Server(server, {
  cors: buildCorsOptions(),
  // Render's proxy idles connections out at ~60s; keep the heartbeat inside it.
  pingInterval: 20_000,
  pingTimeout: 25_000,
  // Long-poll fallback matters: some corporate and campus networks block WS,
  // and an SOS must still get through on those networks.
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e6,
});

app.set('io', io);
attachSockets(io);

server.listen(config.PORT, () => {
  logger.info(
    {
      port: config.PORT,
      env: config.NODE_ENV,
      supabase: config.supabaseEnabled,
      demoMode: config.demoMode,
      sosRadiusKm: config.SOS_RADIUS_KM,
    },
    'RaahSaathi backend listening'
  );
});

/* ------------------------------------------------------- graceful shutdown */

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  // Tell every client to reconnect elsewhere before we drop the socket, so an
  // in-flight SOS re-establishes against the new instance immediately.
  io.emit('SERVER_SHUTDOWN', { reason: signal, reconnectInMs: 1000 });

  const timer = setTimeout(() => {
    logger.error('forced exit after shutdown timeout');
    process.exit(1);
  }, 10_000);
  timer.unref();

  io.close(() => {
    server.close(() => {
      logger.info('shutdown complete');
      process.exit(0);
    });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception — exiting');
  process.exit(1);
});

module.exports = { app, server, io };
