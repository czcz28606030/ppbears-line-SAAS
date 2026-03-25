import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { webhookRoutes } from './channels/webhook.routes.js';
import { adminRoutes } from './routes/admin.routes.js';
import { tenantAdminRoutes } from './routes/tenant.routes.js';
import { startKeepAlive } from './utils/keep-alive.js';

async function buildApp() {
  const app = Fastify({
    logger: false, // We use our own pino logger
    bodyLimit: 10 * 1024 * 1024, // 10MB for file uploads
  });

  // ---- Plugins ----
  await app.register(cors, {
    origin: process.env.ADMIN_PANEL_URL || '*',
    credentials: true,
  });

  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindowMs,
  });

  // ---- Health Check ----
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // ---- Webhook Routes (no auth, but signature-verified) ----
  await app.register(webhookRoutes, { prefix: '/webhooks' });

  // ---- Admin API Routes (JWT-protected) ----
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(tenantAdminRoutes, { prefix: '/api/admin' });

  // ---- Global Error Handler ----
  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    logger.error({ err: error, url: request.url, method: request.method }, 'Unhandled error');
    reply.status(error.statusCode || 500).send({
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : error.message,
    });
  });

  return app;
}

async function start() {
  try {
    const app = await buildApp();
    await app.listen({ port: config.port, host: config.host });
    logger.info(`🚀 PPBears CS Backend running on http://${config.host}:${config.port}`);
    // Start keep-alive to prevent Render Free tier hibernation
    startKeepAlive(config.port);
  } catch (err) {
    logger.fatal(err, 'Failed to start server');
    process.exit(1);
  }
}

start();
