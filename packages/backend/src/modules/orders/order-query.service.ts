import { wooCommerceService, WooOrder } from './woocommerce.service.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger({ module: 'OrderQuery' });

// Conversation state for multi-turn order lookup
interface OrderQueryState {
  step: 'ask_verifier' | 'done';
  pendingOrderNumber: string;
  cachedOrder: WooOrder;   // ✅ Store order immediately so we don't re-query
  attempts: number;
}

const stateMap = new Map<string, OrderQueryState>();

function getStateKey(tenantId: string, userId: string) {
  return `${tenantId}:${userId}`;
}

/**
 * Determine if the message contains an order number.
 * Strictly matches order patterns only — avoids matching phone numbers.
 */
function extractOrderNumber(text: string): string | null {
  const trimmed = text.trim();

  // Pattern 1: keyword + optional # + 4+ digits (e.g. "訂單 #133731" or "訂單133731")
  const keywordMatch = trimmed.match(/(?:訂單|單號|order)[^\d]*#?(\d{4,})/i);
  if (keywordMatch) return keywordMatch[1];

  // Pattern 2: starts with # followed by 4+ digits (e.g. "#133731 楊欽雅" — pick the first group)
  const hashMatch = trimmed.match(/#(\d{4,})/);
  if (hashMatch) return hashMatch[1];

  return null; // ❌ Do NOT match bare 10-digit numbers to avoid mistaking phone numbers
}

/**
 * Determine if the message is requesting an order lookup.
 */
export function isOrderQueryIntent(text: string): boolean {
  const keywords = ['查訂單', '查單', '我的訂單', '訂單狀態', '訂單查詢', '查看訂單', '我的包裹', '包裹', '運送', '出貨', '物流'];
  const lowered = text.toLowerCase();
  if (keywords.some(kw => lowered.includes(kw))) return true;
  if (extractOrderNumber(text)) return true;
  return false;
}

/**
 * Handle order lookup conversation flow.
 * Returns a reply string if handled, null if not applicable.
 */
export async function handleOrderQuery(
  tenantId: string,
  userId: string,
  text: string,
): Promise<string | null> {
  const key = getStateKey(tenantId, userId);
  let state = stateMap.get(key);

  // ── Step 0: User provides order number (NO active state) ──────────────────
  if (!state) {
    const orderNum = extractOrderNumber(text);

    if (!orderNum) {
      // Check generic keywords without a number
      if (isOrderQueryIntent(text)) {
        return '請提供您的訂單編號（例如：訂單 #1234），我將協助您查詢訂單狀態。';
      }
      return null; // Not an order query
    }

    // ✅ Immediately fetch the order and cache it
    const order = await wooCommerceService.findOrderByNumber(tenantId, orderNum);
    await wooCommerceService.logLookup(tenantId, userId, orderNum, 'order_number', !!order);

    if (!order) {
      log.warn({ tenantId, userId, orderNum }, 'Order not found in WooCommerce');
      return `很抱歉，查無訂單 #${orderNum} 的相關資料。\n請確認訂單編號是否正確，或輸入「真人」轉接真人客服。`;
    }

    // Store the fetched order object in state so verification step doesn't need to re-query
    stateMap.set(key, {
      step: 'ask_verifier',
      pendingOrderNumber: orderNum,
      cachedOrder: order,
      attempts: 0,
    });

    return `收到您的訂單查詢（訂單 #${orderNum}）🔍\n\n為了保護您的個資安全，請再提供以下任一項核對資料：\n1. 下單姓名\n2. 下單電話號碼\n\n（兩者符合其中一項即可查詢）`;
  }

  // ── Step 1: Verify identity using cached order ──────────────────────────────
  if (state.step === 'ask_verifier') {
    const { pendingOrderNumber, cachedOrder: order } = state;

    const billing = order.billing;
    const fullName = `${billing.last_name}${billing.first_name}`;
    // Normalize phone — strip all non-digit characters
    const phone = (billing.phone || '').replace(/[^0-9]/g, '');
    const inputPhone = text.replace(/[^0-9]/g, '');
    const inputText = text.trim();

    // Name match: input equals or is contained in the full name (or matches last 2 chars)
    const nameMatch = fullName.includes(inputText) || inputText.includes(fullName.slice(-2));
    // Phone match: cleaned inputs must be at least 8 digits and one contains the other
    const phoneMatch = phone.length >= 8 && inputPhone.length >= 8 &&
      (phone.includes(inputPhone) || inputPhone.includes(phone));

    if (nameMatch || phoneMatch) {
      stateMap.delete(key);
      log.info({ tenantId, userId, pendingOrderNumber }, 'Order query verified successfully');
      return wooCommerceService.formatOrderSummary(order);
    }

    state.attempts++;
    const remaining = 3 - state.attempts;
    if (remaining <= 0) {
      stateMap.delete(key);
      return '驗證失敗次數過多，查詢已取消。\n如需協助請輸入「真人」轉接客服人員。';
    }

    return `核對失敗，請再試一次。\n請輸入下單時的姓名或電話號碼（還有 ${remaining} 次機會）：`;
  }

  return null;
}

/**
 * Clear order query state when conversation resets.
 */
export function clearOrderQueryState(tenantId: string, userId: string) {
  stateMap.delete(getStateKey(tenantId, userId));
}
