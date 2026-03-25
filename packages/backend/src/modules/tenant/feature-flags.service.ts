import { getSupabaseAdmin } from '../../utils/supabase.js';
import { createLogger } from '../../utils/logger.js';
import { PLANS } from './tenant-management.service.js';

const log = createLogger({ module: 'FeatureFlags' });

/**
 * Feature flags that can be toggled per tenant.
 */
export type FeatureKey =
  | 'basic_ai'
  | 'order_query'
  | 'knowledge_base'
  | 'live_agent'
  | 'product_sync'
  | 'analytics'
  | 'custom_llm'
  | 'white_label'
  | 'messenger_channel'
  | 'whatsapp_channel'
  | 'multi_model_fallback';

export class FeatureFlagService {
  private cache = new Map<string, { flags: Set<string>; expireAt: number }>();

  /**
   * Check if a feature is enabled for a tenant.
   * First checks tenant-specific overrides, then falls back to plan defaults.
   */
  async isEnabled(tenantId: string, feature: FeatureKey): Promise<boolean> {
    const flags = await this.getFlags(tenantId);
    return flags.has(feature);
  }

  /**
   * Get all enabled features for a tenant.
   */
  async getFlags(tenantId: string): Promise<Set<string>> {
    // Check in-memory cache (30 sec TTL)
    const cached = this.cache.get(tenantId);
    if (cached && cached.expireAt > Date.now()) return cached.flags;

    const db = getSupabaseAdmin();

    // Get tenant plan
    const { data: tenant } = await db
      .from('tenants')
      .select('plan')
      .eq('id', tenantId)
      .single();

    const plan = PLANS[tenant?.plan || 'free'];
    const planFeatures = new Set<string>(plan.features);
    // Add channel features based on plan
    for (const ch of plan.channels) {
      planFeatures.add(`${ch}_channel`);
    }

    // Get tenant-specific overrides
    const { data: overrides } = await db
      .from('tenant_settings')
      .select('key, value')
      .eq('tenant_id', tenantId)
      .like('key', 'feature:%');

    const finalFlags = new Set<string>(planFeatures);
    for (const override of (overrides || [])) {
      const feature = override.key.replace('feature:', '');
      if (override.value === 'true') {
        finalFlags.add(feature);
      } else if (override.value === 'false') {
        finalFlags.delete(feature);
      }
    }

    this.cache.set(tenantId, { flags: finalFlags, expireAt: Date.now() + 30_000 });
    return finalFlags;
  }

  /**
   * Override a feature flag for a specific tenant.
   */
  async setFlag(tenantId: string, feature: FeatureKey, enabled: boolean): Promise<void> {
    const db = getSupabaseAdmin();
    await db.from('tenant_settings').upsert({
      tenant_id: tenantId,
      key: `feature:${feature}`,
      value: enabled ? 'true' : 'false',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,key' });

    // Invalidate cache
    this.cache.delete(tenantId);
    log.info({ tenantId, feature, enabled }, 'Feature flag updated');
  }

  /**
   * List all feature flags for a tenant.
   */
  async listFlags(tenantId: string): Promise<Array<{ feature: string; enabled: boolean; source: 'plan' | 'override' }>> {
    const allFlags = await this.getFlags(tenantId);
    const allFeatures: FeatureKey[] = [
      'basic_ai', 'order_query', 'knowledge_base', 'live_agent',
      'product_sync', 'analytics', 'custom_llm', 'white_label',
      'messenger_channel', 'whatsapp_channel', 'multi_model_fallback',
    ];

    return allFeatures.map(f => ({
      feature: f,
      enabled: allFlags.has(f),
      source: 'plan' as const,
    }));
  }
}

export const featureFlagService = new FeatureFlagService();
