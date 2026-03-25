import { FastifyRequest, FastifyReply } from 'fastify';
import { getSupabaseAdmin } from '../utils/supabase.js';
import { logger } from '../utils/logger.js';

/**
 * Middleware that resolves tenant from route params or JWT.
 * Attaches tenantId to the request for downstream use.
 */
export async function tenantMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const params = request.params as Record<string, string>;
  const tenantId = params.tenantId;

  if (!tenantId) {
    return reply.status(400).send({ error: 'Missing tenantId' });
  }

  // Verify tenant exists and is active
  const db = getSupabaseAdmin();
  const { data: tenant, error } = await db
    .from('tenants')
    .select('id, status')
    .eq('id', tenantId)
    .single();

  if (error || !tenant || tenant.status !== 'active') {
    logger.warn({ tenantId }, 'Invalid or inactive tenant');
    return reply.status(404).send({ error: 'Tenant not found' });
  }

  // Attach to request for downstream
  (request as any).tenantId = tenantId;
}

/**
 * Middleware for admin API that extracts tenant from JWT claims.
 */
export async function adminTenantMiddleware(request: FastifyRequest, reply: FastifyReply) {
  // JWT should already be verified by auth middleware
  const user = (request as any).jwtUser;
  if (!user?.tenantId) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  (request as any).tenantId = user.tenantId;
}
