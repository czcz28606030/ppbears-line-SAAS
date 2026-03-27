import { getSupabaseAdmin } from '../../utils/supabase.js';
import { createLogger } from '../../utils/logger.js';
import { wooRequest } from '../../utils/woo-request.js';

const log = createLogger({ module: 'QuickOrder' });

// Default reply template — {name} and {product_url} are the key placeholders.
// 訂單ID is intentionally blank (customer generates their own order at checkout).
const DEFAULT_TEMPLATE = `哈囉～{name}您好😊
這是您的專屬下單頁面：

🔹 訂單ID（商品編號）：{order_number}
🔹 商品連結：{product_url}

【下單步驟】
1) 點上方商品連結進入頁面
2) 加入購物車後前往結帳
3) 填寫收件資料並完成付款
4) 付款後請主動用 LINE 回傳「訂單編號＋付款資訊」給我們確認

【訂製商品注意事項】
1) 訂製商品皆為「先付款，後製作」
2) 付款完成後才會安排設計與出圖流程
3) 訂製商品屬客製化內容，售出後恕不退貨退款
4) 下單付款前，請先確認可接受作品風格（可先參考作品集）
—`;

interface QuickOrderSettings {
  keyword: string;
  templateProductId: string;  // WooCommerce product to duplicate (e.g. 85525)
  replyTemplate: string;
  wooBaseUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

export class QuickOrderService {
  /** Load quick order settings from tenant_settings. */
  private async getSettings(tenantId: string): Promise<QuickOrderSettings | null> {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from('tenant_settings')
      .select('key, value')
      .eq('tenant_id', tenantId)
      .in('key', [
        'quick_order_keyword',
        'quick_order_product_id',
        'quick_order_reply_template',
        'woo_base_url',
        'woo_consumer_key',
        'woo_consumer_secret',
      ]);

    const s: Record<string, string> = {};
    for (const row of data || []) if (row.key && row.value) s[row.key] = row.value;

    const wooBaseUrl     = s['woo_base_url'];
    const consumerKey    = s['woo_consumer_key'];
    const consumerSecret = s['woo_consumer_secret'];

    if (!wooBaseUrl || !consumerKey || !consumerSecret) return null;

    return {
      keyword:           s['quick_order_keyword']       || 'ppbears888',
      templateProductId: s['quick_order_product_id']    || '',
      replyTemplate:     s['quick_order_reply_template'] || DEFAULT_TEMPLATE,
      wooBaseUrl,
      consumerKey,
      consumerSecret,
    };
  }

  /**
   * Parse a quick order command.
   * Format: "{keyword} 開單 {name} {amount}"
   * Returns { name, amount } or null if not a quick order command.
   */
  parseCommand(keyword: string, text: string): { name: string; amount: string } | null {
    const trimmed = text.trim();
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${escaped}\\s+開單\\s+(.+?)\\s+(\\d+(?:\\.\\d+)?)$`);
    const match = trimmed.match(regex);
    if (!match) return null;
    return { name: match[1].trim(), amount: match[2].trim() };
  }

  /**
   * Create a new WooCommerce product by copying the template product.
   * Sets:
   *  - name  = customer name
   *  - slug  = customer name (WordPress URL-encodes Chinese chars automatically)
   *  - price = specified amount
   *  - visibility = hidden (accessible via direct URL but not listed in shop)
   *
   * Returns the new product's permalink (e.g. https://ppbears.com/product/李韋信/).
   */
  private async createWooProduct(
    settings: QuickOrderSettings,
    name: string,
    amount: string,
  ): Promise<{ productId: number; permalink: string } | null> {
    const { wooBaseUrl, consumerKey, consumerSecret, templateProductId } = settings;
    const base = wooBaseUrl.replace(/\/$/, '').replace(/^(https?:\/\/)www\./, '$1');
    const auth = `consumer_key=${consumerKey}&consumer_secret=${consumerSecret}`;

    // Step 1: Fetch template product settings to copy (optional but recommended)
    let templateFields: Record<string, any> = {};
    if (templateProductId) {
      try {
        const tRes = await wooRequest(`${base}/wp-json/wc/v3/products/${templateProductId}?${auth}`);
        if (tRes.ok) {
          const t = await tRes.json() as Record<string, any>;
          templateFields = {
            categories:        t.categories      || [],
            tags:              t.tags            || [],
            description:       t.description     || '',
            short_description: t.short_description || '',
            // Copy first image only
            images: Array.isArray(t.images) && t.images.length > 0
              ? [{ src: t.images[0].src, alt: name }]
              : [],
          };
        }
      } catch {
        // Template load failure is non-fatal; continue without copy
        log.warn({ templateProductId }, 'Failed to load template product; creating minimal product');
      }
    }

    // Step 2: Create new product
    const productPayload = {
      name,
      slug: name,            // WP sanitizes/URL-encodes Chinese characters
      type: 'simple',
      status: 'publish',
      catalog_visibility: 'hidden',  // direct URL works but not listed in shop
      regular_price: amount,
      ...templateFields,
    };

    try {
      const res = await wooRequest(`${base}/wp-json/wc/v3/products?${auth}`, {
        method: 'POST',
        body: JSON.stringify(productPayload),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        log.error({ status: res.status, errText }, 'WooCommerce product creation failed');
        return null;
      }

      const product = await res.json() as { id: number; permalink: string };
      const cleanUrl = product.permalink.replace(/^(https?:\/\/)www\./, '$1');
      log.info({ productId: product.id, permalink: cleanUrl, name, amount }, 'Quick order product created');
      return { productId: product.id, permalink: cleanUrl };
    } catch (err: any) {
      log.error({ err: err.message }, 'QuickOrder WC product API error');
      return null;
    }
  }

  /** Format the reply message using the configured template. */
  private formatReply(
    template: string,
    name: string,
    productUrl: string,
    productId: number,
    amount: string,
  ): string {
    return template
      .replace(/\{name\}/g, name)
      .replace(/\{product_url\}/g, productUrl)
      .replace(/\{order_number\}/g, String(productId))  // WC product ID as 商品編號
      .replace(/\{amount\}/g, amount);
  }

  /**
   * Main entry point: parse command → create product → return reply text.
   * Returns null if message is not a quick order command.
   */
  async handleIfCommand(tenantId: string, text: string): Promise<string | null> {
    const settings = await this.getSettings(tenantId);
    if (!settings) return null;

    const parsed = this.parseCommand(settings.keyword, text);
    if (!parsed) return null;

    log.info({ tenantId, name: parsed.name, amount: parsed.amount }, 'Quick order command detected');

    const result = await this.createWooProduct(settings, parsed.name, parsed.amount);

    if (!result) {
      return `⚠️ 開單失敗，請確認 WooCommerce API Key 是否具備「讀取/寫入」權限，或稍後再試。`;
    }

    return this.formatReply(
      settings.replyTemplate,
      parsed.name,
      result.permalink,
      result.productId,
      parsed.amount,
    );
  }
}

export const quickOrderService = new QuickOrderService();
