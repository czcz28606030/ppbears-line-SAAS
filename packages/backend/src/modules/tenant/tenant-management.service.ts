import { getSupabaseAdmin } from '../../utils/supabase.js';
import { createLogger } from '../../utils/logger.js';
import crypto from 'crypto';

const log = createLogger({ module: 'TenantService' });

export interface CreateTenantInput {
  name: string;
  slug: string;
  plan: 'free' | 'starter' | 'professional' | 'enterprise';
  adminEmail: string;
  adminPassword: string;
}

export interface TenantPlan {
  name: string;
  maxMonthlyMessages: number;
  maxKnowledgeDocuments: number;
  maxProducts: number;
  channels: string[];
  features: string[];
}

export const PLANS: Record<string, TenantPlan> = {
  free: {
    name: '免費方案',
    maxMonthlyMessages: 500,
    maxKnowledgeDocuments: 5,
    maxProducts: 50,
    channels: ['line'],
    features: ['basic_ai', 'order_query'],
  },
  starter: {
    name: '入門方案',
    maxMonthlyMessages: 3000,
    maxKnowledgeDocuments: 20,
    maxProducts: 500,
    channels: ['line', 'messenger'],
    features: ['basic_ai', 'order_query', 'knowledge_base', 'live_agent'],
  },
  professional: {
    name: '專業方案',
    maxMonthlyMessages: 15000,
    maxKnowledgeDocuments: 100,
    maxProducts: 5000,
    channels: ['line', 'messenger', 'whatsapp'],
    features: ['basic_ai', 'order_query', 'knowledge_base', 'live_agent', 'product_sync', 'analytics'],
  },
  enterprise: {
    name: '企業方案',
    maxMonthlyMessages: -1, // unlimited
    maxKnowledgeDocuments: -1,
    maxProducts: -1,
    channels: ['line', 'messenger', 'whatsapp'],
    features: ['basic_ai', 'order_query', 'knowledge_base', 'live_agent', 'product_sync', 'analytics', 'custom_llm', 'white_label'],
  },
};

export class TenantManagementService {
  /**
   * Create a new tenant with admin user.
   */
  async createTenant(input: CreateTenantInput): Promise<{ tenantId: string; adminUserId: string }> {
    const db = getSupabaseAdmin();

    // Check slug uniqueness
    const { data: existing } = await db
      .from('tenants')
      .select('id')
      .eq('slug', input.slug)
      .single();

    if (existing) throw new Error(`Slug "${input.slug}" is already taken`);

    // Create tenant
    const { data: tenant, error: tenantErr } = await db
      .from('tenants')
      .insert({
        name: input.name,
        slug: input.slug,
        plan: input.plan,
        status: 'active',
        settings_json: {
          created_at: new Date().toISOString(),
          plan_limits: PLANS[input.plan],
        },
      })
      .select('id')
      .single();

    if (tenantErr || !tenant) throw new Error(`Failed to create tenant: ${tenantErr?.message}`);

    // Create admin user
    const passwordHash = crypto.createHash('sha256').update(input.adminPassword).digest('hex');
    const { data: adminUser, error: userErr } = await db
      .from('tenant_admin_users')
      .insert({
        tenant_id: tenant.id,
        email: input.adminEmail,
        password_hash: passwordHash,
        role: 'admin',
        status: 'active',
      })
      .select('id')
      .single();

    if (userErr || !adminUser) throw new Error(`Failed to create admin user: ${userErr?.message}`);

    log.info({ tenantId: tenant.id, slug: input.slug }, 'Tenant created');
    return { tenantId: tenant.id, adminUserId: adminUser.id };
  }

  /**
   * List all tenants with stats.
   */
  async listTenants() {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from('tenants')
      .select('id, name, slug, plan, status, created_at')
      .order('created_at', { ascending: false });
    return data || [];
  }

  /**
   * Get tenant details including admin users.
   */
  async getTenant(tenantId: string) {
    const db = getSupabaseAdmin();
    const [tenantRes, usersRes] = await Promise.all([
      db.from('tenants').select('*').eq('id', tenantId).single(),
      db.from('tenant_admin_users').select('id, email, role, status, created_at').eq('tenant_id', tenantId),
    ]);
    return {
      tenant: tenantRes.data,
      admins: usersRes.data || [],
      plan: PLANS[tenantRes.data?.plan || 'free'],
    };
  }

  /**
   * Update tenant plan.
   */
  async updatePlan(tenantId: string, plan: string): Promise<void> {
    if (!PLANS[plan]) throw new Error(`Unknown plan: ${plan}`);
    const db = getSupabaseAdmin();
    await db.from('tenants').update({
      plan,
      settings_json: { plan_limits: PLANS[plan], updated_at: new Date().toISOString() },
    }).eq('id', tenantId);
    log.info({ tenantId, plan }, 'Tenant plan updated');
  }

  /**
   * Suspend / reactivate a tenant.
   */
  async setStatus(tenantId: string, status: 'active' | 'suspended'): Promise<void> {
    const db = getSupabaseAdmin();
    await db.from('tenants').update({ status }).eq('id', tenantId);
    log.info({ tenantId, status }, 'Tenant status changed');
  }
}

export const tenantManagementService = new TenantManagementService();
