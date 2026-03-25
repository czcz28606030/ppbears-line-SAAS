import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { tenantManagementService } from '../modules/tenant/tenant-management.service.js';
import { usageTrackingService } from '../modules/tenant/usage-tracking.service.js';
import { featureFlagService, FeatureKey } from '../modules/tenant/feature-flags.service.js';
import { PLANS } from '../modules/tenant/tenant-management.service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'TenantAdminAPI' });

export async function tenantAdminRoutes(app: FastifyInstance) {
  const protectedApp = app.withTypeProvider();

  await protectedApp.register(async (server) => {
    server.addHook('preHandler', authMiddleware);

    // ---- Tenant CRUD ----
    server.get('/tenants', async (request: FastifyRequest) => {
      const jwtUser = (request as any).jwtUser;
      // Only super-admins can list all tenants
      if (jwtUser.role !== 'super_admin') {
        return { tenants: [await tenantManagementService.getTenant(jwtUser.tenantId)] };
      }
      const tenants = await tenantManagementService.listTenants();
      return { tenants };
    });

    server.get<{ Params: { id: string } }>('/tenants/:id', async (request) => {
      const { id } = request.params;
      return await tenantManagementService.getTenant(id);
    });

    server.post('/tenants', async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as any;
      const result = await tenantManagementService.createTenant({
        name: body.name,
        slug: body.slug,
        plan: body.plan || 'free',
        adminEmail: body.adminEmail,
        adminPassword: body.adminPassword,
      });
      return reply.status(201).send(result);
    });

    server.patch<{ Params: { id: string } }>('/tenants/:id/plan', async (request) => {
      const { id } = request.params;
      const { plan } = request.body as { plan: string };
      await tenantManagementService.updatePlan(id, plan);
      return { success: true };
    });

    server.patch<{ Params: { id: string } }>('/tenants/:id/status', async (request) => {
      const { id } = request.params;
      const { status } = request.body as { status: 'active' | 'suspended' };
      await tenantManagementService.setStatus(id, status);
      return { success: true };
    });

    // ---- Usage Stats ----
    server.get('/usage/stats', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { period } = request.query as { period?: string };
      const stats = await usageTrackingService.getDashboardStats(tenantId);
      return stats;
    });

    server.get('/usage/monthly', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { period } = request.query as { period?: string };
      const stats = await usageTrackingService.getMonthlyStats(tenantId, period);
      return { period: period || 'current', stats };
    });

    // ---- Feature Flags ----
    server.get('/features', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const flags = await featureFlagService.listFlags(tenantId);
      return { flags };
    });

    server.put<{ Params: { feature: string } }>('/features/:feature', async (request) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { feature } = request.params;
      const { enabled } = request.body as { enabled: boolean };
      await featureFlagService.setFlag(tenantId, feature as FeatureKey, enabled);
      return { success: true };
    });

    // ---- Plans reference ----
    server.get('/plans', async () => {
      return { plans: Object.entries(PLANS).map(([key, plan]) => ({ key, ...plan })) };
    });
  });
}
