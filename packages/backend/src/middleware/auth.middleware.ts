import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export interface JwtPayload {
  sub: string;       // admin user id
  tenantId: string;
  email: string;
  role: string;
}

/**
 * JWT authentication middleware for admin API.
 */
export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    (request as any).jwtUser = decoded;
  } catch (err) {
    logger.warn({ err }, 'JWT verification failed');
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }
}

/**
 * Generate a JWT for admin login.
 */
export function generateAdminToken(payload: JwtPayload): string {
  const secret: jwt.Secret = config.jwt.secret;
  const options: jwt.SignOptions = {
    expiresIn: 86400, // 24 hours in seconds
  };
  return jwt.sign(payload as object, secret, options);
}
