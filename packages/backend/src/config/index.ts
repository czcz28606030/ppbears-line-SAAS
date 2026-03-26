import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  host: process.env.HOST || '0.0.0.0',

  // Supabase
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
  },

  // JWT for admin panel
  jwt: {
    secret: (() => {
      const s = process.env.JWT_SECRET;
      if (!s) throw new Error('[SECURITY] JWT_SECRET environment variable must be set - do not use a default value');
      return s;
    })(),
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },

  // Admin elevated session
  admin: {
    sessionDurationMinutes: parseInt(process.env.ADMIN_SESSION_DURATION_MINUTES || '10', 10),
    unlockPassword: process.env.ADMIN_UNLOCK_PASSWORD || '',
  },

  // Message gate
  messageGate: {
    windowMs: parseInt(process.env.MESSAGE_GATE_WINDOW_MS || '8000', 10),
  },

  // Live agent
  liveAgent: {
    defaultDurationHours: parseInt(process.env.LIVE_AGENT_DURATION_HOURS || '24', 10),
    triggerPhrases: ['真人', '轉真人', '我要找客服', '有人嗎', '客服處理'],
  },

  // Rate limit
  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    timeWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  },

  // Log level
  logLevel: process.env.LOG_LEVEL || 'info',
} as const;

export type AppConfig = typeof config;
