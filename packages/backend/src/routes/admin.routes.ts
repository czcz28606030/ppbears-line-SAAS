import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware, generateAdminToken } from '../middleware/auth.middleware.js';
import { getSupabaseAdmin } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';
import { conversationService } from '../modules/conversation/conversation.service.js';
import { liveAgentService } from '../modules/live-agent/live-agent.service.js';
import { productService } from '../modules/products/product.service.js';
import { knowledgeBaseService } from '../modules/knowledge/knowledge-base.service.js';
import { llmRouter } from '../modules/llm/llm.router.js';
import { taggingService } from '../modules/tagging/tagging.service.js';
import { broadcastService } from '../modules/broadcast/broadcast.service.js';
import { handleOrderQuery } from '../modules/orders/order-query.service.js';
import { quickOrderService } from '../modules/orders/quick-order.service.js';
import { wooRequest } from '../utils/woo-request.js';
import { channelRegistry } from '../channels/channel.registry.js';
import { ChannelType } from '../types/index.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const log = createLogger({ module: 'AdminAPI' });

export async function adminRoutes(app: FastifyInstance) {
  // ---- Auth ----
  app.post('/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const { email, password } = request.body as { email: string; password: string };
    const db = getSupabaseAdmin();

    const { data: user } = await db
      .from('tenant_admin_users')
      .select('*')
      .eq('email', email)
      .eq('status', 'active')
      .single();

    if (!user) {
      return reply.status(401).send({ error: '帳號或密碼錯誤' });
    }

    // --- Password verification with auto-migration from SHA-256 → bcrypt ---
    let passwordValid = false;

    if (user.password_hash?.startsWith('$2')) {
      // Already bcrypt — verify directly
      passwordValid = await bcrypt.compare(password, user.password_hash);
    } else {
      // Legacy SHA-256 hash — compare and auto-upgrade to bcrypt on success
      const sha256Hash = crypto.createHash('sha256').update(password).digest('hex');
      if (sha256Hash === user.password_hash) {
        passwordValid = true;
        // Upgrade to bcrypt silently
        const newHash = await bcrypt.hash(password, 12);
        await db.from('tenant_admin_users').update({ password_hash: newHash }).eq('id', user.id);
        log.info({ userId: user.id }, 'Password hash upgraded from SHA-256 to bcrypt');
      }
    }

    if (!passwordValid) {
      return reply.status(401).send({ error: '帳號或密碼錯誤' });
    }

    const token = generateAdminToken({
      sub: user.id,
      tenantId: user.tenant_id,
      email: user.email,
      role: user.role,
    });

    return { token, user: { id: user.id, email: user.email, role: user.role, tenantId: user.tenant_id } };
  });

  // ---- Protected Routes (require JWT) ----
  app.register(async (protectedApp) => {
    protectedApp.addHook('onRequest', authMiddleware);

    // Dashboard Stats
    protectedApp.get('/dashboard/stats', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const db = getSupabaseAdmin();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = today.toISOString();

      const [convCount, msgCount, liveAgentCount, errorCount] = await Promise.all([
        db.from('conversations').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gte('started_at', todayIso),
        db.from('messages').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('role', 'assistant').gte('created_at', todayIso),
        db.from('live_agent_sessions').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).is('released_at', null),
        db.from('system_errors').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gte('created_at', todayIso),
      ]);

      return {
        todayConversations: convCount.count || 0,
        todayAiReplies: msgCount.count || 0,
        activeLiveAgents: liveAgentCount.count || 0,
        todayErrors: errorCount.count || 0,
      };
    });

    // WooCommerce diagnostic endpoints
    protectedApp.get('/woo/test-connection', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const db = getSupabaseAdmin();
      const { data } = await db
        .from('tenant_settings')
        .select('key, value')
        .eq('tenant_id', tenantId)
        .in('key', ['woo_base_url', 'woo_consumer_key', 'woo_consumer_secret']);

      const settings: Record<string, string> = {};
      for (const row of data || []) settings[row.key] = row.value;

      const baseUrl = settings['woo_base_url'];
      const consumerKey = settings['woo_consumer_key'];
      const consumerSecret = settings['woo_consumer_secret'];

      const diagnosis: Record<string, any> = {
        woo_base_url: baseUrl ? `✅ 已設定 (${baseUrl})` : '❌ 未設定',
        woo_consumer_key: consumerKey ? `✅ 已設定 (${consumerKey.substring(0, 8)}...)` : '❌ 未設定',
        woo_consumer_secret: consumerSecret ? `✅ 已設定` : '❌ 未設定',
        proxy_url: process.env.WOO_PROXY_URL ? `✅ 已設定 (${process.env.WOO_PROXY_URL})` : '❌ 未設定（將直連 WooCommerce）',
        proxy_secret: process.env.WOO_PROXY_SECRET ? '✅ 已設定' : '❌ 未設定',
      };

      if (!baseUrl || !consumerKey || !consumerSecret) {
        return { ok: false, diagnosis, error: '三個欄位皆必須填寫' };
      }

      try {
        // Step 0: Fetch Render Outbound IP
        try {
          const ipRes = await wooRequest('https://api.ipify.org?format=text');
          diagnosis.render_outbound_ip = ipRes.ok ? await ipRes.text() : '(Failed to fetch IP)';
        } catch (e) {
          diagnosis.render_outbound_ip = '(Failed to fetch IP)';
        }

        // Step 1: DNS resolution check
        const { diagnoseDns } = await import('../utils/woo-request.js');
        const hostname = new URL(baseUrl).hostname;
        const dnsResult = await diagnoseDns(hostname);
        diagnosis.dns_check = dnsResult.ok ? `\u2705 ${dnsResult.detail}` : `\u274c DNS failed: ${dnsResult.detail}`;

        if (!dnsResult.ok) {
          return { ok: false, diagnosis, error: `DNS resolution failed for ${hostname}: ${dnsResult.detail}` };
        }

        // Step 2: Multi-variant connectivity probe
        const rawHost = new URL(baseUrl).hostname.replace(/^www\./, '');
        const probeUrls: Record<string, string> = {
          'https_no_www': `https://${rawHost}/wp-json/`,
          'https_www':    `https://www.${rawHost}/wp-json/`,
          'http_no_www':  `http://${rawHost}/wp-json/`,
        };

        const probeResults: Record<string, string> = {};
        let workingBase: string | null = null;
        for (const [label, probeUrl] of Object.entries(probeUrls)) {
          try {
            const pr = await wooRequest(probeUrl, { timeoutMs: 8000 });
            probeResults[label] = `✅ HTTP ${pr.status}`;
            if (pr.ok && !workingBase) {
              workingBase = probeUrl.replace('/wp-json/', '');
            }
          } catch (pe: any) {
            probeResults[label] = `❌ ${pe.message || pe.code || 'error'}`;
          }
        }
        diagnosis.connectivity_probe = probeResults;

        if (!workingBase) {
          return { ok: false, diagnosis, error: `連線測試：HTTPS 非 www、HTTPS www、HTTP 三種路由皆無法到達 ${rawHost}。請確認 Hostinger 防火牆設定。` };
        }

        // Step 3: WooCommerce API using working base
        const url = `${workingBase}/wp-json/wc/v3/orders?per_page=1&consumer_key=${consumerKey}&consumer_secret=${consumerSecret}`;
        const res = await wooRequest(url);
        const body = await res.text();
        diagnosis.api_status = res.status;
        diagnosis.api_ok = res.ok;
        diagnosis.api_working_base = workingBase;
        diagnosis.api_response_preview = body.substring(0, 300);
        return { ok: res.ok, diagnosis };
      } catch (err: any) {
        const code: string = err.code || '';
        const syscall: string = err.syscall || '';
        const msg: string = err.message || String(err) || '(no message)';
        const detailedError = [msg, code ? `code:${code}` : '', syscall ? `syscall:${syscall}` : ''].filter(Boolean).join(' | ');
        log.error({ msg, code, syscall, stack: err.stack }, 'WooCommerce connection test failed');
        diagnosis.raw_error_code = code || '(none)';
        diagnosis.raw_error_syscall = syscall || '(none)';
        return { ok: false, diagnosis, error: detailedError };
      }
    });

    protectedApp.get<{ Querystring: { order: string } }>('/woo/test-order', async (request: FastifyRequest<{ Querystring: { order: string } }>) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { order } = request.query;

      const proxyMode = !!(process.env.WOO_PROXY_URL && process.env.WOO_PROXY_SECRET);

      try {
        const { wooCommerceService } = await import('../modules/orders/woocommerce.service.js');
        const result = await wooCommerceService.findOrderByNumber(tenantId, order);
        return {
          ok: !!result,
          proxy_mode: proxyMode,
          proxy_url: process.env.WOO_PROXY_URL || '（未設定）',
          order_found: !!result,
          order_number: result?.number ?? null,
          order_status: result?.status ?? null,
          order_total: result?.total ?? null,
          message: result ? `✅ 訂單 #${result.number} 查詢成功` : '❌ 查無訂單（可能是 API 連線問題或訂單不存在）',
        };
      } catch (err: any) {
        return { ok: false, proxy_mode: proxyMode, error: err.message };
      }
    });

    protectedApp.get<{ Querystring: { order: string } }>('/woo/test-proxy-raw', async (request: FastifyRequest<{ Querystring: { order: string } }>) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { order } = request.query as { order: string };

      const proxyUrl    = process.env.WOO_PROXY_URL;
      const proxySecret = process.env.WOO_PROXY_SECRET;
      if (!proxyUrl || !proxySecret) return { ok: false, error: 'Proxy env vars not set' };

      const db = getSupabaseAdmin();
      const { data } = await db.from('tenant_settings').select('key, value')
        .eq('tenant_id', tenantId).in('key', ['woo_consumer_key', 'woo_consumer_secret']);
      const settings: Record<string, string> = {};
      for (const row of data || []) settings[row.key] = row.value;
      const ck = settings['woo_consumer_key'];
      const cs = settings['woo_consumer_secret'];
      if (!ck || !cs) return { ok: false, error: 'WooCommerce credentials not set' };

      const testUrl = `${proxyUrl}?path=${encodeURIComponent('orders/' + order)}&consumer_key=${ck}&consumer_secret=${cs}`;

      try {
        const res = await wooRequest(testUrl, { headers: { 'X-Proxy-Secret': proxySecret } });
        const body = await res.text();
        return {
          ok: res.ok,
          http_status: res.status,
          is_json: body.trimStart().startsWith('{') || body.trimStart().startsWith('['),
          body_length: body.length,
          body_preview: body.substring(0, 600),
        };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    });

    // Conversations
    protectedApp.get('/conversations', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const query = request.query as any;
      return conversationService.listConversations(tenantId, {
        status: query.status,
        limit: parseInt(query.limit || '50'),
        offset: parseInt(query.offset || '0'),
      });
    });

    protectedApp.get<{ Params: { id: string } }>('/conversations/:id', async (request) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { id } = request.params;
      const db = getSupabaseAdmin();

      const [conversation, messages] = await Promise.all([
        db.from('conversations').select('*, users(display_name, unified_user_id)').eq('id', id).eq('tenant_id', tenantId).single(),
        db.from('messages').select('*').eq('conversation_id', id).eq('tenant_id', tenantId).order('created_at', { ascending: true }),
      ]);

      return { conversation: conversation.data, messages: messages.data || [] };
    });

    // Admin: send a message to the customer in a conversation
    protectedApp.post<{ Params: { id: string } }>('/conversations/:id/send', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const adminEmail = (request as any).jwtUser.email;
      const { id: conversationId } = request.params;
      const { content, sender_type = 'human' } = (request.body as any) || {};

      if (!content?.trim()) return reply.status(400).send({ error: '訊息內容不可為空' });
      if (!['ai', 'human'].includes(sender_type)) return reply.status(400).send({ error: 'sender_type 必須為 ai 或 human' });

      const db = getSupabaseAdmin();

      // Verify conversation belongs to tenant and get channel info
      const { data: conv } = await db
        .from('conversations')
        .select('user_id, channel_type')
        .eq('id', conversationId)
        .eq('tenant_id', tenantId)
        .single();

      if (!conv) return reply.status(404).send({ error: 'Conversation not found' });

      // Get platform_user_id from channel_identities
      const { data: identity } = await db
        .from('channel_identities')
        .select('platform_user_id')
        .eq('tenant_id', tenantId)
        .eq('user_id', conv.user_id)
        .eq('channel_type', conv.channel_type)
        .single();

      if (!identity) return reply.status(404).send({ error: 'Channel identity not found for this user' });

      // Send via the appropriate channel adapter
      const adapter = channelRegistry.get(conv.channel_type as ChannelType);
      if (!adapter) return reply.status(400).send({ error: `Unsupported channel: ${conv.channel_type}` });

      try {
        await adapter.sendReply(tenantId, identity.platform_user_id, [{ type: 'text', content: content.trim() }]);
      } catch (err: any) {
        log.error({ conversationId, channel: conv.channel_type, err: err.message }, 'Failed to send message via channel');
        return reply.status(502).send({ error: `Channel send failed: ${err.message}` });
      }

      // Persist message in DB
      const { data: saved, error: saveErr } = await db.from('messages').insert({
        conversation_id: conversationId,
        tenant_id: tenantId,
        role: 'assistant',
        content: content.trim(),
        metadata_json: {
          sender_type,          // 'ai' | 'human'
          sent_by: adminEmail,  // admin email for audit
        },
        created_at: new Date().toISOString(),
      }).select('*').single();

      if (saveErr) return reply.status(500).send({ error: saveErr.message });

      // Update conversation last_message_at
      await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId);

      return { success: true, message: saved };
    });

    // Mark a message as corrected and saved to knowledge base
    protectedApp.patch<{ Params: { messageId: string } }>('/messages/:messageId/correct', async (request: FastifyRequest<{ Params: { messageId: string } }>, reply: FastifyReply) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const adminEmail = (request as any).jwtUser.email;
      const { messageId } = request.params;
      const db = getSupabaseAdmin();

      // Verify the message belongs to this tenant
      const { data: msg } = await db
        .from('messages')
        .select('id')
        .eq('id', messageId)
        .eq('tenant_id', tenantId)
        .single();

      if (!msg) return reply.status(404).send({ error: 'Message not found' });

      const correctedAt = new Date().toISOString();
      const { error } = await db
        .from('messages')
        .update({ corrected_at: correctedAt, corrected_by: adminEmail })
        .eq('id', messageId)
        .eq('tenant_id', tenantId);

      if (error) return reply.status(500).send({ error: error.message });

      return { success: true, corrected_at: correctedAt };
    });

    // Admin: activate live agent for a conversation (takeover by admin)
    protectedApp.post<{ Params: { id: string } }>('/conversations/:id/takeover', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const adminEmail = (request as any).jwtUser.email;
      const { id: conversationId } = request.params;
      const { permanent = false } = (request.body as any) || {};
      const db = getSupabaseAdmin();

      // Look up conversation to get user_id
      const { data: conv } = await db.from('conversations').select('user_id, status').eq('id', conversationId).eq('tenant_id', tenantId).single();
      if (!conv) return reply.status(404).send({ error: 'Conversation not found' });

      if (permanent) {
        // Permanent mode: expires in year 2099 (won't be cleaned up by the auto-expire scheduler)
        // IMPORTANT: Even if already in live_agent mode, we must still create a permanent session.
        // The old session may be a temporary one that will expire, causing the bot to re-engage.
        // Fix: release any existing non-permanent sessions first, then insert the permanent one.
        const permanentExpiry = new Date('2099-12-31T23:59:59Z').toISOString();

        // Release any existing active (non-permanent) sessions for this conversation
        const { data: existingSessions } = await db
          .from('live_agent_sessions')
          .select('id, expires_at')
          .eq('conversation_id', conversationId)
          .eq('tenant_id', tenantId)
          .is('released_at', null);

        const now = new Date().toISOString();
        for (const s of existingSessions || []) {
          const isAlreadyPermanent = s.expires_at && new Date(s.expires_at).getFullYear() >= 2099;
          if (isAlreadyPermanent) {
            // Already permanent — nothing to do
            return { success: true, permanent: true, message: 'Already in permanent live agent mode' };
          }
          // Release the temporary session
          await db.from('live_agent_sessions')
            .update({ released_at: now, released_by: `admin:${adminEmail}:upgrade_to_permanent` })
            .eq('id', s.id);
        }

        const { data, error } = await db.from('live_agent_sessions').insert({
          tenant_id: tenantId,
          user_id: conv.user_id,
          conversation_id: conversationId,
          reason: `Permanent admin takeover by ${adminEmail}`,
          started_at: now,
          expires_at: permanentExpiry,
        }).select('id').single();
        if (error) return reply.status(500).send({ error: error.message });
        await db.from('conversations').update({ status: 'live_agent' }).eq('id', conversationId);
        return { success: true, permanent: true, sessionId: data!.id };
      } else {
        // Non-permanent: if already in live_agent mode, skip to avoid duplicate sessions
        if (conv.status === 'live_agent') return { success: true, message: 'Already in live agent mode' };
        await liveAgentService.activate(tenantId, conv.user_id, conversationId, `Admin takeover by ${adminEmail}`);
        return { success: true, permanent: false };
      }
    });

    // Admin: release live agent session (return to AI)
    protectedApp.post<{ Params: { id: string } }>('/conversations/:id/release', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const adminEmail = (request as any).jwtUser.email;
      const { id: conversationId } = request.params;
      const db = getSupabaseAdmin();

      // Find the active live agent session for this conversation
      const { data: session } = await db
        .from('live_agent_sessions')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('conversation_id', conversationId)
        .is('released_at', null)
        .single();

      if (!session) return reply.status(404).send({ error: 'No active live agent session found' });

      await liveAgentService.release(session.id, `admin:${adminEmail}`);
      return { success: true };
    });

    // Live Agent Management
    protectedApp.get('/live-agent', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      return { sessions: await liveAgentService.getActiveSessions(tenantId) };
    });


    protectedApp.delete<{ Params: { id: string } }>('/live-agent/:id', async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const { id } = request.params;
      const adminId = (request as any).jwtUser.sub;
      await liveAgentService.release(id, `admin:${adminId}`);
      return { success: true };
    });

    // Model Configs
    protectedApp.get('/models', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const db = getSupabaseAdmin();
      const { data } = await db.from('tenant_model_configs').select('id, provider, model_name, temperature, max_tokens, is_default, enabled, created_at').eq('tenant_id', tenantId);
      return { models: data || [] };
    });

    protectedApp.post('/models', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const body = request.body as any;
      const db = getSupabaseAdmin();

      // If setting as default, unset others
      if (body.is_default) {
        await db.from('tenant_model_configs').update({ is_default: false }).eq('tenant_id', tenantId);
      }

      const { data, error } = await db.from('tenant_model_configs').insert({
        tenant_id: tenantId,
        provider: body.provider,
        model_name: body.model_name,
        api_key_encrypted: body.api_key, // TODO: encrypt
        temperature: body.temperature || 0.7,
        max_tokens: body.max_tokens || 1024,
        timeout_ms: body.timeout_ms || 30000,
        retry_count: body.retry_count || 2,
        is_default: body.is_default || false,
        enabled: true,
      }).select().single();

      if (error) return { error: error.message };
      return { model: data };
    });

    // Audit Logs
    protectedApp.get('/audit-logs', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const query = request.query as any;
      const db = getSupabaseAdmin();
      const { data } = await db.from('audit_logs').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(parseInt(query.limit || '100'));
      return { logs: data || [] };
    });

    // System Settings
    protectedApp.get('/settings', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const db = getSupabaseAdmin();
      const { data } = await db.from('tenant_settings').select('*').eq('tenant_id', tenantId);
      return { settings: data || [] };
    });

    protectedApp.put('/settings', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { key, value } = request.body as { key: string; value: string };
      const db = getSupabaseAdmin();
      await db.from('tenant_settings').upsert({
        tenant_id: tenantId,
        key,
        value,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id,key' });
      return { success: true };
    });

    // Channel Configs
    protectedApp.get('/channels', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const db = getSupabaseAdmin();
      const { data } = await db.from('tenant_channel_configs').select('id, channel_type, enabled, created_at').eq('tenant_id', tenantId);
      return { channels: data || [] };
    });

    // Prompt Configs
    protectedApp.get('/prompts', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const db = getSupabaseAdmin();
      const { data } = await db.from('tenant_prompt_configs').select('*').eq('tenant_id', tenantId).order('prompt_type').order('version', { ascending: false });
      return { prompts: data || [] };
    });

    protectedApp.post('/prompts', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const body = request.body as any;
      const db = getSupabaseAdmin();
      const { data } = await db.from('tenant_prompt_configs').insert({
        tenant_id: tenantId,
        prompt_type: body.prompt_type,
        content: body.content,
        version: body.version || 1,
      }).select().single();
      return { prompt: data };
    });

    // Knowledge Base
    protectedApp.get('/knowledge', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const docs = await knowledgeBaseService.listDocuments(tenantId);
      return { documents: docs };
    });

    protectedApp.post('/knowledge/upload-text', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { filename, content, category } = request.body as { filename: string; content: string; category?: string };
      if (!filename || !content) throw new Error('filename and content are required');
      const storagePath = `tenants/${tenantId}/knowledge/${Date.now()}_${filename}`;
      const docId = await knowledgeBaseService.registerDocument(tenantId, filename, 'text', storagePath, category || 'general', content);
      // Process asynchronously
      knowledgeBaseService.processDocument(tenantId, docId, content).catch((err: any) =>
        log.error({ tenantId, docId, err: err.message }, 'Background document processing failed')
      );
      return { documentId: docId, message: '文件已上傳，正在進行索引...' };
    });

    protectedApp.post('/knowledge/upload', async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: 'No file uploaded' });

      const category = (data.fields.category as any)?.value || 'general';
      const fileType = data.filename.split('.').pop()?.toLowerCase() || 'txt';
      const filename = data.filename;
      const buffer = await data.toBuffer();

      let content = '';
      try {
        if (fileType === 'pdf') {
          const pdfParse = (await import('pdf-parse')).default;
          const pdfData = await pdfParse(buffer);
          content = pdfData.text;
        } else if (fileType === 'docx') {
          const mammoth = await import('mammoth');
          const result = await mammoth.extractRawText({ buffer });
          content = result.value;
        } else {
          // txt, md, csv, json — smart encoding detection
          const utf8 = buffer.toString('utf-8');
          // UTF-8 BOM is EF BB BF
          const hasBom = buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF;
          // UTF-16 LE BOM is FF FE (Windows Notepad default)
          const isUtf16LE = buffer[0] === 0xFF && buffer[1] === 0xFE;

          if (isUtf16LE) {
            // Decode as UTF-16 LE (Windows 記事本預設儲存格式)
            content = buffer.slice(2).toString('utf16le');
          } else if (hasBom) {
            content = buffer.slice(3).toString('utf-8');
          } else {
            content = utf8;
          }
        }
      } catch (err: any) {
        log.error({ err: err.message, fileType }, 'Failed to parse file content');
        return reply.status(400).send({ error: 'Failed to parse document content: ' + err.message });
      }

      if (!content || !content.trim()) {
        return reply.status(400).send({ error: 'Extracted content is empty or unreadable' });
      }

      const storagePath = `tenants/${tenantId}/knowledge/${Date.now()}_${filename}`;
      const docId = await knowledgeBaseService.registerDocument(tenantId, filename, fileType, storagePath, category, content);
      
      // Process asynchronously
      knowledgeBaseService.processDocument(tenantId, docId, content).catch((err: any) =>
        log.error({ tenantId, docId, err: err.message }, 'Background document processing failed')
      );
      
      return { documentId: docId, message: '文件已上傳，正在進行索引...' };
    });

    protectedApp.delete<{ Params: { id: string } }>('/knowledge/:id', async (request) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { id } = request.params;
      await knowledgeBaseService.deleteDocument(tenantId, id);
      return { success: true };
    });

    protectedApp.patch<{ Params: { id: string }; Body: { filename: string } }>('/knowledge/:id/rename', async (request) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { id } = request.params;
      const { filename } = request.body;
      if (!filename || filename.trim() === '') {
        throw new Error('Filename cannot be empty');
      }
      await knowledgeBaseService.renameDocument(tenantId, id, filename.trim());
      return { success: true };
    });

    protectedApp.get<{ Params: { id: string } }>('/knowledge/:id/content', async (request) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { id } = request.params;
      const db = getSupabaseAdmin();
      const { data } = await db.from('knowledge_documents').select('raw_content').eq('id', id).eq('tenant_id', tenantId).single();
      
      let content = data?.raw_content || '';
      
      // 針對舊文件 (原先沒有 raw_content 欄位時上傳的)，嘗試從 knowledge_chunks 撈取
      if (!content) {
        const { data: chunks } = await db.from('knowledge_chunks')
          .select('content')
          .eq('document_id', id)
          .eq('tenant_id', tenantId)
          .order('chunk_index', { ascending: true });
          
        if (chunks && chunks.length > 0) {
          // 因為預設有 50 字元的重疊 (overlap)，這裡簡單用分隔線串接，使用者仍可自行刪除重複處
          content = chunks.map(c => c.content).join('\n\n');
        }
      }
      
      return { content };
    });

    protectedApp.put<{ Params: { id: string } }>('/knowledge/:id/content', async (request) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { id } = request.params;
      const { content } = request.body as { content: string };
      const db = getSupabaseAdmin();
      
      await db.from('knowledge_documents').update({ raw_content: content }).eq('id', id).eq('tenant_id', tenantId);
      
      // Reprocess embeddings
      knowledgeBaseService.processDocument(tenantId, id, content).catch((err: any) =>
        log.error({ tenantId, docId: id, err: err.message }, 'Background document processing failed')
      );
      
      return { success: true };
    });

    // Products Index
    protectedApp.get('/products', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const db = getSupabaseAdmin();
      const { data } = await db
        .from('product_index')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('synced_at', { ascending: false });
      return { products: data || [] };
    });

    protectedApp.get('/products/sync/last-result', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const db = getSupabaseAdmin();
      const { data } = await db
        .from('sync_jobs')
        .select('status, items_processed, error_message, started_at, completed_at')
        .eq('tenant_id', tenantId)
        .eq('job_type', 'product_sync')
        .order('started_at', { ascending: false })
        .limit(1)
        .single();
      return { job: data || null };
    });

    protectedApp.post('/products/sync', async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as any).jwtUser.tenantId;
      // Run async so webhook returns immediately
      productService.syncProducts(tenantId).then(result =>
        log.info({ tenantId, ...result }, 'Product sync finished')
      ).catch((err: any) =>
        log.error({ tenantId, err: err.message }, 'Product sync failed')
      );
      return reply.status(202).send({ message: '產品同步任務已啟動，請稍後刷新查看結果。' });
    });

    // ── Staging index management ─────────────────────────────────────────────

    // GET /products/staging/count — returns staging and active product counts
    protectedApp.get('/products/staging/count', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const db = getSupabaseAdmin();
      const [stagingRes, activeRes] = await Promise.all([
        db.from('product_index').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).eq('status', 'staging'),
        db.from('product_index').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).eq('status', 'active'),
      ]);
      return {
        stagingCount: stagingRes.count || 0,
        activeCount: activeRes.count || 0,
      };
    });

    // POST /products/staging/apply — promote staging → active (atomic swap)
    protectedApp.post('/products/staging/apply', async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const db = getSupabaseAdmin();

      // Check staging exists
      const { count: stagingCount } = await db
        .from('product_index').select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).eq('status', 'staging');

      if (!stagingCount || stagingCount === 0) {
        return reply.status(400).send({ error: '暫存索引為空，請先執行本機同步腳本。' });
      }

      // 1. Delete old active records
      await db.from('product_index').delete()
        .eq('tenant_id', tenantId).eq('status', 'active');

      // 2. Promote staging → active
      const { error } = await db.from('product_index')
        .update({ status: 'active', synced_at: new Date().toISOString() })
        .eq('tenant_id', tenantId).eq('status', 'staging');

      if (error) return reply.status(500).send({ error: error.message });

      log.info({ tenantId, promoted: stagingCount }, 'Staging index applied to active');
      return { success: true, promoted: stagingCount };
    });

    protectedApp.get('/products/search', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { q } = request.query as { q?: string };
      if (!q) return { products: [] };
      const results = await productService.searchProducts(tenantId, q);
      return { products: results };
    });


    // ── Product URL Allowlist ────────────────────────────────────────────────

    protectedApp.get('/products/allowlist', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const db = getSupabaseAdmin();
      const { data } = await db
        .from('product_url_allowlist')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      return { allowlist: data || [] };
    });

    protectedApp.post('/products/allowlist', async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { url, note } = request.body as { url: string; note?: string };
      if (!url) return reply.status(400).send({ error: '請提供產品 URL' });
      const db = getSupabaseAdmin();
      const { data, error } = await db
        .from('product_url_allowlist')
        .insert({ tenant_id: tenantId, url: url.trim(), note: note || '' })
        .select()
        .single();
      if (error) return reply.status(400).send({ error: error.message });
      return { item: data };
    });

    protectedApp.delete<{ Params: { id: string } }>('/products/allowlist/:id', async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { id } = (request as any).params;
      const db = getSupabaseAdmin();
      await db.from('product_url_allowlist').delete().eq('id', id).eq('tenant_id', tenantId);
      return { success: true };
    });

    // POST-based delete (for compatibility with frontends that have CORS/caching issues with DELETE)
    protectedApp.post('/products/allowlist/:id/delete', async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { id } = (request as any).params as { id: string };
      const db = getSupabaseAdmin();
      const { error } = await db
        .from('product_url_allowlist')
        .delete()
        .eq('id', id)
        .eq('tenant_id', tenantId);
      if (error) return reply.status(400).send({ error: error.message });
      return { success: true };
    });

    // ---- Chat Test (simulate full AI pipeline synchronously) ----
    protectedApp.post('/chat/test', async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { message, history = [] } = request.body as {
        message: string;
        history?: Array<{ role: 'user' | 'assistant'; content: string }>;
      };

      if (!message?.trim()) return reply.status(400).send({ error: 'message is required' });

      const sources = { usedProducts: false, usedKnowledge: false, productCount: 0, kbCount: 0 };

      // -1. Quick order command (keyword → create WC order; runs before everything else)
      const quickReply = await quickOrderService.handleIfCommand(tenantId, message);
      if (quickReply !== null) {
        return { reply: quickReply, sources, model: 'quick-order', provider: 'system' };
      }

      // 0. Order query interception — must run FIRST (stateful, multi-turn)
      const orderReply = await handleOrderQuery(tenantId, 'admin-chat-test', message);
      if (orderReply !== null) {
        return { reply: orderReply, sources, model: 'order-handler', provider: 'system' };
      }

      // 1. Product search intent
      let productAiContext = '';
      if (productService.isProductQueryIntent(message)) {
        const keyword = productService.extractSearchKeyword(message);
        const products = await productService.searchProducts(tenantId, keyword, 5);
        if (products.length > 0) {
          productAiContext = productService.formatProductsAsAiContext(products);
          sources.usedProducts = true;
          sources.productCount = products.length;
        }
      }

      // 2. Knowledge base RAG
      const kbChunks = await knowledgeBaseService.retrieveContext(tenantId, message, 3);
      let kbContext = '';
      if (kbChunks.length > 0) {
        kbContext = `\n\n以下是從知識庫擷取的相關參考資料：\n${kbChunks.map((c, i) => `[${i + 1}] ${c}`).join('\n')}`;
        sources.usedKnowledge = true;
        sources.kbCount = kbChunks.length;
      }

      // 3. System prompt
      const db = getSupabaseAdmin();
      const { data: promptData } = await db
        .from('tenant_prompt_configs')
        .select('content')
        .eq('tenant_id', tenantId)
        .eq('prompt_type', 'system')
        .order('version', { ascending: false })
        .limit(1)
        .single();

      const basePrompt = promptData?.content ||
        `你是 PPBears 的 AI 客服助手。你只能回答與 PPBears 品牌、產品、訂單、客製化手機殼、售後服務相關的問題。回答請使用繁體中文，語氣友善專業。`;

      const systemPrompt = basePrompt + productAiContext + kbContext;

      // 4. Call LLM
      const llmMessages = [
        ...history,
        { role: 'user' as const, content: message },
      ];

      const llmResponse = await llmRouter.call(tenantId, { messages: llmMessages, systemPrompt });

      // 5. Append footer if configured (dedup)
      const { data: footerSet } = await db
        .from('tenant_settings')
        .select('value')
        .eq('tenant_id', tenantId)
        .eq('key', 'bot_message_footer')
        .single();

      let reply_text = llmResponse.content;
      if (footerSet?.value && !reply_text.includes(footerSet.value.trim())) {
        reply_text += `\n\n${footerSet.value}`;
      }

      return { reply: reply_text, sources, model: llmResponse.model, provider: llmResponse.provider };
    });

    // =========================================================
    // ---- Audience & Tagging Routes ----
    // =========================================================

    // GET /api/admin/users — list users, optionally filtered by tag
    protectedApp.get('/users', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { tag, limit = '50', offset = '0' } = request.query as any;
      return taggingService.listUsersByTag(tenantId, tag || undefined, parseInt(limit), parseInt(offset));
    });

    // GET /api/admin/tags — list distinct tags for this tenant
    protectedApp.get('/tags', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const tags = await taggingService.listDistinctTags(tenantId);
      return { tags };
    });

    // GET /api/admin/users/:userId/tags
    protectedApp.get<{ Params: { userId: string } }>('/users/:userId/tags', async (request) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { userId } = request.params;
      const tags = await taggingService.getUserTags(tenantId, userId);
      return { tags };
    });

    // POST /api/admin/users/:userId/tags — manually add a tag
    protectedApp.post<{ Params: { userId: string } }>('/users/:userId/tags', async (request, reply) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { userId } = request.params;
      const { tag } = request.body as { tag: string };
      if (!tag) return reply.status(400).send({ error: 'tag is required' });
      await taggingService.addTag(tenantId, userId, tag);
      return { success: true };
    });

    // DELETE /api/admin/users/:userId/tags/:tag — remove a tag
    protectedApp.delete<{ Params: { userId: string; tag: string } }>('/users/:userId/tags/:tag', async (request) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { userId, tag } = request.params;
      await taggingService.removeTag(tenantId, userId, decodeURIComponent(tag));
      return { success: true };
    });

    // GET /api/admin/users/:userId/conversations — recent messages for audience review
    protectedApp.get<{ Params: { userId: string } }>('/users/:userId/conversations', async (request) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { userId } = request.params;
      const db = getSupabaseAdmin();

      // Find the most recent conversation for this user
      const { data: conv } = await db
        .from('conversations')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .order('started_at', { ascending: false })
        .limit(1)
        .single();

      if (!conv) return { messages: [] };

      // Fetch last 20 messages (oldest first for display)
      const { data: messages } = await db
        .from('messages')
        .select('role, content, created_at')
        .eq('conversation_id', conv.id)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true })
        .limit(20);

      return { messages: messages || [] };
    });

    // =========================================================
    // ---- Broadcast Routes ----
    // =========================================================

    // POST /api/admin/broadcast/preview — estimate recipient count before sending
    protectedApp.post('/broadcast/preview', async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { tag_filter } = request.body as { tag_filter: string };
      if (!tag_filter) return reply.status(400).send({ error: 'tag_filter is required' });
      const recipients = await broadcastService.getRecipients(tenantId, tag_filter);
      return { count: recipients.length };
    });

    // GET /api/admin/broadcast — list all campaigns
    protectedApp.get('/broadcast', async (request: FastifyRequest) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const campaigns = await broadcastService.listCampaigns(tenantId);
      return { campaigns };
    });

    // POST /api/admin/broadcast — create and send a campaign
    protectedApp.post('/broadcast', async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as any).jwtUser.tenantId;
      const { name, tag_filter, message } = request.body as { name: string; tag_filter: string; message: string };
      if (!name || !tag_filter || !message) {
        return reply.status(400).send({ error: 'name, tag_filter, and message are required' });
      }
      const campaignId = await broadcastService.createAndSend(tenantId, name, tag_filter, message);
      return reply.status(202).send({ campaignId, status: 'sending' });
    });

  });
}
