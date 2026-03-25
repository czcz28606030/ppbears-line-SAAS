import { createLogger } from './logger.js';

const log = createLogger({ module: 'KeepAlive' });

const PING_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
let pingTimer: NodeJS.Timeout | null = null;

/**
 * Self-ping keep-alive: prevents Render Free tier from hibernating.
 * Pings the /health endpoint every 10 minutes.
 */
export function startKeepAlive(port: number): void {
  const selfUrl = process.env.RENDER_EXTERNAL_URL
    ? `${process.env.RENDER_EXTERNAL_URL}/health`
    : `http://localhost:${port}/health`;

  log.info({ selfUrl, intervalMs: PING_INTERVAL_MS }, 'Keep-alive started');

  pingTimer = setInterval(async () => {
    try {
      const res = await fetch(selfUrl);
      if (res.ok) {
        log.debug({ selfUrl }, 'Keep-alive ping OK');
      } else {
        log.warn({ selfUrl, status: res.status }, 'Keep-alive ping returned non-OK');
      }
    } catch (err: any) {
      log.warn({ selfUrl, err: err.message }, 'Keep-alive ping failed');
    }
  }, PING_INTERVAL_MS);

  // Run once immediately after a short delay to confirm startup
  setTimeout(async () => {
    try {
      const res = await fetch(selfUrl);
      log.info({ selfUrl, status: res.status }, 'Keep-alive initial ping OK');
    } catch (_) {}
  }, 5000);
}

export function stopKeepAlive(): void {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
    log.info('Keep-alive stopped');
  }
}
