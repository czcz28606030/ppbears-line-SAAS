import { getSupabaseAdmin } from '../../utils/supabase.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger({ module: 'BroadcastService' });

const LINE_MULTICAST_URL = 'https://api.line.me/v2/bot/message/multicast';
const LINE_MULTICAST_LIMIT = 500; // LINE API max recipients per call

export class BroadcastService {
  /**
   * Get LINE channel access token for a tenant.
   */
  private async getLineToken(tenantId: string): Promise<string | null> {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from('tenant_channel_configs')
      .select('credentials_encrypted')
      .eq('tenant_id', tenantId)
      .eq('channel_type', 'line')
      .eq('enabled', true)
      .single();

    if (!data) return null;
    const creds = data.credentials_encrypted as any;
    return creds?.channelAccessToken || null;
  }

  /**
   * Get all LINE platform_user_ids for users tagged with a specific tag.
   */
  async getRecipients(tenantId: string, tagFilter: string): Promise<string[]> {
    const db = getSupabaseAdmin();

    // Join user_tags → channel_identities to get LINE user IDs
    const { data } = await db
      .from('user_tags')
      .select('user_id')
      .eq('tenant_id', tenantId)
      .eq('tag', tagFilter);

    if (!data || data.length === 0) return [];

    const userIds = data.map((r) => r.user_id);

    const { data: identities } = await db
      .from('channel_identities')
      .select('platform_user_id')
      .eq('tenant_id', tenantId)
      .eq('channel_type', 'line')
      .in('user_id', userIds);

    return (identities || []).map((r) => r.platform_user_id);
  }

  /**
   * Send a broadcast campaign via LINE Multicast.
   * Automatically batches recipients in groups of 500.
   */
  async sendCampaign(campaignId: string, tenantId: string): Promise<void> {
    const db = getSupabaseAdmin();

    // Load campaign
    const { data: campaign } = await db
      .from('broadcast_campaigns')
      .select('*')
      .eq('id', campaignId)
      .eq('tenant_id', tenantId)
      .single();

    if (!campaign) {
      log.error({ campaignId }, 'Campaign not found');
      return;
    }

    // Mark as sending
    await db
      .from('broadcast_campaigns')
      .update({ status: 'sending' })
      .eq('id', campaignId);

    try {
      const token = await this.getLineToken(tenantId);
      if (!token) throw new Error('LINE channel access token not configured');

      const recipients = await this.getRecipients(tenantId, campaign.tag_filter);
      if (recipients.length === 0) {
        await db.from('broadcast_campaigns').update({
          status: 'done',
          total_recipients: 0,
          sent_at: new Date().toISOString(),
          error_message: '符合條件的接收者為 0 人',
        }).eq('id', campaignId);
        return;
      }

      // Batch into chunks of 500
      const batches: string[][] = [];
      for (let i = 0; i < recipients.length; i += LINE_MULTICAST_LIMIT) {
        batches.push(recipients.slice(i, i + LINE_MULTICAST_LIMIT));
      }

      log.info({ campaignId, tenantId, total: recipients.length, batches: batches.length }, 'Starting multicast send');

      let totalSent = 0;
      for (const batch of batches) {
        const res = await fetch(LINE_MULTICAST_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            to: batch,
            messages: [{ type: 'text', text: campaign.message }],
          }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`LINE Multicast failed (${res.status}): ${errBody}`);
        }

        totalSent += batch.length;
        log.info({ campaignId, batchSize: batch.length, totalSent }, 'Batch sent');
      }

      await db.from('broadcast_campaigns').update({
        status: 'done',
        total_recipients: totalSent,
        sent_at: new Date().toISOString(),
      }).eq('id', campaignId);

      log.info({ campaignId, totalSent }, 'Campaign broadcast complete');
    } catch (err: any) {
      log.error({ campaignId, err: err.message }, 'Campaign broadcast failed');
      await db.from('broadcast_campaigns').update({
        status: 'failed',
        error_message: err.message,
        sent_at: new Date().toISOString(),
      }).eq('id', campaignId);
    }
  }

  /**
   * List campaigns for a tenant.
   */
  async listCampaigns(tenantId: string) {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from('broadcast_campaigns')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(50);
    return data || [];
  }

  /**
   * Create a new campaign and kick off sending asynchronously.
   */
  async createAndSend(
    tenantId: string,
    name: string,
    tagFilter: string,
    message: string,
  ): Promise<string> {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from('broadcast_campaigns')
      .insert({ tenant_id: tenantId, name, tag_filter: tagFilter, message })
      .select('id')
      .single();

    if (error || !data) throw new Error(error?.message || 'Failed to create campaign');

    const campaignId = data.id;

    // Fire-and-forget
    this.sendCampaign(campaignId, tenantId).catch((err) =>
      log.error({ campaignId, err: err.message }, 'Async campaign send failed'),
    );

    return campaignId;
  }
}

export const broadcastService = new BroadcastService();
