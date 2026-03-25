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
  pending: '待付款',
  processing: '處理中',
  on_hold: '保留',
  completed: '已完成',
  cancelled: '已取消',
  refunded: '已退款',
  failed: '失敗',
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
      // WooCommerce REST API does not support ?number= natively.
      // Use search param and then confirm match by order.number field.
      const url = `${creds.baseUrl}/wp-json/wc/v3/orders?search=${encodeURIComponent(orderNumber)}&per_page=10&${this.buildAuthQuery(creds.consumerKey, creds.consumerSecret)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const errBody = await res.text();
        log.error({ tenantId, status: res.status, errBody }, 'WooCommerce findOrderByNumber HTTP error');
        throw new Error(`WC API error: ${res.status}`);
      }
      const orders = await res.json() as WooOrder[];
      // Match by order.number (string) or order.id (number)
      const matched = orders.find(o =>
        String(o.number) === String(orderNumber) || String(o.id) === String(orderNumber)
      );
      return matched || null;
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
   */
  formatOrderSummary(order: WooOrder): string {
    const status = STATUS_MAP[order.status] || order.status;
    const name = `${order.billing.last_name}${order.billing.first_name}`;
    const date = new Date(order.date_created).toLocaleDateString('zh-TW');
    const items = order.line_items.map(i => `・${i.name} x${i.quantity}`).join('\n');

    // Parse meta_data for logistics info
    const getMeta = (key: string) => order.meta_data?.find(m => m.key === key)?.value || '';
    const trackingNumber = getMeta('tracking_number') || getMeta('_tracking_number') || getMeta('wcfm_tracking_no');
    const shippingMethod = order.shipping_lines?.[0]?.method_title || getMeta('_shipping_method_title') || '未設定';
    const pickupStore = getMeta('pickup_store') || getMeta('_ecpay_logistics_store_name') || getMeta('_store_name') || getMeta('st_pickup_store');
    const paymentMethod = order.payment_method_title || getMeta('_payment_method_title') || '未設定';
    const isPaid = order.date_paid ? '已付款成功' : '尚未付款';

    const lines = [
      `📦 訂單 #${order.number} 查詢結果`,
      ``,
      `1) 訂單狀態：${status}（${order.status}）`,
      `2) 出貨/物流：${trackingNumber ? `物流單號 ${trackingNumber}` : '目前尚未出貨，還沒有物流單號'}`,
      `3) 配送方式：${shippingMethod}`,
    ];

    if (pickupStore) {
      lines.push(`4) 取貨門市：${pickupStore}`);
      lines.push(`5) 付款方式／付款狀態：${paymentMethod}，${isPaid}`);
    } else {
      const addr = [order.shipping.city, order.shipping.address_1].filter(Boolean).join(' ') || '未設定';
      lines.push(`4) 配送地址：${addr}`);
      lines.push(`5) 付款方式／付款狀態：${paymentMethod}，${isPaid}`);
    }

    lines.push('');
    lines.push(`下單日期：${date}`);
    lines.push(`訂購人：${name}`);
    lines.push(`商品：\n${items}`);
    lines.push(`總金額：${order.currency} ${order.total}`);

    return lines.join('\n');
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
