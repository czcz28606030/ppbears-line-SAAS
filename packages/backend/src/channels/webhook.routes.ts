import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { lineChannel } from './line.channel.js';
import { channelRegistry } from './channel.registry.js';
import { orchestrator } from '../core/orchestrator.js';
import { getSupabaseAdmin } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'Webhooks' });

export async function webhookRoutes(app: FastifyInstance) {

  // ============================================================
  // LINE Webhook
  // ============================================================
  app.post<{ Params: { tenantId: string } }>(
    '/line/:tenantId',
    async (request: FastifyRequest<{ Params: { tenantId: string } }>, reply: FastifyReply) => {
      const { tenantId } = request.params;
      const rawBody = JSON.stringify(request.body);
      try {
        const db = getSupabaseAdmin();
        const { data: channelConfig } = await db
          .from('tenant_channel_configs')
          .select('credentials_encrypted')
          .eq('tenant_id', tenantId)
          .eq('channel_type', 'line')
          .eq('enabled', true)
          .single();

        if (!channelConfig) {
          return reply.status(404).send({ error: 'Channel not configured' });
        }

        const signature = request.headers['x-line-signature'] as string;
        const creds = channelConfig.credentials_encrypted as any;
        // Mandatory signature verification — reject if either secret or signature is missing
        if (!creds.channelSecret || !signature) {
          log.warn({ tenantId }, 'LINE webhook rejected: missing channelSecret or signature header');
          return reply.status(403).send({ error: 'Signature verification required' });
        }
        const valid = lineChannel.verifyWithSecret(creds.channelSecret, signature, rawBody);
        if (!valid) {
          log.warn({ tenantId }, 'LINE signature verification failed');
          return reply.status(403).send({ error: 'Invalid signature' });
        }

        const messages = lineChannel.normalizeEvents(request.body);
        for (const message of messages) {
          message.tenantId = tenantId;
          orchestrator.handleMessage(message).catch((err: any) => {
            log.error({ tenantId, err: err.message }, 'Error handling LINE message');
          });
        }
        return reply.status(200).send({ status: 'ok' });
      } catch (err: any) {
        log.error({ tenantId, err: err.message }, 'LINE webhook error');
        return reply.status(500).send({ error: 'Internal error' });
      }
    },
  );

  // ============================================================
  // Messenger Webhook
  // ============================================================
  app.get<{ Params: { tenantId: string } }>(
    '/messenger/:tenantId',
    async (request: FastifyRequest<{ Params: { tenantId: string } }>, reply: FastifyReply) => {
      const { tenantId } = request.params;
      const query = request.query as any;
      if (query['hub.mode'] !== 'subscribe') return reply.status(403).send('Verification failed');

      const db = getSupabaseAdmin();
      const { data } = await db
        .from('tenant_channel_configs')
        .select('credentials_encrypted')
        .eq('tenant_id', tenantId)
        .eq('channel_type', 'messenger')
        .eq('enabled', true)
        .single();

      const creds = (data?.credentials_encrypted as any);
      if (creds?.verifyToken && query['hub.verify_token'] === creds.verifyToken) {
        return reply.status(200).send(query['hub.challenge']);
      }
      return reply.status(403).send('Verification failed');
    },
  );

  app.post<{ Params: { tenantId: string } }>(
    '/messenger/:tenantId',
    async (request: FastifyRequest<{ Params: { tenantId: string } }>, reply: FastifyReply) => {
      const { tenantId } = request.params;
      const adapter = channelRegistry.get('messenger');
      if (!adapter) return reply.status(200).send({ status: 'ok' });
      const messages = adapter.normalizeEvents(request.body);
      for (const message of messages) {
        message.tenantId = tenantId;
        orchestrator.handleMessage(message).catch((err: any) => {
          log.error({ tenantId, err: err.message }, 'Error handling Messenger message');
        });
      }
      return reply.status(200).send({ status: 'ok' });
    },
  );

  // ============================================================
  // WhatsApp Webhook
  // ============================================================
  app.get<{ Params: { tenantId: string } }>(
    '/whatsapp/:tenantId',
    async (request: FastifyRequest<{ Params: { tenantId: string } }>, reply: FastifyReply) => {
      const { tenantId } = request.params;
      const query = request.query as any;
      if (query['hub.mode'] !== 'subscribe') return reply.status(403).send('Verification failed');

      const db = getSupabaseAdmin();
      const { data } = await db
        .from('tenant_channel_configs')
        .select('credentials_encrypted')
        .eq('tenant_id', tenantId)
        .eq('channel_type', 'whatsapp')
        .eq('enabled', true)
        .single();

      const creds = (data?.credentials_encrypted as any);
      if (creds?.webhookVerifyToken && query['hub.verify_token'] === creds.webhookVerifyToken) {
        return reply.status(200).send(query['hub.challenge']);
      }
      return reply.status(403).send('Verification failed');
    },
  );

  app.post<{ Params: { tenantId: string } }>(
    '/whatsapp/:tenantId',
    async (request: FastifyRequest<{ Params: { tenantId: string } }>, reply: FastifyReply) => {
      const { tenantId } = request.params;
      const adapter = channelRegistry.get('whatsapp');
      if (!adapter) return reply.status(200).send({ status: 'ok' });
      const messages = adapter.normalizeEvents(request.body);
      for (const message of messages) {
        message.tenantId = tenantId;
        orchestrator.handleMessage(message).catch((err: any) => {
          log.error({ tenantId, err: err.message }, 'Error handling WhatsApp message');
        });
      }
      return reply.status(200).send({ status: 'ok' });
    },
  );
}
