import { NormalizedMessage, ReplyMessage, ProcessingContext, ChatMessage } from '../types/index.js';
import { identityService } from './identity.service.js';
import { authService } from './auth.service.js';
import { MessageGateService, MergedBatch } from './message-gate.js';
import { liveAgentService } from '../modules/live-agent/live-agent.service.js';
import { conversationService } from '../modules/conversation/conversation.service.js';
import { llmRouter } from '../modules/llm/llm.router.js';
import { channelRegistry } from '../channels/channel.registry.js';
import { getSupabaseAdmin } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';
import { writeAuditLog } from '../utils/audit.js';
import { handleOrderQuery, isOrderQueryIntent } from '../modules/orders/order-query.service.js';
import { productService } from '../modules/products/product.service.js';
import { knowledgeBaseService } from '../modules/knowledge/knowledge-base.service.js';
import { usageTrackingService } from '../modules/tenant/usage-tracking.service.js';
import { taggingService } from '../modules/tagging/tagging.service.js';
import { quickOrderService } from '../modules/orders/quick-order.service.js';

const log = createLogger({ module: 'Orchestrator' });

/**
 * Core orchestrator: the central brain that routes each incoming message
 * through the correct pipeline (admin vs customer, live agent check, etc.)
 */
export class Orchestrator {
  private messageGate: MessageGateService;

  constructor() {
    this.messageGate = new MessageGateService(this.onBatchReady.bind(this));
  }

  /**
   * Entry point: called when a normalized message arrives from any channel.
   */
  async handleMessage(message: NormalizedMessage): Promise<void> {
    const { tenantId, channelType, platformUserId, content } = message;

    if (!content || message.messageType !== 'text') {
      log.debug({ tenantId, platformUserId }, 'Ignoring non-text message');
      return;
    }

    // 1. Resolve user identity
    const { userId } = await identityService.resolveUser(
      tenantId, channelType, platformUserId
    );

    // 2. Determine role
    const role = await authService.determineRole(tenantId, channelType, platformUserId);

    if (role === 'admin') {
      await this.handleAdminMessage(tenantId, channelType, platformUserId, userId, content);
      return;
    }

    // 3. Customer path: check live agent mode
    const isLiveAgent = await liveAgentService.isLiveAgentActive(tenantId, userId);
    if (isLiveAgent) {
      log.info({ tenantId, userId }, 'User in live agent mode, bot silent');
      // Still save the message for agent review
      const convId = await conversationService.getOrCreateConversation(tenantId, userId, channelType);
      await conversationService.saveMessage(tenantId, convId, 'user', content);
      return;
    }

    // 4. Check for live agent trigger phrases
    if (liveAgentService.isTriggerPhrase(content)) {
      const convId = await conversationService.getOrCreateConversation(tenantId, userId, channelType);
      await conversationService.saveMessage(tenantId, convId, 'user', content);

      // Load live agent settings from tenant_settings
      const db = getSupabaseAdmin();
      const { data: settingsRows } = await db
        .from('tenant_settings')
        .select('key, value')
        .eq('tenant_id', tenantId)
        .in('key', ['live_agent_hours_start', 'live_agent_hours_end', 'live_agent_takeover_message', 'live_agent_off_hours_message']);

      const s: Record<string, string> = {};
      for (const r of settingsRows || []) if (r.key && r.value) s[r.key] = r.value;

      const hoursStart = s['live_agent_hours_start'] || '';
      const hoursEnd   = s['live_agent_hours_end'] || '';
      const takeoverMsg = s['live_agent_takeover_message'] || '已為您轉接真人客服，請稍候。我們的客服人員會盡快回覆您！';
      const offHoursMsg = s['live_agent_off_hours_message'] || '真人客服目前休息中，如有問題請先說明，客服看到後會盡快回覆您！';

      // Determine if we are within service hours (Taiwan time, Asia/Taipei)
      let withinHours = true;
      if (hoursStart && hoursEnd) {
        const now = new Date();
        // Get current HH:MM in Asia/Taipei
        const tpTime = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });
        withinHours = tpTime >= hoursStart && tpTime <= hoursEnd;
      }

      const adapter = channelRegistry.get(channelType);
      if (withinHours) {
        // Within service hours: activate live agent and send takeover message
        await liveAgentService.activate(tenantId, userId, convId, `Trigger: "${content}"`);
        if (adapter) {
          await adapter.sendReply(tenantId, platformUserId, [
            { type: 'text', content: takeoverMsg },
          ]);
        }
      } else {
        // Outside service hours: send off-hours message, do NOT activate
        log.info({ tenantId, userId, hoursStart, hoursEnd }, 'Live agent trigger blocked — outside service hours');
        if (adapter) {
          await adapter.sendReply(tenantId, platformUserId, [
            { type: 'text', content: offHoursMsg },
          ]);
        }
      }
      return;
    }

    // 5. Enter message gate (8-second merge)
    const convId = await conversationService.getOrCreateConversation(tenantId, userId, channelType);
    await conversationService.saveMessage(tenantId, convId, 'user', content);

    // Trigger loading animation
    const adapter = channelRegistry.get(channelType);
    if (adapter && adapter.sendLoadingAnimation) {
      adapter.sendLoadingAnimation(tenantId, platformUserId, 20).catch(err => 
        log.error({ err: err.message }, 'Failed to send loading animation')
      );
    }

    // Store channel info for later reply
    const rawEvent = message.rawEvent as any;
    const replyToken = rawEvent?.replyToken;
    this.storeReplyContext(tenantId, userId, channelType, platformUserId, replyToken);

    await this.messageGate.addMessage(tenantId, userId, convId, content);
  }

  /**
   * Called when the 8-second gate flushes a merged batch.
   */
  private async onBatchReady(batch: MergedBatch): Promise<void> {
    const { tenantId, userId, conversationId, mergedContent } = batch;
    const replyCtx = this.getReplyContext(tenantId, userId);

    if (!replyCtx) {
      log.error({ tenantId, userId }, 'No reply context found for batch');
      return;
    }

    try {
      // Get conversation history
      const history = await conversationService.getRecentHistory(tenantId, conversationId, 10);

      // --- Phase 0: Quick order command intercept (admin keyword → create WC order) ---
      const quickReply = await quickOrderService.handleIfCommand(tenantId, mergedContent);
      if (quickReply !== null) {
        const adapter = channelRegistry.get(replyCtx.channelType);
        if (adapter) {
          if (replyCtx.replyToken && adapter.sendReplyWithToken) {
            await adapter.sendReplyWithToken(tenantId, replyCtx.replyToken, [{ type: 'text', content: quickReply }]);
          } else {
            await adapter.sendReply(tenantId, replyCtx.platformUserId, [{ type: 'text', content: quickReply }]);
          }
        }
        // Do not save system intercepts as 'assistant' to prevent AI hallucination
        return;
      }

      // --- Phase 2: Order query intercept (multi-turn stateful flow) ---
      const orderReply = await handleOrderQuery(tenantId, userId, mergedContent);
      if (orderReply !== null) {
        const adapter = channelRegistry.get(replyCtx.channelType);
        if (adapter) {
          if (replyCtx.replyToken && adapter.sendReplyWithToken) {
            await adapter.sendReplyWithToken(tenantId, replyCtx.replyToken, [{ type: 'text', content: orderReply }]);
          } else {
            await adapter.sendReply(tenantId, replyCtx.platformUserId, [{ type: 'text', content: orderReply }]);
          }
        }
        // Do not save system intercepts as 'assistant' to prevent AI hallucination
        return;
      }

      // --- Phase 2: Product search intent — inject results into AI context ---
      let productAiContext = '';

      if (productService.isProductQueryIntent(mergedContent)) {
        const searchKeyword = productService.extractSearchKeyword(mergedContent);
        const products = await productService.searchProducts(tenantId, searchKeyword, 5);
        if (products.length > 0) {
          productAiContext = productService.formatProductsAsAiContext(products);
          log.info({ tenantId, searchKeyword, found: products.length }, 'Product search context injected into AI prompt');

          // Immediately tag the user with the phone model from the best matching product.
          // We do NOT require a two-turn confirmation — the intent is clear enough.
          const bestProduct = products[0];
          const tagFromProduct = taggingService.extractTagFromProduct(
            bestProduct.phone_models || '',
            bestProduct.name,
          );
          if (tagFromProduct) {
            taggingService.saveTags(tenantId, userId, [tagFromProduct], 'ai_detected').catch((err: any) =>
              log.error({ err: err.message }, 'Failed to save phone model tag'),
            );
            log.info({ tenantId, userId, tag: tagFromProduct }, 'Phone model tag saved immediately on product match');
          }
        }
      }

      // --- Phase 2: Knowledge base RAG context enrichment ---
      const kbChunks = await knowledgeBaseService.retrieveContext(tenantId, mergedContent, 3);
      const kbContext = kbChunks.length > 0
        ? `\n\n以下是從知識庫擷取的相關參考資料：\n${kbChunks.map((c, i) => `[${i + 1}] ${c}`).join('\n')}`
        : '';

      // --- Load AI Strict Rules (highest priority — injected ABOVE system prompt) ---
      const { data: strictRulesRaw } = await getSupabaseAdmin()
        .from('tenant_settings')
        .select('value')
        .eq('tenant_id', tenantId)
        .eq('key', 'ai_strict_rules')
        .single();

      let strictRulesBlock = '';
      if (strictRulesRaw?.value) {
        try {
          const rules: string[] = JSON.parse(strictRulesRaw.value);
          if (rules.length > 0) {
            strictRulesBlock = `[ABSOLUTE RULES - NEVER VIOLATE UNDER ANY CIRCUMSTANCES]\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n[END ABSOLUTE RULES]\n\n`;
          }
        } catch {}
      }

      // Get tenant system prompt — strict rules at top, then base prompt, then product context, then KB
      const systemPrompt = strictRulesBlock + await this.getSystemPrompt(tenantId) + productAiContext + kbContext;


      // Build LLM request
      const messages: ChatMessage[] = [
        ...history.slice(0, -1),
        { role: 'user', content: mergedContent },
      ];

      const llmResponse = await llmRouter.call(tenantId, {
        messages,
        systemPrompt,
      });

      // --- Append Bot Footer if configured ---
      const { data: footerSet } = await getSupabaseAdmin()
        .from('tenant_settings')
        .select('value')
        .eq('tenant_id', tenantId)
        .eq('key', 'bot_message_footer')
        .single();
      
      let finalReplyContent = llmResponse.content;
      // Only append the footer if the AI hasn't already included it (prevents double footer)
      if (footerSet?.value && !finalReplyContent.includes(footerSet.value.trim())) {
        finalReplyContent += `\n\n${footerSet.value}`;
      }

      // Save assistant response
      await conversationService.saveMessage(tenantId, conversationId, 'assistant', finalReplyContent, {
        provider: llmResponse.provider,
        model: llmResponse.model,
        usage: llmResponse.usage,
      });

      // Send reply through the channel
      const adapter = channelRegistry.get(replyCtx.channelType);
      if (adapter) {
        if (replyCtx.replyToken && adapter.sendReplyWithToken) {
          await adapter.sendReplyWithToken(tenantId, replyCtx.replyToken, [
            { type: 'text', content: finalReplyContent },
          ]);
        } else {
          await adapter.sendReply(tenantId, replyCtx.platformUserId, [
            { type: 'text', content: finalReplyContent },
          ]);
        }
      }

      log.info({
        tenantId,
        userId,
        provider: llmResponse.provider,
        model: llmResponse.model,
      }, 'Customer reply sent');

    } catch (err: any) {
      log.error({ tenantId, userId, err: err.message }, 'Failed to generate/send reply');

      // Send fallback message
      const adapter = channelRegistry.get(replyCtx.channelType);
      if (adapter) {
        if (replyCtx.replyToken && adapter.sendReplyWithToken) {
          await adapter.sendReplyWithToken(tenantId, replyCtx.replyToken, [
            { type: 'text', content: '抱歉，目前系統忙碌中，請稍後再試或輸入「真人」轉接客服人員。' },
          ]);
        } else {
          await adapter.sendReply(tenantId, replyCtx.platformUserId, [
            { type: 'text', content: '抱歉，目前系統忙碌中，請稍後再試或輸入「真人」轉接客服人員。' },
          ]);
        }
      }
    }
  }

  /**
   * Handle admin messages (command routing).
   */
  private async handleAdminMessage(
    tenantId: string,
    channelType: string,
    platformUserId: string,
    userId: string,
    content: string,
  ): Promise<void> {
    const adapter = channelRegistry.get(channelType as any);
    if (!adapter) return;

    // Check for unlock command
    if (content.startsWith('/unlock ')) {
      const password = content.slice(8).trim();
      if (authService.verifyUnlockPassword(password)) {
        const { expiresAt } = await authService.createElevatedSession(tenantId, channelType as any, platformUserId);
        await adapter.sendReply(tenantId, platformUserId, [
          { type: 'text', content: `🔓 管理員模式已啟用\n到期時間: ${new Date(expiresAt).toLocaleString('zh-TW')}` },
        ]);
        await writeAuditLog({
          tenant_id: tenantId,
          actor_type: 'admin',
          actor_id: platformUserId,
          action: 'admin_unlock',
          target: channelType,
          details_json: { expiresAt },
        });
      } else {
        await adapter.sendReply(tenantId, platformUserId, [
          { type: 'text', content: '❌ 密碼錯誤' },
        ]);
      }
      return;
    }

    // Check elevated session for other commands
    const hasSession = await authService.hasElevatedSession(tenantId, channelType as any, platformUserId);
    if (!hasSession && content.startsWith('/')) {
      await adapter.sendReply(tenantId, platformUserId, [
        { type: 'text', content: '⚠️ 請先使用 /unlock <密碼> 啟用管理員模式' },
      ]);
      return;
    }

    // Parse and handle admin commands
    if (content.startsWith('/')) {
      await this.handleAdminCommand(tenantId, channelType, platformUserId, content);
    } else {
      // Non-command admin message: treat as normal customer interaction
      const convId = await conversationService.getOrCreateConversation(tenantId, userId, channelType);
      await conversationService.saveMessage(tenantId, convId, 'user', content);
      this.storeReplyContext(tenantId, userId, channelType as any, platformUserId);
      await this.messageGate.addMessage(tenantId, userId, convId, content);
    }
  }

  /**
   * Execute admin commands.
   */
  private async handleAdminCommand(
    tenantId: string,
    channelType: string,
    platformUserId: string,
    commandText: string,
  ): Promise<void> {
    const adapter = channelRegistry.get(channelType as any);
    if (!adapter) return;

    const parts = commandText.split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    let result = '';

    switch (cmd) {
      case '/status':
        result = '✅ 系統運行正常';
        break;

      case '/model':
        // Show or switch model
        if (args) {
          result = `🔄 模型切換功能（待完整實作）: ${args}`;
        } else {
          result = '📊 使用 /model <provider:model> 切換模型';
        }
        break;

      case '/live-agents':
        const sessions = await liveAgentService.getActiveSessions(tenantId);
        result = sessions.length
          ? `📋 進行中真人客服: ${sessions.length} 位\n` +
            sessions.map((s: any) => `- ${s.users?.display_name || s.user_id} (${s.reason})`).join('\n')
          : '✅ 目前無進行中的真人客服';
        break;

      case '/help':
        result = [
          '📖 管理員指令:',
          '/unlock <密碼> - 啟用管理員模式',
          '/status - 系統狀態',
          '/model [provider:model] - 查看/切換模型',
          '/live-agents - 真人客服列表',
          '/help - 指令列表',
        ].join('\n');
        break;

      default:
        result = `❓ 未知指令: ${cmd}\n使用 /help 查看可用指令`;
    }

    // Log command
    const db = getSupabaseAdmin();
    await db.from('admin_commands_log').insert({
      tenant_id: tenantId,
      admin_user_id: platformUserId,
      command: cmd,
      params_json: { args },
      result_json: { result },
    });

    await adapter.sendReply(tenantId, platformUserId, [
      { type: 'text', content: result },
    ]);
  }

  /**
   * Get the system prompt for a tenant.
   */
  private async getSystemPrompt(tenantId: string): Promise<string> {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from('tenant_prompt_configs')
      .select('content')
      .eq('tenant_id', tenantId)
      .eq('prompt_type', 'system')
      .order('version', { ascending: false })
      .limit(1)
      .single();

    if (data) return data.content;

    // Default system prompt
    return `你是 PPBears 的 AI 客服助手。
你只能回答與 PPBears 品牌、產品、訂單、客製化手機殼、售後服務相關的問題。
如果客戶問了與 PPBears 無關的問題，請禮貌地引導客戶回到 PPBears 相關話題。
如果需要反問客戶或讓客戶選擇，請以換行條列式清單呈現（例如：1. 選項A \\n 2. 選項B），且每一個選項自成一行。
不要編造產品、價格、庫存或促銷活動。
如果不確定，請建議客戶聯繫真人客服（輸入「真人」）。
回答請使用繁體中文，語氣友善專業。`;
  }

  // ---- Reply Context Cache (in-memory for simplicity) ----
  private replyContextMap = new Map<string, { channelType: any; platformUserId: string; replyToken?: string }>();

  private storeReplyContext(tenantId: string, userId: string, channelType: any, platformUserId: string, replyToken?: string) {
    this.replyContextMap.set(`${tenantId}:${userId}`, { channelType, platformUserId, replyToken });
  }

  private getReplyContext(tenantId: string, userId: string) {
    return this.replyContextMap.get(`${tenantId}:${userId}`);
  }

  /**
   * Graceful shutdown.
   */
  shutdown() {
    this.messageGate.shutdown();
  }
}

export const orchestrator = new Orchestrator();
