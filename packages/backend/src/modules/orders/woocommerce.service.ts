import { getSupabaseAdmin } from '../../utils/supabase.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger({ module: 'WooCommerce' });

export interface WooOrder {
  id: number;
  number: string;
  status: string;
  date_created: string;
  total: string;
  currency: string;
  billing: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
  };
  shipping: {
    first_name: string;
    last_name: string;
    address_1: string;
    city: string;
    state: string;
    postcode: string;
  };
  line_items: Array<{
    name: string;
    quantity: number;
    total: string;
  }>;
  shipping_lines: Array<{
    method_title: string;
    method_id: string;
  }>;
  payment_method_title: string;
  date_paid: string | null;
  meta_data: Array<{ key: string; value: any }>;
}

const STATUS_MAP: Record<string, string> = {
  // Standard WooCommerce statuses
  pending:    '待付款',
  processing: '處理中',
  on_hold:    '保留',
  completed:  '已完成',
  cancelled:  '已取消',
  refunded:   '已退款',
  failed:     '失敗',
  // PPBears custom statuses (add more as needed)
  'wc-printing':    '印刷中',
  'printing':       '印刷中',
  'wc-production':  '生產中',
  'production':     '生產中',
  'wc-shipped':     '已出貨',
  'shipped':        '已出貨',
  'wc-custom-status': '已進入生產流程',
  'custom-status':    '已進入生產流程',
};

export class WooCommerceService {
  /**
   * Get base credentials from tenant settings or env fallback.
   */
  private async getCredentials(tenantId: string): Promise<{
    baseUrl: string;
    consumerKey: string;
    consumerSecret: string;
  } | null> {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from('tenant_settings')
      .select('key, value')
      .eq('tenant_id', tenantId)
      .in('key', ['woo_base_url', 'woo_consumer_key', 'woo_consumer_secret']);

    const settings: Record<string, string> = {};
    if (data) {
      for (const row of data) {
        if (row.key && row.value) settings[row.key] = row.value;
      }
    }

    const baseUrl = settings['woo_base_url'] || process.env.WOO_BASE_URL;
    const consumerKey = settings['woo_consumer_key'] || process.env.WOO_CONSUMER_KEY;
    const consumerSecret = settings['woo_consumer_secret'] || process.env.WOO_CONSUMER_SECRET;

    if (!baseUrl || !consumerKey || !consumerSecret) return null;
    return { baseUrl, consumerKey, consumerSecret };
  }

  private buildAuthQuery(key: string, secret: string): string {
    return `consumer_key=${key}&consumer_secret=${secret}`;
  }

  /**
   * Search order by order number.
   */
  async findOrderByNumber(tenantId: string, orderNumber: string): Promise<WooOrder | null> {
    const creds = await this.getCredentials(tenantId);
    if (!creds) {
      log.warn({ tenantId }, 'WooCommerce credentials not configured');
      return null;
    }

    try {
      // Approach 1: Try fetching directly by ID (which is the most common case for WC order numbers)
      const directUrl = `${creds.baseUrl}/wp-json/wc/v3/orders/${encodeURIComponent(orderNumber)}?${this.buildAuthQuery(creds.consumerKey, creds.consumerSecret)}`;
      const directRes = await fetch(directUrl);
      
      if (directRes.ok) {
        const order = await directRes.json() as WooOrder;
        log.info({ tenantId, orderNumber }, 'Found order directly by ID');
        return order;
      }

      // Approach 2: If direct ID fetch fails, fallback to search (for custom order numbers)
      log.info({ tenantId, orderNumber, status: directRes.status }, 'Direct ID fetch failed, trying search fallback');
      const searchUrl = `${creds.baseUrl}/wp-json/wc/v3/orders?search=${encodeURIComponent(orderNumber)}&per_page=10&${this.buildAuthQuery(creds.consumerKey, creds.consumerSecret)}`;
      const searchRes = await fetch(searchUrl);
      
      if (!searchRes.ok) {
        throw new Error(`WC API search error: ${searchRes.status}`);
      }
      
      const orders = await searchRes.json() as WooOrder[];
      const matched = orders.find(o =>
        String(o.number) === String(orderNumber) || String(o.id) === String(orderNumber)
      );
      
      if (matched) {
        log.info({ tenantId, orderNumber }, 'Found order via search fallback');
        return matched;
      }

      log.warn({ tenantId, orderNumber }, 'Order not found in WooCommerce');
      return null;
    } catch (err: any) {
      log.error({ tenantId, err: err.message }, 'WooCommerce findOrderByNumber failed');
      return null;
    }
  }

  /**
   * Search orders by phone or email.
   */
  async findOrdersByContact(tenantId: string, contact: string): Promise<WooOrder[]> {
    const creds = await this.getCredentials(tenantId);
    if (!creds) return [];

    try {
      const url = `${creds.baseUrl}/wp-json/wc/v3/orders?search=${encodeURIComponent(contact)}&per_page=5&${this.buildAuthQuery(creds.consumerKey, creds.consumerSecret)}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      return await res.json() as WooOrder[];
    } catch (err: any) {
      log.error({ tenantId, err: err.message }, 'WooCommerce findOrdersByContact failed');
      return [];
    }
  }

  /**
   * Format an order into a user-friendly text message.
   * Fields: 最晚出貨日期, 訂單狀態, 出貨/物流, 付款方式/付款狀態, 商品需求縮減版
   * PPBears meta keys sourced from class-ppbears-admin.php
   */
  formatOrderSummary(order: WooOrder): string {
    const status = STATUS_MAP[order.status] || order.status;

    const getMeta = (key: string) => order.meta_data?.find(m => m.key === key)?.value || '';

    // 1) 最晚出貨日期 — saved as _ppbears_latest_ship_by (YYYY-MM-DD)
    const rawShipDate = getMeta('_ppbears_latest_ship_by');
    const latestShipDate = rawShipDate || '（未填寫）';

    // 2) 訂單狀態 — only show raw slug in brackets when there is no Chinese mapping
    const hasCnMapping = order.status in STATUS_MAP || `wc-${order.status}` in STATUS_MAP;
    const statusLine = hasCnMapping ? status : `${status}（${order.status}）`;

    // 3) 出貨/物流 — YITH WooCommerce Order Tracking Premium
    //    Meta keys: ywot_tracking_code, ywot_carrier_id, ywot_pick_up_date
    let shippingLine = '目前尚未出貨，還沒有物流單號';

    const trackingCode  = getMeta('ywot_tracking_code');
    const carrierId     = getMeta('ywot_carrier_id') || getMeta('ywot_carrier_name');
    const pickUpDate    = getMeta('ywot_pick_up_date');

    if (trackingCode) {
      shippingLine = [
        `物流單號：${trackingCode}`,
        carrierId  ? `貨運商：${carrierId}`        : '',
        pickUpDate ? `取件日期：${pickUpDate}`     : '',
      ].filter(Boolean).join('　');
    }

    // 4) 付款方式／付款狀態
    const paymentMethod = order.payment_method_title || getMeta('_payment_method_title') || '未設定';
    const isPaid = order.date_paid ? '已付款成功' : '尚未付款';
    const paymentLine = `${paymentMethod}，${isPaid}`;

    // 5) 商品需求縮減版 — saved as _ppbears_requirements_short by PPBears plugin
    //    Falls back to line item names if the field hasn't been filled in yet
    const requirementsShort = getMeta('_ppbears_requirements_short');
    const productSummary = requirementsShort ||
      order.line_items.map(i => `・${i.name} x${i.quantity}`).join('\n');

    return [
      `📦 訂單 #${order.number} 查詢結果`,
      ``,
      `1) 最晚出貨日期：${latestShipDate}`,
      `2) 訂單狀態：${statusLine}`,
      `3) 出貨/物流：${shippingLine}`,
      `4) 付款方式／付款狀態：${paymentLine}`,
      `5) 商品需求縮減版：\n${productSummary}`,
    ].join('\n');
  }

  /**
   * Log a lookup to order_lookup_logs table.
   */
  async logLookup(tenantId: string, userId: string | null, lookupKey: string, lookupType: string, success: boolean) {
    const db = getSupabaseAdmin();
    await db.from('order_lookup_logs').insert({
      tenant_id: tenantId,
      user_id: userId,
      lookup_key: lookupKey,
      lookup_type: lookupType,
      success,
    });
  }
}

export const wooCommerceService = new WooCommerceService();
