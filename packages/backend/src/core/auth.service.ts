import { getSupabaseAdmin } from '../utils/supabase.js';
import { config } from '../config/index.js';
import { ChannelType, UserRole } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'AuthService' });

/**
 * Auth service: determine user role (admin vs customer) and manage elevated sessions.
 */
export class AuthService {
  /**
   * Determine if a platform user is an admin (whitelisted).
   */
  async isAdminUser(
    tenantId: string,
    channelType: ChannelType,
    platformUserId: string,
  ): Promise<boolean> {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from('admin_whitelist')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('channel_type', channelType)
      .eq('platform_user_id', platformUserId)
      .single();

    return !!data;
  }

  /**
   * Check if the admin has an active elevated session.
   */
  async hasElevatedSession(
    tenantId: string,
    channelType: ChannelType,
    platformUserId: string,
  ): Promise<boolean> {
    const db = getSupabaseAdmin();
    const now = new Date().toISOString();
    const { data } = await db
      .from('admin_sessions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('channel_type', channelType)
      .eq('platform_user_id', platformUserId)
      .gt('expires_at', now)
      .single();

    return !!data;
  }

  /**
   * Create an elevated admin session after password verification.
   */
  async createElevatedSession(
    tenantId: string,
    channelType: ChannelType,
    platformUserId: string,
  ): Promise<{ expiresAt: string }> {
    const db = getSupabaseAdmin();
    const expiresAt = new Date(
      Date.now() + config.admin.sessionDurationMinutes * 60 * 1000
    ).toISOString();

    await db.from('admin_sessions').insert({
      tenant_id: tenantId,
      platform_user_id: platformUserId,
      channel_type: channelType,
      elevated_at: new Date().toISOString(),
      expires_at: expiresAt,
    });

    log.info({ tenantId, platformUserId }, 'Admin elevated session created');
    return { expiresAt };
  }

  /**
   * Verify admin unlock password.
   */
  verifyUnlockPassword(password: string): boolean {
    return password === config.admin.unlockPassword;
  }

  /**
   * Determine the role for routing: admin or customer.
   */
  async determineRole(
    tenantId: string,
    channelType: ChannelType,
    platformUserId: string,
  ): Promise<UserRole> {
    const isAdmin = await this.isAdminUser(tenantId, channelType, platformUserId);
    return isAdmin ? 'admin' : 'customer';
  }
}

export const authService = new AuthService();
