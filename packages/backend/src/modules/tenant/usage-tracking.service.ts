import { getSupabaseAdmin } from '../../utils/supabase.js';
import { createLogger } from '../../utils/logger.js';
import { PLANS } from './tenant-management.service.js';

const log = createLogger({ module: 'UsageTracking' });

export interface UsageStats {
  tenantId: string;
  period: string; // YYYY-MM
  totalMessages: number;
  aiReplies: number;
  liveAgentHandoffs: number;
  orderQueries: number;
  knowledgeHits: number;
  productSearches: number;
}

export class UsageTrackingService {
  private getPeriod(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Increment a usage counter for the current month.
   */
  async increment(tenantId: string, metric: string, amount = 1): Promise<void> {
    const db = getSupabaseAdmin();
    const period = this.getPeriod();
    const key = `usage:${period}:${metric}`;

    await db.from('tenant_settings').upsert({
      tenant_id: tenantId,
      key,
      value: String(amount),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,key' });

    // Increment by reading and updating
    const { data } = await db
      .from('tenant_settings')
      .select('value')
      .eq('tenant_id', tenantId)
      .eq('key', key)
      .single();

    const current = parseInt(data?.value || '0');
    await db.from('tenant_settings').upsert({
      tenant_id: tenantId,
      key,
      value: String(current + amount),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,key' });
  }

  /**
   * Get monthly usage stats for a tenant.
   */
  async getMonthlyStats(tenantId: string, period?: string): Promise<Record<string, number>> {
    const db = getSupabaseAdmin();
    const p = period || this.getPeriod();
    const prefix = `usage:${p}:`;

    const { data } = await db
      .from('tenant_settings')
      .select('key, value')
      .eq('tenant_id', tenantId)
      .like('key', `${prefix}%`);

    const stats: Record<string, number> = {};
    for (const row of (data || [])) {
      const metric = row.key.replace(prefix, '');
      stats[metric] = parseInt(row.value || '0');
    }
    return stats;
  }

  /**
   * Check if tenant has reached a quota limit.
   * Returns true if limit exceeded.
   */
  async checkQuota(tenantId: string, metric: string): Promise<{ exceeded: boolean; current: number; limit: number }> {
    const db = getSupabaseAdmin();
    const { data: tenant } = await db
      .from('tenants')
      .select('plan')
      .eq('id', tenantId)
      .single();

    const plan = PLANS[tenant?.plan || 'free'];
    const stats = await this.getMonthlyStats(tenantId);
    const current = stats[metric] || 0;

    let limit = -1;
    if (metric === 'messages') limit = plan.maxMonthlyMessages;

    return {
      exceeded: limit !== -1 && current >= limit,
      current,
      limit,
    };
  }

  /**
   * Get a dashboard-friendly usage summary.
   */
  async getDashboardStats(tenantId: string): Promise<{
    currentPeriod: Record<string, number>;
    plan: string;
    quotaStatus: { messages: { current: number; limit: number; percentage: number } };
  }> {
    const db = getSupabaseAdmin();
    const [statsData, tenantData] = await Promise.all([
      this.getMonthlyStats(tenantId),
      db.from('tenants').select('plan').eq('id', tenantId).single(),
    ]);

    const plan = PLANS[tenantData.data?.plan || 'free'];
    const messageCount = statsData['messages'] || 0;
    const messageLimit = plan.maxMonthlyMessages;
    const percentage = messageLimit === -1 ? 0 : Math.round((messageCount / messageLimit) * 100);

    return {
      currentPeriod: statsData,
      plan: tenantData.data?.plan || 'free',
      quotaStatus: {
        messages: { current: messageCount, limit: messageLimit, percentage },
      },
    };
  }
}

export const usageTrackingService = new UsageTrackingService();
