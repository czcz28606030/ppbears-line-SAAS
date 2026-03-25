import { getSupabaseAdmin } from '../utils/supabase.js';
import { ChannelType } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Identity service: maps platform users to unified internal users.
 */
export class IdentityService {
  /**
   * Resolve or create a unified user for a given platform identity.
   * Returns the internal user ID.
   */
  async resolveUser(
    tenantId: string,
    channelType: ChannelType,
    platformUserId: string,
    displayName?: string,
  ): Promise<{ userId: string; isNew: boolean }> {
    const db = getSupabaseAdmin();

    // Check if we already have this channel identity
    const { data: existing } = await db
      .from('channel_identities')
      .select('user_id')
      .eq('tenant_id', tenantId)
      .eq('channel_type', channelType)
      .eq('platform_user_id', platformUserId)
      .single();

    if (existing) {
      return { userId: existing.user_id, isNew: false };
    }

    // Create a new unified user
    const unifiedUserId = `${channelType}:${platformUserId}`;
    const userId = uuidv4();

    await db.from('users').insert({
      id: userId,
      tenant_id: tenantId,
      unified_user_id: unifiedUserId,
      display_name: displayName || null,
      metadata: {},
    });

    await db.from('channel_identities').insert({
      tenant_id: tenantId,
      user_id: userId,
      channel_type: channelType,
      platform_user_id: platformUserId,
    });

    return { userId, isNew: true };
  }

  /**
   * Link an additional channel identity to an existing user.
   */
  async linkIdentity(
    tenantId: string,
    userId: string,
    channelType: ChannelType,
    platformUserId: string,
  ): Promise<void> {
    const db = getSupabaseAdmin();
    await db.from('channel_identities').upsert({
      tenant_id: tenantId,
      user_id: userId,
      channel_type: channelType,
      platform_user_id: platformUserId,
    }, {
      onConflict: 'tenant_id,channel_type,platform_user_id',
    });
  }
}

export const identityService = new IdentityService();
