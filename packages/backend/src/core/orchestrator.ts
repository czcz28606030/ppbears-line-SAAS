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

    // 4. Load live agent settings from tenant_settings
    const db = getSupabaseAdmin();
    const { data: settingsRows } = await db
      .from('tenant_settings')
      .select('key, value')
      .eq('tenant_id', tenantId)
      .in('key', ['live_agent_hours_start', 'live_agent_hours_end', 'live_agent_takeover_message', 'live_agent_off_hours_message', 'takeover_keywords']);

    const s: Record<string, string> = {};
    for (const r of settingsRows || []) if (r.key && r.value) s[r.key] = r.value;

    const hoursStart = s['live_agent_hours_start'] || '';
    const hoursEnd   = s['live_agent_hours_end'] || '';
    const takeoverMsg = s['live_agent_takeover_message'] || '已為您轉接真人客服，請稍候。我們的客服人員會盡快回覆您！';
    const offHoursMsg = s['live_agent_off_hours_message'] || '真人客服目前休息中，如有問題請先說明，客服看到後會盡快回覆您！';
    // Default keywords if none configured
    const defaultKeywords = ['真人', '轉真人', '我要找客服', '有人嗎', '客服處理'];
    const customKeywords = s['takeover_keywords'] ? s['takeover_keywords'].split(',').map(k => k.trim()).filter(Boolean) : defaultKeywords;
    const triggerPhrases = customKeywords.length > 0 ? customKeywords : defaultKeywords;

    // Check for live agent trigger phrases
    if (liveAgentService.isTriggerPhrase(content, triggerPhrases)) {
      const convId = await conversationService.getOrCreateConversation(tenantId, userId, channelType);
      await conversationService.saveMessage(tenantId, convId, 'user', content);

      // Determine if we are within service hours (Taiwan time, Asia/Taipei)
      let withinHours = true;
      if (hoursStart && hoursEnd) {
        const now = new Date();
        // Get current HH:MM in Asia/Taipei
        const tpTime = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });
        withinHours = tpTime >= hoursStart && tpTime <= hoursEnd;
      }

      const adapter = channelRegistry.get(channelType);
      // Extract replyToken from raw event (prefer Reply API over Push API)
      const triggerRawEvent = message.rawEvent as any;
      const triggerReplyToken = triggerRawEvent?.replyToken;

      const sendTriggerReply = async (replyContent: string) => {
        if (!adapter) return;
        if (triggerReplyToken && adapter.sendReplyWithToken) {
          await adapter.sendReplyWithToken(tenantId, triggerReplyToken, [{ type: 'text', content: replyContent }]);
        } else {
          await adapter.sendReply(tenantId, platformUserId, [{ type: 'text', content: replyContent }]);
        }
      };

      if (withinHours) {
        // Within service hours: activate live agent and send takeover message
        await liveAgentService.activate(tenantId, userId, convId, `Trigger: "${content}"`);
        await sendTriggerReply(takeoverMsg);
      } else {
        // Outside service hours: send off-hours message, do NOT activate
        log.info({ tenantId, userId, hoursStart, hoursEnd }, 'Live agent trigger blocked — outside service hours');
        await sendTriggerReply(offHoursMsg);
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
      let isProductIntent = false;

      // ── Confirmation-word inheritance ─────────────────────────────────────────
      // If the customer sends a short confirmation ("是的", "確認", "ok", "對" …)
      // after the AI asked "您是指 XXX 嗎？", we must re-run the product search
      // using the PREVIOUS user product query so we can give them the actual link.
      const CONFIRMATION_WORDS = [
        '是', '對', '確認', '好', '是的', '對的', '沒錯', 'yes', 'ok', 'OK',
        '正確', '是啊', '對啊', '嗯', '嗯嗯', '好的', '我要', '要',
      ];
      const looksLikeConfirmation = (text: string) => {
        const clean = text.trim();
        return clean.length <= 20 && CONFIRMATION_WORDS.some(w => clean.includes(w));
      };

      let effectiveSearch = mergedContent; // what we actually search for
      let searchInherited = false;

      if (!productService.isProductQueryIntent(mergedContent) && looksLikeConfirmation(mergedContent)) {
        // Walk back through history to find the most recent user message that was a product query
        const recentHistory = history.slice(0, -1); // exclude current message
        const prevProductMsg = [...recentHistory].reverse().find(
          m => m.role === 'user' && productService.isProductQueryIntent(m.content)
        );
        if (prevProductMsg) {
          isProductIntent = true;
          effectiveSearch = prevProductMsg.content;
          searchInherited = true;
          log.info({ tenantId, inherited: effectiveSearch }, 'Confirmation detected — inheriting previous product query');
        }
      }

      if (!isProductIntent && productService.isProductQueryIntent(mergedContent)) {
        isProductIntent = true;
      }

      if (isProductIntent) {
        let rawSearch = searchInherited ? effectiveSearch : mergedContent;

        // If the current message is very short (e.g., just "apple"), it might be a reply to a clarifying question.
        // We prepend the previous user message from history to provide full context (e.g., "17" + "apple").
        if (!searchInherited && mergedContent.length < 15) {
          const prevUserMessage = [...history.slice(0, -1)].reverse().find(m => m.role === 'user');
          if (prevUserMessage) {
            rawSearch = `${prevUserMessage.content} ${mergedContent}`;
          }
        }
        
        const searchKeyword = productService.extractSearchKeyword(rawSearch);
        const products = await productService.searchProducts(tenantId, searchKeyword, 5);
        if (products.length > 0) {
          productAiContext = productService.formatProductsAsAiContext(products);

          // If formatProductsAsAiContext returned empty (all products had invalid/empty URLs),
          // fall through to the not-found guard below
          if (!productAiContext) {
            productAiContext = `\n\n[產品索引搜尋結果] 找到相關商品但連結資料異常，無法提供直接連結。` +
              `請告知客戶：「抱歉，目前此型號商品的連結暫時無法取得，建議您輸入「真人」讓客服專員直接為您服務！」` +
              `【嚴格禁止】不得提供任何 URL 連結。`;
            log.warn({ tenantId, searchKeyword, found: products.length }, 'Products found but all URLs invalid');
          } else {
            log.info({ tenantId, searchKeyword, found: products.length }, 'Product search context injected into AI prompt');
            // Tag the user with the best matching product's phone model
            const bestProduct = products[0];
            const tagFromProduct = taggingService.extractTagFromProduct(
              bestProduct.phone_models || '',
              bestProduct.name,
            );
            if (tagFromProduct) {
              taggingService.saveTags(tenantId, userId, [tagFromProduct], 'ai_detected').catch((err: any) =>
                log.error({ err: err.message }, 'Failed to save phone model tag'),
              );
              log.info({ tenantId, userId, tag: tagFromProduct }, 'Phone model tag saved');
            }
          }
        } else {
          // Product intent detected but NOTHING found in index.
          productAiContext = `\n\n[產品索引搜尋結果] 在產品索引中暫時找不到符合「${searchKeyword}」的商品。` +
            `【非常重要 - 嚴格遵守下列規則】\n` +
            `1. 絕對禁止說「我們只做某某品牌的手機殼」或「我們目前專注於XX手機殼」等品牌限定語句。PPBears 提供多品牌客製化手機殼服務，系統索引暫時找不到不代表沒有此商品。\n` +
            `2. 必須直接回覆：「您好！關於您的 ${searchKeyword} 手機殼需求，請輸入「真人」讓客服專員直接為您確認並提供商品連結！」\n` +
            `3. 不得提供任何 URL 連結，不得叫客戶「自行上網查找」。`;
          log.info({ tenantId, searchKeyword }, 'Product intent but no results — injecting not-found guard');
        }
      }

      // --- Phase 2: Knowledge base RAG context enrichment ---
      // IMPORTANT: When the query is a product intent, skip KB entirely.
      // KB documents may contain generic search URLs (e.g. /searchcase/) that the AI would use
      // as a fallback instead of the product index — causing wrong/un-clickable links.
      let kbContext = '';
      if (!isProductIntent) {
        const kbChunks = await knowledgeBaseService.retrieveContext(tenantId, mergedContent, 3);
        kbContext = kbChunks.length > 0
          ? `\n\n[知識庫參考資料 - 僅供參考，勿直接複製格式]\n${kbChunks.map((c, i) => `[${i + 1}] ${c}`).join('\n')}\n[注意] 若上述參考資料中含有 URL 連結，請以純文字格式引用，不得輸出 [[url]] 或雙括號巢狀格式。`
          : '';
      }

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
