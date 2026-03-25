import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.logLevel,
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
      : undefined,
});

/**
 * Create a child logger with contextual fields (e.g., tenantId, userId).
 */
export function createLogger(context: Record<string, unknown>) {
  return logger.child(context);
}
