import { getSupabaseAdmin } from '../../utils/supabase.js';
import { config } from '../../config/index.js';
import { createLogger } from '../../utils/logger.js';
import { writeAuditLog } from '../../utils/audit.js';

const log = createLogger({ module: 'LiveAgent' });

/**
 * Live agent module: manages human takeover sessions.
 */
export class LiveAgentService {
  /**
   * Check if the message contains a live agent trigger phrase.
   */
  isTriggerPhrase(content: string, triggerPhrases: string[]): boolean {
    const normalized = content.trim().toLowerCase();
    return triggerPhrases.some((phrase) => normalized.includes(phrase.toLowerCase()));
  }

  /**
   * Check if the user currently has an active live agent session.
   */
  async isLiveAgentActive(tenantId: string, userId: string): Promise<boolean> {
    const db = getSupabaseAdmin();
    const now = new Date().toISOString();
    const { data } = await db
      .from('live_agent_sessions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .is('released_at', null)
      .gt('expires_at', now)
      .limit(1);

    return !!(data && data.length > 0);
  }

  /**
   * Activate live agent mode for a user.
   */
  async activate(
    tenantId: string,
    userId: string,
    conversationId: string,
    reason: string,
  ): Promise<{ sessionId: string; expiresAt: string }> {
    const db = getSupabaseAdmin();
    const expiresAt = new Date(
      Date.now() + config.liveAgent.defaultDurationHours * 60 * 60 * 1000
    ).toISOString();

    const { data, error } = await db
      .from('live_agent_sessions')
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        conversation_id: conversationId,
        reason,
        started_at: new Date().toISOString(),
        expires_at: expiresAt,
      })
      .select('id')
      .single();

    if (error) {
      log.error({ tenantId, userId, error }, 'Failed to activate live agent');
      throw error;
    }

    // Update conversation status
    await db
      .from('conversations')
      .update({ status: 'live_agent' })
      .eq('id', conversationId);

    await writeAuditLog({
      tenant_id: tenantId,
      actor_type: 'customer',
      actor_id: userId,
      action: 'live_agent_activated',
      target: conversationId,
      details_json: { reason, expiresAt },
    });

    log.info({ tenantId, userId, sessionId: data!.id }, 'Live agent session activated');
    return { sessionId: data!.id, expiresAt };
  }

  /**
   * Release a live agent session (admin action or auto-expiry).
   */
  async release(sessionId: string, releasedBy: string): Promise<void> {
    const db = getSupabaseAdmin();
    const { data: session } = await db
      .from('live_agent_sessions')
      .select('conversation_id, tenant_id')
      .eq('id', sessionId)
      .single();

    await db
      .from('live_agent_sessions')
      .update({
        released_at: new Date().toISOString(),
        released_by: releasedBy,
      })
      .eq('id', sessionId);

    if (session) {
      await db
        .from('conversations')
        .update({ status: 'active' })
        .eq('id', session.conversation_id);
    }

    log.info({ sessionId, releasedBy }, 'Live agent session released');
  }

  /**
   * Clean up expired live agent sessions (called by scheduler).
   */
  async cleanupExpired(): Promise<number> {
    const db = getSupabaseAdmin();
    const now = new Date().toISOString();

    const { data: expired } = await db
      .from('live_agent_sessions')
      .select('id, conversation_id')
      .is('released_at', null)
      .lt('expires_at', now);

    if (!expired || expired.length === 0) return 0;

    for (const session of expired) {
      await this.release(session.id, 'system:auto_expire');
    }

    log.info({ count: expired.length }, 'Expired live agent sessions cleaned up');
    return expired.length;
  }

  /**
   * Get active live agent sessions for admin panel.
   */
  async getActiveSessions(tenantId: string) {
    const db = getSupabaseAdmin();
    const now = new Date().toISOString();
    const { data } = await db
      .from('live_agent_sessions')
      .select('*, users(display_name, unified_user_id)')
      .eq('tenant_id', tenantId)
      .is('released_at', null)
      .gt('expires_at', now)
      .order('started_at', { ascending: false });

    return data || [];
  }
}

export const liveAgentService = new LiveAgentService();
