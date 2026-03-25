import { wooCommerceService, WooOrder } from './woocommerce.service.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger({ module: 'OrderQuery' });

// Conversation state for multi-turn order lookup
interface OrderQueryState {
  step: 'ask_verifier' | 'done';
  pendingOrderNumber: string;
  attempts: number;
}

const stateMap = new Map<string, OrderQueryState>();

function getStateKey(tenantId: string, userId: string) {
  return `${tenantId}:${userId}`;
}

/**
 * Determine if the message contains an order number.
 * Detects patterns like: 訂單133495 / 訂單#133495 / #133495 / Order 133495
 */
function extractOrderNumber(text: string): string | null {
  // Match: keyword + number OR just #number with 4+ digits
  const patterns = [
    /(?:訂單|單號|order)[^\d]*#?(\d{4,})/i,  // 訂單 #12345
    /#(\d{4,})/,                                // #12345 standalone
    /^(\d{4,})$/,                               // pure number 12345
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Determine if the message is requesting an order lookup.
 */
export function isOrderQueryIntent(text: string): boolean {
  const keywords = ['查訂單', '查單', '我的訂單', '訂單狀態', '訂單查詢', '查看訂單', '我的包裹', '包裹', '運送', '出貨', '物流'];
  const lowered = text.toLowerCase();
  if (keywords.some(kw => lowered.includes(kw))) return true;
  // Also trigger if message directly contains an order number
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

  // Starting fresh query — user provides order number directly
  const orderNum = extractOrderNumber(text);

  if (!state && orderNum) {
    stateMap.set(key, { step: 'ask_verifier', pendingOrderNumber: orderNum, attempts: 0 });
    return `收到您的訂單查詢（訂單 #${orderNum}）🔍\n\n為了保護您的個資安全，請再提供以下任一項核對資料：\n1. 下單姓名\n2. 下單電話號碼\n\n（兩者符合其中一項即可查詢）`;
  }

  if (!state && isOrderQueryIntent(text)) {
    return '請提供您的訂單編號（例如：訂單 #1234），我將協助您查詢訂單狀態。';
  }

  if (!state) return null;

  // Step: Verify identity via name or phone
  if (state.step === 'ask_verifier') {
    const { pendingOrderNumber } = state;

    // Fetch order from WooCommerce
    const order = await wooCommerceService.findOrderByNumber(tenantId, pendingOrderNumber);

    if (!order) {
      stateMap.delete(key);
      await wooCommerceService.logLookup(tenantId, userId, pendingOrderNumber, 'order_number', false);
      return `很抱歉，查無訂單 #${pendingOrderNumber} 的相關資料。\n請確認訂單編號是否正確，或輸入「真人」轉接真人客服。`;
    }

    // Verify against name or phone
    const fullName = `${order.billing.last_name}${order.billing.first_name}`;
    const phone = order.billing.phone?.replace(/[^0-9]/g, '') || '';
    const inputPhone = text.replace(/[^0-9]/g, '');
    const inputText = text.trim();

    const nameMatch = fullName.includes(inputText) || inputText.includes(fullName.slice(-2));
    const phoneMatch = phone.length > 0 && inputPhone.length >= 8 && phone.includes(inputPhone);

    if (nameMatch || phoneMatch) {
      stateMap.delete(key);
      await wooCommerceService.logLookup(tenantId, userId, pendingOrderNumber, 'order_number', true);
      return wooCommerceService.formatOrderSummary(order);
    } else {
      state.attempts++;
      if (state.attempts >= 3) {
        stateMap.delete(key);
        return '驗證失敗次數過多，查詢已取消。\n如需協助請輸入「真人」轉接客服人員。';
      }
      return `核對失敗，請再試一次。\n請輸入下單時的姓名或電話號碼（還有 ${3 - state.attempts} 次機會）：`;
    }
  }

  return null;
}

/**
 * Clear order query state when conversation resets.
 */
export function clearOrderQueryState(tenantId: string, userId: string) {
  stateMap.delete(getStateKey(tenantId, userId));
}
