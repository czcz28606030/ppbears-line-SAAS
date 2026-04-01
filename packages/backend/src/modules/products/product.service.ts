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
    // ─── Step 1: Chinese → English brand synonym table ───────────────────────────
    const BRAND_MAP: Record<string, string[]> = {
      '小米': ['xiaomi', 'redmi'],
      '紅米': ['redmi', 'xiaomi'],
      '蘋果': ['apple', 'iphone'],
      '三星': ['samsung', 'galaxy'],
      '華為': ['huawei'],
      '華碩': ['asus', 'rog'],
      '索尼': ['sony', 'xperia'],
      '谷歌': ['google', 'pixel'],
    };

    // Short suffix alias — BIDIRECTIONAL so "ultra" finds "U" in DB and vice versa
    // Each key expands to ALL equivalent forms including itself
    const ALIAS_MAP: Record<string, string[]> = {
      // Short → full
      u:       ['ultra', 'u'],
      pm:      ['pro max', 'promax', 'pm'],
      // Full → short (so "ultra" in query also searches "u" in DB)
      ultra:   ['ultra', 'u'],
      promax:  ['pro max', 'promax', 'pm'],
      // "pro max" is two tokens so handle "max" independently when after "pro"
      plus:    ['plus', '+'],
      mini:    ['mini'],
      pro:     ['pro'],
      max:     ['max'],
    };

    // ─── Step 2: Normalise / smart-split the raw query ────────────────────────
    let s = query.toLowerCase();

    // 2a. Expand "promax" before any other splits so it becomes two tokens
    s = s.replace(/\bpromax\b/g, 'pro max');

    // 2b. Split known suffixes that are directly glued to a digit
    //     sorted longest-first to avoid "pro max" matching as just "pro"
    const DIGIT_SUFFIXES = ['promax', 'ultra', 'plus', 'mini', 'pro', 'max', 'pm'];
    for (const suffix of DIGIT_SUFFIXES) {
      s = s.replace(new RegExp(`(\\d)(${suffix})`, 'g'), `$1 $2`);
    }

    // 2c. Split U/u that is glued to a digit (e.g. "17U" → "17 u")
    s = s.replace(/(\d)(u)\b/g, '$1 $2');

    // 2d. Split known brand names glued before digits (e.g. "iphone16" → "iphone 16")
    s = s.replace(/(iphone|ipad|galaxy|pixel|pad)(\d)/g, '$1 $2');

    // ─── Step 3: Tokenize ─────────────────────────────────────────────────────
    const rawTokens = s.match(/[a-zA-Z0-9]+|[\u4e00-\u9fa5]+/g) || [];

    // ─── Step 4: Build token groups (one group = one search constraint) ────────
    const KEEP_SINGLES = new Set(['u', 'pm']); // single-char aliases to keep
    const tokenGroups: string[][] = [];

    for (const t of rawTokens) {
      // Skip pure noise: single letter (unless it's an alias key) or single digit
      if (t.length === 1 && /[a-zA-Z]/.test(t) && !KEEP_SINGLES.has(t)) continue;
      if (t.length === 1 && /[0-9]/.test(t)) continue;

      const group = new Set<string>([t]);

      // Expand alias — BIDIRECTIONAL: "ultra" → adds "u"; "u" → adds "ultra"
      if (ALIAS_MAP[t]) ALIAS_MAP[t].forEach(a => group.add(a));

      // Expand brand synonyms
      for (const [cn, enList] of Object.entries(BRAND_MAP)) {
        const enLower = enList.map(e => e.toLowerCase());
        if (t.includes(cn) || t === cn || enLower.includes(t)) {
          group.add(cn);
          enList.forEach(e => group.add(e));
        }
      }

      tokenGroups.push([...group]);
    }

    if (tokenGroups.length === 0) return [];

    // ─── Step 5: AND-of-ORs Supabase query ────────────────────────────────────
    const db = getSupabaseAdmin();
    let req = db
      .from('product_index')
      .select('name, price, url, categories, phone_models')
      .eq('tenant_id', tenantId)
      .eq('status', 'active');

    for (const group of tokenGroups) {
      const orClauses = group
        .map(t => `name.ilike.%${t}%,categories.ilike.%${t}%,tags.ilike.%${t}%,phone_models.ilike.%${t}%`)
        .join(',');
      req = req.or(orClauses);
    }

    const { data } = await req.limit(limit * 2);
    if (!data || data.length === 0) return [];

    // ─── Step 6: Re-rank by how many original raw tokens appear in result ──────
    const scored: Array<{ name: string; price: string; url: string; categories: string; phone_models: string; score: number }> = data.map(row => ({
      name: row.name as string,
      price: row.price as string,
      url: row.url as string,
      categories: row.categories as string,
      phone_models: row.phone_models as string,
      score: rawTokens.filter(t => `${row.name} ${row.categories} ${row.phone_models}`.toLowerCase().includes(t)).length,
    }));
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

    // Detect broad brand mentions or phone model characteristics
    const modelPatterns = [
      // 1. Broad Prominent Brands
      /apple|iphone|ipad/i,
      /samsung|galaxy/i,
      /xiaomi|mi\s*\d|redmi|poco/i,
      /oppo|reno|find/i, 
      /vivo|iqoo/i,
      /realme/i,
      /huawei|mate|p\d{2}|nova/i,
      /asus|zenfone|rog/i,
      /sony|xperia/i,
      /google|pixel/i,
      /motorola|moto/i,
      /sharp|aquos/i,
      /nothing\s*phone/i,
      /蘋果|三星|小米|紅米|華為|華碩|索尼|谷歌/i,
      
      // 2. Generalized model pattern A: 1-4 letters + numbers (e.g. Reno 12, X100, V30, A55)
      // Enforce word boundaries to avoid accidentally matching normal English words
      /\b[a-zA-Z]{1,4}\s*\d{1,3}(pro|plus|ultra|max|mini)?\b/i,
      
      // 3. Generalized model pattern B: numbers + letters (e.g. 17 Pro, 16PM, 15 Plus)
      /\b\d{1,2}\s*[a-zA-Z]{1,10}\b/i,
    ];
    
    if (modelPatterns.some(p => p.test(text))) return true;

    // 4. Fallback for extremely short naked digit queries (e.g. "17", "S24", "16")
    // If the string is short and has a number, there's a strong chance it's a naked model number
    if (text.length <= 15 && /\d/.test(text)) {
      return true;
    }

    return false;
  }


  /**
   * Extract the most useful search keyword from a customer message.
   */
  extractSearchKeyword(text: string): string {
    // Known Chinese brand names to preserve
    const CHINESE_BRANDS = [
      '三星', '蘋果', '小米', '紅米', '華為', '華碩', '索尼', '谷歌',
      '摩托羅拉', '諾基亞', '夏普', '歐珀', '維沃',
    ];

    const parts: string[] = [];

    // 1. Extract all English words and digit sequences (brand names, model numbers, suffixes)
    const enAndDigit = text.match(/[a-zA-Z0-9]+/g) || [];
    parts.push(...enAndDigit);

    // 2. Extract known Chinese brand names
    for (const brand of CHINESE_BRANDS) {
      if (text.includes(brand)) parts.push(brand);
    }

    // If we found anything useful, return it; otherwise fall back to full text
    const result = parts.join(' ').replace(/\s+/g, ' ').trim();
    return result || text;
  }

  /**
   * Format product results as plain LINE message text.
   */
  formatProducts(products: Array<{ name: string; price: string; url: string; categories: string }>): string {
    if (!products.length) return '目前沒有找到相符的產品，請輸入「真人」詢問客服人員。';
    const lines = products.map((p, i) =>
      `${i + 1}. ${p.name}\n   🔗 ${p.url}`
    );
    return `🐻 以下是為您找到的相關產品：\n\n${lines.join('\n\n')}`;
  }

  /**
   * Format product results as structured context for injection into the LLM system prompt.
   * This allows the AI to craft a natural response citing real product data.
   */
  formatProductsAsAiContext(products: Array<{ name: string; price: string; url: string; categories: string; phone_models?: string; }>): string {
    if (!products.length) return '';

    // Check for extreme brand ambiguity (e.g. user types "17" and gets iPhone 17 AND Xiaomi 17)
    // If we identify products from multiple completely different brands, we inject an intercept prompt.
    if (products.length > 1) {
      const MAJOR_BRANDS = [
        { id: 'apple', keywords: ['apple', 'iphone', 'ipad', '蘋果'] },
        { id: 'samsung', keywords: ['samsung', 'galaxy', '三星'] },
        { id: 'xiaomi', keywords: ['xiaomi', 'mi ', 'redmi', 'poco', '小米', '紅米'] },
        { id: 'oppo', keywords: ['oppo', 'reno', 'find'] },
        { id: 'vivo', keywords: ['vivo', 'iqoo'] },
        { id: 'realme', keywords: ['realme'] },
        { id: 'huawei', keywords: ['huawei', 'mate', 'nova', '華為'] },
        { id: 'asus', keywords: ['asus', 'zenfone', 'rog', '華碩'] },
        { id: 'sony', keywords: ['sony', 'xperia', '索尼'] },
        { id: 'google', keywords: ['google', 'pixel', '谷歌'] },
      ];

      const foundBrands = new Set<string>();

      for (const p of products) {
        const haystack = `${p.name} ${p.categories} ${p.phone_models || ''}`.toLowerCase();
        for (const brand of MAJOR_BRANDS) {
          if (brand.keywords.some(k => haystack.includes(k))) {
            foundBrands.add(brand.id);
            break;
          }
        }
      }

      // If results span 2 or more distinct brands, ask for clarification.
      if (foundBrands.size > 1) {
        return `\n\n[系統警告] 客戶查詢的型號不足以辨識精確品牌（包含多廠牌款式符合）。請直接回覆客戶反問品牌，例如：「請問您是指 iPhone 的款式，還是小米或其他廠牌呢？請告訴我您的手機品牌，我馬上為您找連結！」絕對不要直接提供任何產品連結！`;
      }
    }

    const lines = products.map((p, i) =>
      `[${i + 1}] 商品名稱: ${p.name} | 分類: ${p.categories} | 購買連結: ${p.url}`
    );
    return `\n\n[產品索引搜尋結果 - 以下資料必須優先使用]\n${lines.join('\n')}\n[回覆規則] 1. 必須直接將購買連結以純文字 URL 格式完整回覆給客戶（例如：https://ppbears.com/...），不得使用 Markdown 的 [[url]] 雙括號格式。2. 不得叫客戶「自行搜尋」或「自行上網查找」。3. 若有找到相符產品，必定要附上連結。4. 絕對不可在回覆中列出商品價格或主動報價。5. 每次提供連結時，必須親切反問確認（如：「這個連結是您要找的型號嗎？若不是請告訴我完整品牌與型號！」）。若客戶明確表示搜尋結果中「沒有」想要的型號，請主動建議客戶：「您可以輸入『真人』，我將為您轉接專員協助尋找唷！」`;
  }
}

export const productService = new ProductService();
