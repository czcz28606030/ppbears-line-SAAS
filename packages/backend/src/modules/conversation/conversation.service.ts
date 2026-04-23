import { getSupabaseAdmin } from '../../utils/supabase.js';
import { ChatMessage, MessageRole } from '../../types/index.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Conversation memory: manages conversation lifecycle and message history.
 */
export class ConversationService {
  /**
   * Get or create an active conversation for a user.
   */
  async getOrCreateConversation(
    tenantId: string,
    userId: string,
    channelType: string,
  ): Promise<string> {
    const db = getSupabaseAdmin();

    // Check for existing active conversation
    const { data: existing } = await db
      .from('conversations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .eq('channel_type', channelType)
      .in('status', ['active', 'live_agent'])
      .order('last_message_at', { ascending: false })
      .limit(1)
      .single();

    if (existing) {
      return existing.id;
    }

    // Create new conversation
    const convId = uuidv4();
    await db.from('conversations').insert({
      id: convId,
      tenant_id: tenantId,
      user_id: userId,
      channel_type: channelType,
      status: 'active',
    });

    return convId;
  }

  /**
   * Save a message to the conversation.
   */
  async saveMessage(
    tenantId: string,
    conversationId: string,
    role: MessageRole,
    content: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const db = getSupabaseAdmin();
    await db.from('messages').insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      role,
      content,
      metadata_json: metadata,
    });

    // Update last_message_at
    await db
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId);
  }

  /**
   * Get recent conversation history for context window.
   */
  async getRecentHistory(
    tenantId: string,
    conversationId: string,
    limit: number = 20,
  ): Promise<ChatMessage[]> {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from('messages')
      .select('role, content')
      .eq('tenant_id', tenantId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (!data) return [];

    // Reverse to chronological order, map to ChatMessage format
    return data.reverse().map((msg) => ({
      role: msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : 'system',
      content: msg.content,
    }));
  }

  /**
   * Get conversations list for admin panel.
   */
  async listConversations(
    tenantId: string,
    options: { status?: string; limit?: number; offset?: number } = {},
  ) {
    const db = getSupabaseAdmin();
    let query = db
      .from('conversations')
      .select('*, users(display_name, unified_user_id)', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('last_message_at', { ascending: false })
      .range(options.offset || 0, (options.offset || 0) + (options.limit || 50) - 1);

    if (options.status) {
      query = query.eq('status', options.status);
    }

    const { data, count } = await query;
    const conversations = data || [];

    // Fetch live_agent_sessions for live_agent conversations
    const liveConvIds = conversations.filter(c => c.status === 'live_agent').map(c => c.id);
    const permanentSet = new Set<string>();
    const expiredConvIds: string[] = [];
    const now = new Date();

    if (liveConvIds.length > 0) {
      const { data: liveSessions } = await db
        .from('live_agent_sessions')
        .select('conversation_id, expires_at, id')
        .in('conversation_id', liveConvIds)
        .is('released_at', null);

      for (const s of liveSessions || []) {
        const isPermament = s.expires_at && new Date(s.expires_at).getFullYear() >= 2099;
        if (isPermament) {
          permanentSet.add(s.conversation_id);
        } else if (s.expires_at && new Date(s.expires_at) < now) {
          // Session has expired but was never cleaned up — auto-clean now
          expiredConvIds.push(s.conversation_id);
          // Fire-and-forget: update session and conversation status in DB
          db.from('live_agent_sessions')
            .update({ released_at: now.toISOString(), released_by: 'system:auto_expire' })
            .eq('id', s.id)
            .then(() => {});
          db.from('conversations')
            .update({ status: 'active' })
            .eq('id', s.conversation_id)
            .then(() => {});
        }
      }
    }

    // Batch-fetch user tags for all conversations (single query, no N+1)
    const userIds = [...new Set(conversations.map((c: any) => c.user_id).filter(Boolean))];
    const tagsByUser: Record<string, { tag: string; source: string }[]> = {};
    if (userIds.length > 0) {
      const { data: allTags } = await db
        .from('user_tags')
        .select('user_id, tag, source')
        .eq('tenant_id', tenantId)
        .in('user_id', userIds as string[]);
      for (const t of allTags || []) {
        if (!tagsByUser[t.user_id]) tagsByUser[t.user_id] = [];
        tagsByUser[t.user_id].push({ tag: t.tag, source: t.source });
      }
    }

    const enriched = conversations.map((c: any) => ({
      ...c,
      // Override status to 'active' for expired sessions so UI reflects reality
      status: expiredConvIds.includes(c.id) ? 'active' : c.status,
      is_permanent: permanentSet.has(c.id),
      user_tags: tagsByUser[c.user_id] || [],
    }));

    return { conversations: enriched, total: count || 0 };
  }

}

export const conversationService = new ConversationService();

