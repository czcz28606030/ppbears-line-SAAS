import { getSupabaseAdmin } from '../../utils/supabase.js';
import { createLogger } from '../../utils/logger.js';
import { wooRequest } from '../../utils/woo-request.js';

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

    const rawBaseUrl = s['woo_base_url'] || process.env.WOO_BASE_URL;
    const consumerKey = s['woo_consumer_key'] || process.env.WOO_CONSUMER_KEY;
    const consumerSecret = s['woo_consumer_secret'] || process.env.WOO_CONSUMER_SECRET;

    if (!rawBaseUrl || !consumerKey || !consumerSecret) return null;
    // Auto-add www. to bypass Hostinger port-level firewall for non-www hostnames
    const baseUrl = rawBaseUrl.replace(/^(https?:\/\/)(?!www\.)/i, '$1www.');
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
   * Recursively collect a category ID and all its descendant category IDs.
   * This ensures products in sub-subcategories (e.g. iPhone 15 under iPhone > Apple)
   * are also captured.
   */
  private async getAllCategoryIds(
    baseUrl: string,
    consumerKey: string,
    consumerSecret: string,
    parentId: number,
    depth = 0
  ): Promise<number[]> {
    if (depth > 5) return []; // safety cap
    const ids: number[] = [parentId];
    try {
      // Fetch subcategories of this parent
      const apiUrl = `${baseUrl}/wp-json/wc/v3/products/categories?parent=${parentId}&per_page=100&consumer_key=${consumerKey}&consumer_secret=${consumerSecret}`;
      const res = await wooRequest(apiUrl);
      if (!res.ok) return ids;
      const subs = await res.json() as Array<{ id: number }>;
      if (!Array.isArray(subs) || !subs.length) return ids;
      for (const sub of subs) {
        const childIds = await this.getAllCategoryIds(baseUrl, consumerKey, consumerSecret, sub.id, depth + 1);
        ids.push(...childIds);
      }
    } catch { /* ignore errors, return what we have */ }
    return ids;
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
              const catRes = await wooRequest(catApiUrl);
              if (!catRes.ok) { errors++; continue; }
              const cats = await catRes.json() as Array<{ id: number; name: string }>;
              if (!Array.isArray(cats) || !cats.length) {
                log.warn({ tenantId, url, catSlug }, 'Category not found by slug');
                errors++;
                continue;
              }
              const categoryId = cats[0].id;

              // Step 2: Recursively collect ALL descendant category IDs
              const allCategoryIds = await this.getAllCategoryIds(
                creds.baseUrl, creds.consumerKey, creds.consumerSecret, categoryId
              );
              log.info({ tenantId, catSlug, categoryId, totalCategories: allCategoryIds.length }, 'Fetched all category IDs (including subcategories)');

              // Step 3: For each category ID, paginate and sync all products
              for (const catId of allCategoryIds) {
                let catPage = 1;
                while (true) {
                  const prodUrl = `${creds.baseUrl}/wp-json/wc/v3/products?category=${catId}&per_page=100&page=${catPage}&status=publish&consumer_key=${creds.consumerKey}&consumer_secret=${creds.consumerSecret}`;
                  const prodRes = await wooRequest(prodUrl);
                  if (!prodRes.ok) break;
                  const catProducts = await prodRes.json();
                  // Guard: WooCommerce may return an error object instead of array on last page
                  if (!Array.isArray(catProducts) || !catProducts.length) break;
                  for (const p of catProducts as WooProduct[]) {
                    try { await upsertProduct(p); } catch (err: any) { errors++; }
                  }
                  catPage++;
                }
              }
              log.info({ tenantId, catSlug, categoryId, allCategoryIds: allCategoryIds.length }, 'Category (recursive) sync complete');

            } else {
              // ── Product URL: sync single product by slug ──────────────────
              const slug = this.extractSlugFromUrl(url);
              if (!slug) { errors++; continue; }

              const apiUrl = `${creds.baseUrl}/wp-json/wc/v3/products?slug=${encodeURIComponent(slug)}&consumer_key=${creds.consumerKey}&consumer_secret=${creds.consumerSecret}`;
              const res = await wooRequest(apiUrl);
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
          const res = await wooRequest(apiUrl);
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
   * Uses tokenized search with brand synonym expansion and OR-based scoring.
   */
  async searchProducts(tenantId: string, query: string, limit = 3): Promise<Array<{
    name: string;
    price: string;
    url: string;
    categories: string;
    phone_models: string;
  }>> {
    const db = getSupabaseAdmin();

    // --- Chinese → English brand synonym expansion ---
    const brandSynonyms: Record<string, string[]> = {
      '小米': ['xiaomi', 'mi', 'redmi'],
      '紅米': ['redmi', 'xiaomi'],
      '蘋果': ['apple', 'iphone', 'ipad'],
      '三星': ['samsung', 'galaxy'],
      '華為': ['huawei'],
      '華碩': ['asus', 'zenfone', 'rog'],
      '索尼': ['sony', 'xperia'],
      '谷歌': ['google', 'pixel'],
    };


    // Tokenize the query: split into letters+numbers runs and Chinese character runs
    const rawTokens = query.match(/[a-zA-Z0-9]+|[\u4e00-\u9fa5]+/g) || [];

    // Expand tokens with brand synonyms
    const expandedTokens: string[] = [];
    for (const t of rawTokens) {
      expandedTokens.push(t);
      for (const [cn, enList] of Object.entries(brandSynonyms)) {
        if (t.includes(cn)) enList.forEach(en => expandedTokens.push(en));
        if (t.toLowerCase() === cn || enList.includes(t.toLowerCase())) {
          // already covered
        }
      }
    }

    // Filter out single-char noise tokens that cause false positives (e.g. pure "U", "A")
    const meaningfulTokens = expandedTokens.filter(t => {
      if (/^[a-zA-Z]$/.test(t)) return false; // skip single English letters
      if (t.length < 2 && /^[0-9]$/.test(t)) return false; // skip single digits
      return true;
    });

    if (meaningfulTokens.length === 0) return [];

    // Use OR strategy: build one big OR filter across all tokens and all columns
    // This is looser than AND but prevents zero results when tokens span two languages
    const orClauses = meaningfulTokens
      .map(t => `name.ilike.%${t}%,categories.ilike.%${t}%,tags.ilike.%${t}%,phone_models.ilike.%${t}%`)
      .join(',');

    const { data } = await db
      .from('product_index')
      .select('name, price, url, categories, phone_models')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .or(orClauses)
      .limit(limit * 3); // fetch more then re-rank

    if (!data || data.length === 0) return [];

    // Re-rank: score by how many tokens each result matches
    const scored = data.map(row => {
      const haystack = `${row.name} ${row.categories} ${row.phone_models}`.toLowerCase();
      const score = meaningfulTokens.filter(t => haystack.includes(t.toLowerCase())).length;
      return { ...row, score };
    });
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit);
  }

  /**
   * Determine if a message is asking about products.
   * Detects both shopping intent keywords AND bare phone model mentions.
   */
  isProductQueryIntent(text: string): boolean {
    const intentKeywords = [
      '手機殼', '殼', '款式', '産品', '產品', '有什麼', '推薦', '適合', '型號',
      '要怎麼買', '哪裡買', '在哪買', '怎麼購買',
      '訂製', '訂做', '客製', '客制', '想訂', '想做', '幫我做',
      '想要', '想買', '購買', '要買', '我要', '幫我找', '有沒有',
    ];
    if (intentKeywords.some(kw => text.includes(kw))) return true;

    // Also detect bare phone model mentions (e.g. "17 PRO", "iPhone 16 Plus", "S25 Ultra")
    const modelPatterns = [
      /iphone\s*\d/i,
      /\bipad\b/i,
      /galaxy\s*(s|a|z)\d/i,
      /pixel\s*\d/i,
      /\b\d{1,2}\s*(pro|plus|ultra|max|mini|u)\b/i,  // e.g. "17 PRO", "15 Plus", "17U"
      /xiaomi|oppo|vivo|realme|huawei|sony|lg|htc|asus|nokia/i,
      /rog\s*\d*\s*(phone|ultimate|pro)?/i,  // ROG7, ROG Phone, ROG7 Ultimate
      /蘋果|三星|小米|紅米|華為|華碩|索尼|谷歌/i,
    ];
    return modelPatterns.some(p => p.test(text));
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
   * Format product results as plain LINE message text.
   */
  formatProducts(products: Array<{ name: string; price: string; url: string; categories: string }>): string {
    if (!products.length) return '目前沒有找到相符的產品，請輸入「真人」詢問客服人員。';
    const lines = products.map((p, i) =>
      `${i + 1}. ${p.name}\n   💰 NT$${p.price}\n   🔗 ${p.url}`
    );
    return `🐻 以下是為您找到的相關產品：\n\n${lines.join('\n\n')}`;
  }

  /**
   * Format product results as structured context for injection into the LLM system prompt.
   * This allows the AI to craft a natural response citing real product data.
   */
  formatProductsAsAiContext(products: Array<{ name: string; price: string; url: string; categories: string }>): string {
    if (!products.length) return '';
    const lines = products.map((p, i) =>
      `[${i + 1}] 商品名稱: ${p.name} | 價格: NT$${p.price} | 分類: ${p.categories} | 購買連結: ${p.url}`
    );
    return `\n\n[產品索引搜尋結果 - 以下資料必須優先使用]\n${lines.join('\n')}\n[回覆規則] 1. 必須直接將購買連結以純文字 URL 格式完整回覆給客戶（例如：https://ppbears.com/...），不得使用 Markdown 的 [[url]] 雙括號格式。2. 不得叫客戶「自行搜尋」或「自行上網查找」。3. 若有找到相符產品，必定要附上連結。`;
  }
}

export const productService = new ProductService();
