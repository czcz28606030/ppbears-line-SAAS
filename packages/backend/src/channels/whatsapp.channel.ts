import { ChannelAdapter, NormalizedMessage, ReplyMessage, ChannelType } from '../types/index.js';
import { getSupabaseAdmin } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'WhatsAppChannel' });

export class WhatsAppChannelAdapter implements ChannelAdapter {
  channelType: ChannelType = 'whatsapp';

  verifyWebhook(headers: Record<string, string>, body: string | Buffer): boolean {
    return true; // Validation done per-tenant
  }

  normalizeEvents(rawBody: unknown): NormalizedMessage[] {
    const body = rawBody as any;
    const messages: NormalizedMessage[] = [];

    for (const entry of (body.entry || [])) {
      for (const change of (entry.changes || [])) {
        if (change.field !== 'messages') continue;
        const value = change.value;
        for (const msg of (value.messages || [])) {
          if (msg.type !== 'text') continue;
          messages.push({
            tenantId: '',
            channelType: 'whatsapp',
            platformUserId: msg.from,
            messageType: 'text',
            content: msg.text?.body || '',
            rawEvent: { msg, metadata: value.metadata },
            receivedAt: new Date(parseInt(msg.timestamp) * 1000),
          });
        }
      }
    }
    return messages;
  }

  async sendReply(tenantId: string, platformUserId: string, messages: ReplyMessage[]): Promise<void> {
    const credentials = await this.getCredentials(tenantId);
    if (!credentials) {
      log.error({ tenantId }, 'WhatsApp credentials not found');
      return;
    }

    for (const msg of messages.slice(0, 5)) {
      const response = await fetch(
        `https://graph.facebook.com/v20.0/${credentials.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${credentials.accessToken}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: platformUserId,
            type: 'text',
            text: { body: msg.content },
          }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        log.error({ tenantId, status: response.status, err }, 'WhatsApp send failed');
      }
    }
  }

  private async getCredentials(tenantId: string): Promise<{
    phoneNumberId: string;
    accessToken: string;
    webhookVerifyToken: string;
  } | null> {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from('tenant_channel_configs')
      .select('credentials_encrypted')
      .eq('tenant_id', tenantId)
      .eq('channel_type', 'whatsapp')
      .eq('enabled', true)
      .single();

    if (!data) return null;
    const creds = data.credentials_encrypted as any;
    return {
      phoneNumberId: creds.phoneNumberId || '',
      accessToken: creds.accessToken || '',
      webhookVerifyToken: creds.webhookVerifyToken || '',
    };
  }
}

export const whatsappChannel = new WhatsAppChannelAdapter();
