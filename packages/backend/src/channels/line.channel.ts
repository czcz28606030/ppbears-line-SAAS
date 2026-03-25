import crypto from 'crypto';
import { ChannelAdapter, NormalizedMessage, ReplyMessage, ChannelType } from '../types/index.js';
import { getSupabaseAdmin } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'LineChannel' });

export class LineChannelAdapter implements ChannelAdapter {
  channelType: ChannelType = 'line';

  /**
   * Verify LINE webhook signature.
   */
  verifyWebhook(headers: Record<string, string>, body: string | Buffer): boolean {
    // Signature is verified per-tenant using their channel secret
    // This returns true here; actual verification is done in verifyWithSecret()
    return true;
  }

  /**
   * Verify LINE signature with tenant-specific channel secret.
   */
  verifyWithSecret(channelSecret: string, signature: string, body: string | Buffer): boolean {
    const hash = crypto
      .createHmac('SHA256', channelSecret)
      .update(typeof body === 'string' ? body : body)
      .digest('base64');
    return hash === signature;
  }

  /**
   * Normalize LINE webhook events into standard messages.
   */
  normalizeEvents(rawBody: unknown): NormalizedMessage[] {
    const body = rawBody as { events?: any[] };
    if (!body.events || !Array.isArray(body.events)) return [];

    return body.events
      .filter((event: any) => event.type === 'message')
      .map((event: any) => ({
        tenantId: '', // Will be set by the webhook handler
        channelType: 'line' as ChannelType,
        platformUserId: event.source?.userId || '',
        messageType: this.mapMessageType(event.message?.type),
        content: event.message?.text || event.message?.type || '',
        rawEvent: event,
        receivedAt: new Date(event.timestamp || Date.now()),
      }));
  }

  /**
   * Send reply via LINE Messaging API.
   */
  async sendReply(
    tenantId: string,
    platformUserId: string,
    messages: ReplyMessage[],
    replyToken?: string,
  ): Promise<void> {
    const credentials = await this.getCredentials(tenantId);
    if (!credentials) {
      log.error({ tenantId }, 'LINE credentials not found');
      return;
    }

    const lineMessages = messages.map((msg) => {
      if (msg.type === 'text') {
        const lines = msg.content.trim().split('\n');
        const quickReplyItems: string[] = [];
        let i = lines.length - 1;
        while (i >= 0 && /^\d+\.\s+(.+)$/.test(lines[i].trim())) {
          const match = lines[i].trim().match(/^\d+\.\s+(.+)$/);
          if (match) {
            quickReplyItems.unshift(match[1].trim());
          }
          i--;
        }
        
        const lineMsg: any = { type: 'text', text: msg.content };
        if (quickReplyItems.length > 0 && quickReplyItems.length <= 13) {
           lineMsg.quickReply = {
             items: quickReplyItems.map(item => ({
               type: 'action',
               action: { type: 'message', label: item.substring(0, 20), text: item }
             }))
           };
        }
        return lineMsg;
      }
      return { type: 'text', text: msg.content };
    });

    // Use push message (doesn't require reply token, works anytime)
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credentials.channelAccessToken}`,
      },
      body: JSON.stringify({
        to: platformUserId,
        messages: lineMessages.slice(0, 5), // LINE limit: 5 messages
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      log.error({ tenantId, status: response.status, errBody }, 'LINE push message failed');
    }
  }

  /**
   * Send reply using reply token (preferred for first response in webhook).
   */
  async sendReplyWithToken(
    tenantId: string,
    replyToken: string,
    messages: ReplyMessage[],
  ): Promise<void> {
    const credentials = await this.getCredentials(tenantId);
    if (!credentials) return;

    const lineMessages = messages.map((msg) => {
      if (msg.type === 'text') {
        const lines = msg.content.trim().split('\n');
        const quickReplyItems: string[] = [];
        let i = lines.length - 1;
        while (i >= 0 && /^\d+\.\s+(.+)$/.test(lines[i].trim())) {
          const match = lines[i].trim().match(/^\d+\.\s+(.+)$/);
          if (match) {
            quickReplyItems.unshift(match[1].trim());
          }
          i--;
        }
        
        const lineMsg: any = { type: 'text', text: msg.content };
        if (quickReplyItems.length > 0 && quickReplyItems.length <= 13) {
           lineMsg.quickReply = {
             items: quickReplyItems.map(item => ({
               type: 'action',
               action: { type: 'message', label: item.substring(0, 20), text: item }
             }))
           };
        }
        return lineMsg;
      }
      return { type: 'text', text: msg.content };
    });

    await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credentials.channelAccessToken}`,
      },
      body: JSON.stringify({
        replyToken,
        messages: lineMessages.slice(0, 5),
      }),
    });
  }

  /**
   * Send loading animation via LINE Messaging API.
   */
  async sendLoadingAnimation(tenantId: string, platformUserId: string, seconds = 20): Promise<void> {
    const credentials = await this.getCredentials(tenantId);
    if (!credentials) {
      log.warn({ tenantId }, 'sendLoadingAnimation: no credentials found');
      return;
    }

    try {
      const res = await fetch('https://api.line.me/v2/bot/chat/loading/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${credentials.channelAccessToken}`,
        },
        body: JSON.stringify({
          chatId: platformUserId,
          loadingSeconds: seconds,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        log.error({ tenantId, status: res.status, errBody, platformUserId }, 'sendLoadingAnimation: LINE API rejected');
      } else {
        log.info({ tenantId, platformUserId, seconds }, 'sendLoadingAnimation: sent successfully');
      }
    } catch (err: any) {
      log.error({ tenantId, err: err.message }, 'sendLoadingAnimation: fetch error');
    }
  }

  private mapMessageType(type: string): NormalizedMessage['messageType'] {
    switch (type) {
      case 'text': return 'text';
      case 'image': return 'image';
      case 'sticker': return 'sticker';
      case 'location': return 'location';
      default: return 'other';
    }
  }

  private async getCredentials(tenantId: string): Promise<{
    channelSecret: string;
    channelAccessToken: string;
  } | null> {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from('tenant_channel_configs')
      .select('credentials_encrypted')
      .eq('tenant_id', tenantId)
      .eq('channel_type', 'line')
      .eq('enabled', true)
      .single();

    if (!data) return null;

    // In production, decrypt credentials. For now, stored as JSON.
    const creds = data.credentials_encrypted as any;
    return {
      channelSecret: creds.channelSecret || '',
      channelAccessToken: creds.channelAccessToken || '',
    };
  }
}

export const lineChannel = new LineChannelAdapter();
