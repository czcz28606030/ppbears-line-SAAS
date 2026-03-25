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
    return { conversations: data || [], total: count || 0 };
  }
}

export const conversationService = new ConversationService();
