import { wooCommerceService, WooOrder } from './woocommerce.service.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger({ module: 'OrderQuery' });

// Conversation state for multi-turn order lookup
interface OrderQueryState {
  step: 'ask_identifier' | 'verify_identity' | 'done';
  pendingOrder?: WooOrder;
  attempts: number;
}

const stateMap = new Map<string, OrderQueryState>();

function getStateKey(tenantId: string, userId: string) {
  return `${tenantId}:${userId}`;
}

/**
 * Determine if the message is requesting an order lookup.
 */
export function isOrderQueryIntent(text: string): boolean {
  const keywords = ['查訂單', '查單', '我的訂單', '訂單狀態', '訂單查詢', '查看訂單', '我的包裹', '包裹', '運送', '出貨'];
  const lowered = text.toLowerCase();
  return keywords.some(kw => lowered.includes(kw));
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

  // Starting fresh query
  if (!state && isOrderQueryIntent(text)) {
    stateMap.set(key, { step: 'ask_identifier', attempts: 0 });
    return '我來幫您查詢訂單 📦\n\n請提供以下任一資訊：\n・訂單編號（例如：#1234）\n・購買時的電子信箱\n・購買時的手機號碼';
  }

  if (!state) return null;

  // Step 1: User provides order identifier
  if (state.step === 'ask_identifier') {
    const orderNumMatch = text.match(/#?(\d{3,})/);
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const phoneMatch = text.match(/09\d{8}/);

    let order: WooOrder | null = null;
    let lookupKey = '';
    let lookupType = '';

    if (orderNumMatch) {
      lookupKey = orderNumMatch[1];
      lookupType = 'order_number';
      order = await wooCommerceService.findOrderByNumber(tenantId, lookupKey);
    } else if (emailMatch) {
      lookupKey = emailMatch[0];
      lookupType = 'email';
      const orders = await wooCommerceService.findOrdersByContact(tenantId, lookupKey);
      order = orders[0] || null;
    } else if (phoneMatch) {
      lookupKey = phoneMatch[0];
      lookupType = 'phone';
      const orders = await wooCommerceService.findOrdersByContact(tenantId, lookupKey);
      order = orders[0] || null;
    } else {
      state.attempts++;
      if (state.attempts >= 3) {
        stateMap.delete(key);
        return '找不到符合的訂單資料。如需協助請輸入「真人」轉接客服人員。';
      }
      return '請提供訂單編號（例如：#1234）、電子信箱或手機號碼。';
    }

    await wooCommerceService.logLookup(tenantId, userId, lookupKey, lookupType, !!order);

    if (!order) {
      stateMap.delete(key);
      return '查無相符的訂單，請確認資訊是否正確。如需協助請輸入「真人」轉接客服人員。';
    }

    // For security, require one verification before showing full details
    state.step = 'verify_identity';
    state.pendingOrder = order;

    const name = `${order.billing.last_name}${order.billing.first_name}`;
    return `找到一筆訂單（訂購人：${name.substring(0, 1)}**）\n\n為了保護您的個資，請再確認購買者的姓名後兩個字：`;
  }

  // Step 2: Verify identity
  if (state.step === 'verify_identity' && state.pendingOrder) {
    const order = state.pendingOrder;
    const name = `${order.billing.last_name}${order.billing.first_name}`;
    const lastTwo = name.slice(-2);
    const userInput = text.trim();

    if (userInput.includes(lastTwo) || name.includes(text.trim())) {
      stateMap.delete(key);
      return wooCommerceService.formatOrderSummary(order);
    } else {
      state.attempts++;
      if (state.attempts >= 3) {
        stateMap.delete(key);
        return '驗證失敗次數過多，查詢已取消。如需協助請輸入「真人」轉接客服人員。';
      }
      return '姓名不符，請再試一次（請輸入購買者姓名後兩個字）：';
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
