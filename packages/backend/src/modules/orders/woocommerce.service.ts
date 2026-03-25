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
      const url = `${creds.baseUrl}/wp-json/wc/v3/orders?number=${encodeURIComponent(orderNumber)}&${this.buildAuthQuery(creds.consumerKey, creds.consumerSecret)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`WC API error: ${res.status}`);
      const orders = await res.json() as WooOrder[];
      return orders[0] || null;
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
    const items = order.line_items.map(i => `・${i.name} x${i.quantity}`).join('\n');
    const name = `${order.billing.last_name}${order.billing.first_name}`;
    const date = new Date(order.date_created).toLocaleDateString('zh-TW');

    return [
      `📦 訂單 #${order.number}`,
      `狀態：${status}`,
      `下單日期：${date}`,
      `訂購人：${name}`,
      ``,
      `商品：`,
      items,
      ``,
      `總金額：${order.currency} ${order.total}`,
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
