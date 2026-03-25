import { getSupabaseAdmin } from '../../utils/supabase.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger({ module: 'ProductService' });

export interface WooProduct {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  categories: Array<{ name: string }>;
  tags: Array<{ name: string }>;
  price: string;
  images: Array<{ src: string }>;
  attributes: Array<{ name: string; options: string[] }>;
  status: string;
}

export class ProductService {
  /**
   * Get WooCommerce API credentials from tenant settings or env.
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

    const s: Record<string, string> = {};
    if (data) for (const row of data) if (row.key && row.value) s[row.key] = row.value;

    const baseUrl = s['woo_base_url'] || process.env.WOO_BASE_URL;
    const consumerKey = s['woo_consumer_key'] || process.env.WOO_CONSUMER_KEY;
    const consumerSecret = s['woo_consumer_secret'] || process.env.WOO_CONSUMER_SECRET;

    if (!baseUrl || !consumerKey || !consumerSecret) return null;
    return { baseUrl, consumerKey, consumerSecret };
  }

  /**
   * Pull all products from WooCommerce and upsert into product_index.
   */
  async syncProducts(tenantId: string): Promise<{ synced: number; errors: number }> {
    const creds = await this.getCredentials(tenantId);
    if (!creds) {
      log.warn({ tenantId }, 'WooCommerce credentials not configured for product sync');
      return { synced: 0, errors: 0 };
    }

    const db = getSupabaseAdmin();
    let page = 1;
    let synced = 0;
    let errors = 0;

    // Create sync job
    const { data: job } = await db.from('sync_jobs').insert({
      tenant_id: tenantId,
      job_type: 'product_sync',
      status: 'running',
      started_at: new Date().toISOString(),
    }).select().single();

    try {
      while (true) {
        const url = `${creds.baseUrl}/wp-json/wc/v3/products?per_page=100&page=${page}&consumer_key=${creds.consumerKey}&consumer_secret=${creds.consumerSecret}&status=publish`;
        const res = await fetch(url);
        if (!res.ok) break;
        const products = await res.json() as WooProduct[];
        if (!products.length) break;

        for (const p of products) {
          try {
            // Extract phone model attributes
            const phoneAttr = p.attributes.find(a => 
              a.name.includes('型號') || a.name.includes('手機') || a.name.toLowerCase().includes('model')
            );
            const phoneModels = phoneAttr?.options.join(', ') || '';

            await db.from('product_index').upsert({
              tenant_id: tenantId,
              woo_product_id: p.id,
              name: p.name,
              slug: p.slug,
              categories: p.categories.map(c => c.name).join(', '),
              tags: p.tags.map(t => t.name).join(', '),
              price: p.price,
              url: p.permalink,
              image_url: p.images[0]?.src || '',
              phone_models: phoneModels,
              status: 'active',
              synced_at: new Date().toISOString(),
            }, { onConflict: 'tenant_id,woo_product_id' });

            synced++;
          } catch (err: any) {
            log.error({ tenantId, productId: p.id, err: err.message }, 'Failed to sync product');
            errors++;
          }
        }

        page++;
      }

      // Update job status
      if (job) {
        await db.from('sync_jobs').update({
          status: 'completed',
          items_processed: synced,
          completed_at: new Date().toISOString(),
        }).eq('id', job.id);
      }

      log.info({ tenantId, synced, errors }, 'Product sync completed');
    } catch (err: any) {
      if (job) {
        await db.from('sync_jobs').update({
          status: 'failed',
          error_message: err.message,
          completed_at: new Date().toISOString(),
        }).eq('id', job.id);
      }
    }

    return { synced, errors };
  }

  /**
   * Search products in the local index by keyword (phone model, category, name).
   */
  async searchProducts(tenantId: string, query: string, limit = 3): Promise<Array<{
    name: string;
    price: string;
    url: string;
    categories: string;
  }>> {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from('product_index')
      .select('name, price, url, categories, phone_models')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .or(`name.ilike.%${query}%,categories.ilike.%${query}%,tags.ilike.%${query}%,phone_models.ilike.%${query}%`)
      .limit(limit);

    return data || [];
  }

  /**
   * Determine if a message is asking about products.
   */
  isProductQueryIntent(text: string): boolean {
    const keywords = ['手機殼', '殼', '款式', '産品', '產品', '有什麼', '推薦', '適合', '型號', '手機', '要怎麼買', '哪裡買'];
    return keywords.some(kw => text.includes(kw));
  }

  /**
   * Format product results as a LINE message.
   */
  formatProducts(products: Array<{ name: string; price: string; url: string; categories: string }>): string {
    if (!products.length) return '目前沒有找到相符的產品，請輸入「真人」詢問客服人員。';
    const lines = products.map((p, i) =>
      `${i + 1}. ${p.name}\n   💰 NT$${p.price}\n   🔗 ${p.url}`
    );
    return `🐻 以下是為您找到的相關產品：\n\n${lines.join('\n\n')}`;
  }
}

export const productService = new ProductService();
