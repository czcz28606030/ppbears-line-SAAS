import crypto from 'crypto';
import { ChannelAdapter, NormalizedMessage, ReplyMessage, ChannelType } from '../types/index.js';
import { getSupabaseAdmin } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'MessengerChannel' });

export class MessengerChannelAdapter implements ChannelAdapter {
  channelType: ChannelType = 'messenger';

  verifyWebhook(headers: Record<string, string>, body: string | Buffer): boolean {
    // Meta uses X-Hub-Signature-256 header
    const signature = headers['x-hub-signature-256'];
    if (!signature) return false;
    return true; // Full validation done in route with secret
  }

  verifyWithSecret(appSecret: string, signature: string, body: string | Buffer): boolean {
    const expected = 'sha256=' + crypto
      .createHmac('sha256', appSecret)
      .update(typeof body === 'string' ? body : body)
      .digest('hex');
    return expected === signature;
  }

  normalizeEvents(rawBody: unknown): NormalizedMessage[] {
    const body = rawBody as any;
    if (body.object !== 'page') return [];

    const messages: NormalizedMessage[] = [];
    for (const entry of (body.entry || [])) {
      for (const event of (entry.messaging || [])) {
        if (!event.message?.text) continue;
        messages.push({
          tenantId: '',
          channelType: 'messenger',
          platformUserId: event.sender?.id || '',
          messageType: 'text',
          content: event.message.text,
          rawEvent: event,
          receivedAt: new Date(event.timestamp || Date.now()),
        });
      }
    }
    return messages;
  }

  async sendReply(tenantId: string, platformUserId: string, messages: ReplyMessage[]): Promise<void> {
    const credentials = await this.getCredentials(tenantId);
    if (!credentials) {
      log.error({ tenantId }, 'Messenger credentials not found');
      return;
    }

    for (const msg of messages.slice(0, 5)) {
      const response = await fetch(
        `https://graph.facebook.com/v20.0/me/messages?access_token=${credentials.pageAccessToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: platformUserId },
            message: { text: msg.content },
          }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        log.error({ tenantId, status: response.status, err }, 'Messenger send failed');
      }
    }
  }

  private async getCredentials(tenantId: string): Promise<{
    pageAccessToken: string;
    appSecret: string;
    verifyToken: string;
  } | null> {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from('tenant_channel_configs')
      .select('credentials_encrypted')
      .eq('tenant_id', tenantId)
      .eq('channel_type', 'messenger')
      .eq('enabled', true)
      .single();

    if (!data) return null;
    const creds = data.credentials_encrypted as any;
    return {
      pageAccessToken: creds.pageAccessToken || '',
      appSecret: creds.appSecret || '',
      verifyToken: creds.verifyToken || '',
    };
  }
}

export const messengerChannel = new MessengerChannelAdapter();
