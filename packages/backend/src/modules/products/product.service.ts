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
   * Fetch the URL allowlist for this tenant from Supabase.
   */
  private async getAllowlistUrls(tenantId: string): Promise<string[]> {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from('product_url_allowlist')
      .select('url')
      .eq('tenant_id', tenantId);
    return data?.map((r) => r.url) || [];
  }

  /**
   * Try to extract WooCommerce product ID from a permalink URL.
   * WooCommerce URLs usually contain /?p=<id> or /shop/<slug>/.
   */
  private extractSlugFromUrl(url: string): string | null {
    try {
      const u = new URL(url);
      // e.g. https://ppbears.com/product/water-crystal-case/
      const segments = u.pathname.split('/').filter(Boolean);
      // Last meaningful segment is usually the slug
      return segments[segments.length - 1] || null;
    } catch {
      return null;
    }
  }

  /**
   * Pull products from WooCommerce and upsert into product_index.
   * If the URL allowlist is non-empty, only those URLs/slugs are synced.
   */
  async syncProducts(tenantId: string): Promise<{ synced: number; errors: number }> {
    const creds = await this.getCredentials(tenantId);
    if (!creds) {
      log.warn({ tenantId }, 'WooCommerce credentials not configured for product sync');
      return { synced: 0, errors: 0 };
    }

    const db = getSupabaseAdmin();
    let synced = 0;
    let errors = 0;

    // ── Allowlist mode ────────────────────────────────────────────────────────
    const allowlistUrls = await this.getAllowlistUrls(tenantId);
    const useAllowlist = allowlistUrls.length > 0;

    // Create sync job
    const { data: job } = await db.from('sync_jobs').insert({
      tenant_id: tenantId,
      job_type: 'product_sync',
      status: 'running',
      started_at: new Date().toISOString(),
    }).select().single();

    const upsertProduct = async (p: WooProduct) => {
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
    };

    try {
      if (useAllowlist) {
        // ── Allowlist sync: supports product pages AND category pages ──────────
        log.info({ tenantId, count: allowlistUrls.length }, 'Starting allowlist-mode product sync');

        // Clear old index first so only allowlist products remain
        const { count: deleted } = await db
          .from('product_index')
          .delete()
          .eq('tenant_id', tenantId);
        log.info({ tenantId, deleted }, 'Cleared existing product index for allowlist sync');
        for (const url of allowlistUrls) {
          try {
            if (url.includes('/product-category/') || url.includes('/product_cat/')) {
              // ── Category URL: sync all products in this category ──────────
              const catSlug = this.extractSlugFromUrl(url);
              if (!catSlug) { errors++; continue; }

              // Step 1: Resolve category slug → WooCommerce category ID
              const catApiUrl = `${creds.baseUrl}/wp-json/wc/v3/products/categories?slug=${encodeURIComponent(catSlug)}&consumer_key=${creds.consumerKey}&consumer_secret=${creds.consumerSecret}`;
              const catRes = await fetch(catApiUrl);
              if (!catRes.ok) { errors++; continue; }
              const cats = await catRes.json() as Array<{ id: number; name: string }>;
              if (!cats.length) {
                log.warn({ tenantId, url, catSlug }, 'Category not found by slug');
                errors++;
                continue;
              }
              const categoryId = cats[0].id;

              // Step 2: Paginate all products in this category
              let catPage = 1;
              while (true) {
                const prodUrl = `${creds.baseUrl}/wp-json/wc/v3/products?category=${categoryId}&per_page=100&page=${catPage}&status=publish&consumer_key=${creds.consumerKey}&consumer_secret=${creds.consumerSecret}`;
                const prodRes = await fetch(prodUrl);
                if (!prodRes.ok) break;
                const catProducts = await prodRes.json() as WooProduct[];
                if (!catProducts.length) break;
                for (const p of catProducts) {
                  try { await upsertProduct(p); } catch (err: any) { errors++; }
                }
                catPage++;
              }
              log.info({ tenantId, catSlug, categoryId }, 'Category sync complete');

            } else {
              // ── Product URL: sync single product by slug ──────────────────
              const slug = this.extractSlugFromUrl(url);
              if (!slug) { errors++; continue; }

              const apiUrl = `${creds.baseUrl}/wp-json/wc/v3/products?slug=${encodeURIComponent(slug)}&consumer_key=${creds.consumerKey}&consumer_secret=${creds.consumerSecret}`;
              const res = await fetch(apiUrl);
              if (!res.ok) { errors++; continue; }
              const results = await res.json() as WooProduct[];
              if (results.length > 0) {
                await upsertProduct(results[0]);
              } else {
                log.warn({ tenantId, url, slug }, 'Product not found by slug');
                errors++;
              }
            }
          } catch (err: any) {
            log.error({ tenantId, url, err: err.message }, 'Allowlist item sync failed');
            errors++;
          }
        }
      } else {
        // ── Full sync: paginate all published products ─────────────────────
        log.info({ tenantId }, 'Starting full product sync');
        let page = 1;
        while (true) {
          const apiUrl = `${creds.baseUrl}/wp-json/wc/v3/products?per_page=100&page=${page}&consumer_key=${creds.consumerKey}&consumer_secret=${creds.consumerSecret}&status=publish`;
          const res = await fetch(apiUrl);
          if (!res.ok) break;
          const products = await res.json() as WooProduct[];
          if (!products.length) break;

          for (const p of products) {
            try {
              await upsertProduct(p);
            } catch (err: any) {
              log.error({ tenantId, productId: p.id, err: err.message }, 'Failed to sync product');
              errors++;
            }
          }
          page++;
        }
      }

      if (job) {
        await db.from('sync_jobs').update({
          status: 'completed',
          items_processed: synced,
          completed_at: new Date().toISOString(),
        }).eq('id', job.id);
      }

      log.info({ tenantId, synced, errors, mode: useAllowlist ? 'allowlist' : 'full' }, 'Product sync completed');
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
    const keywords = [
      '手機殼', '殼', '款式', '産品', '產品', '有什麼', '推薦', '適合', '型號',
      '要怎麼買', '哪裡買', '在哪買', '怎麼購買',
      '訂製', '訂做', '客製', '客制', '想訂', '想做', '幫我做',
      '想要', '想買', '購買', '要買', '我要', '幫我找', '有沒有',
    ];
    return keywords.some(kw => text.includes(kw));
  }

  /**
   * Extract the most useful search keyword from a customer message.
   */
  extractSearchKeyword(text: string): string {
    const fillers = [
      '我想要', '我想', '幫我', '我要', '請問', '有沒有', '有嗎', '可以嗎',
      '訂製', '訂做', '客製化', '客製', '客制', '手機殼', '殼', '款式', '推薦',
      '購買', '想買', '要買', '的', '嗎', '呢', '喔', '耶',
    ];
    let kw = text;
    for (const f of fillers) kw = kw.replace(new RegExp(f, 'g'), ' ');
    return kw.replace(/\s+/g, ' ').trim() || text;
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
