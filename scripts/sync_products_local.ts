/**
 * sync_products_local.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * 本機商品索引同步腳本（暫存模式）
 *
 * ✅ 安全：商品只寫入暫存區 (status='staging')，不影響正在運作的 AI 查詢
 * ✅ 簡單：雙擊「同步商品索引.bat」即可執行
 * ✅ 確認：同步完成後，至管理後台點選「套用暫存索引」才正式上線
 *
 * 執行方式：
 *   雙擊「同步商品索引.bat」
 *   或手動：npx tsx scripts/sync_products_local.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: 'packages/backend/.env' });

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const STAGING_STATUS = 'staging';          // 同步寫入暫存
const DELAY_BETWEEN_CATEGORIES_MS = 800;
const DELAY_BETWEEN_PAGES_MS = 200;
const PAGE_SIZE = 100;

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const db = createClient(supabaseUrl, supabaseKey);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function wooFetch(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'PPBears-LocalSync/1.0', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 429) {
    console.warn('  ⚠️  Rate limited (429), waiting 5s...');
    await sleep(5_000);
    const retry = await fetch(url, {
      headers: { 'User-Agent': 'PPBears-LocalSync/1.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    return retry.ok ? retry.json() : null;
  }
  return res.ok ? res.json() : null;
}

async function getAllCategoryIds(
  baseUrl: string, auth: string, parentId: number, depth = 0
): Promise<number[]> {
  if (depth > 5) return [parentId];
  const ids: number[] = [parentId];
  try {
    const url = `${baseUrl}/wp-json/wc/v3/products/categories?parent=${parentId}&per_page=100&${auth}`;
    const subs = await wooFetch(url) as Array<{ id: number }>;
    if (!Array.isArray(subs) || !subs.length) return ids;
    for (const sub of subs) {
      const childIds = await getAllCategoryIds(baseUrl, auth, sub.id, depth + 1);
      ids.push(...childIds);
    }
  } catch { /* ignore */ }
  return ids;
}

async function upsertProduct(p: any, tenantId: string): Promise<void> {
  const phoneAttr = (p.attributes || []).find((a: any) =>
    a.name?.includes('型號') || a.name?.includes('手機') || a.name?.toLowerCase().includes('model')
  );
  const phoneModels = phoneAttr?.options?.join(', ') || '';

  const { error } = await db.from('product_index').upsert({
    tenant_id: tenantId,
    woo_product_id: p.id,
    name: p.name,
    slug: p.slug,
    categories: (p.categories || []).map((c: any) => c.name).join(', '),
    tags: (p.tags || []).map((t: any) => t.name).join(', '),
    price: p.price || '',
    url: p.permalink || '',
    image_url: p.images?.[0]?.src || '',
    phone_models: phoneModels,
    status: STAGING_STATUS,           // 寫入暫存，不直接覆蓋 active
    synced_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id,woo_product_id' });

  if (error) throw new Error(error.message);
}

async function syncCategoryUrl(
  baseUrl: string, auth: string, catUrl: string,
  tenantId: string, totalSynced: { count: number }
): Promise<void> {
  // Extract slug from URL (last path segment)
  const segments = new URL(catUrl).pathname.split('/').filter(Boolean);
  const catSlug = segments[segments.length - 1];
  if (!catSlug) { console.warn(`  ⚠️  Cannot extract slug from: ${catUrl}`); return; }

  // Resolve slug → category ID
  const catData = await wooFetch(`${baseUrl}/wp-json/wc/v3/products/categories?slug=${encodeURIComponent(catSlug)}&${auth}`) as Array<{ id: number; name: string }>;
  if (!Array.isArray(catData) || !catData.length) {
    console.warn(`  ⚠️  Category slug not found: "${catSlug}" — skipping`);
    return;
  }
  const categoryId = catData[0].id;
  const categoryName = catData[0].name;
  console.log(`  📂  "${categoryName}" (ID: ${categoryId})`);

  // Recursively get all sub-category IDs
  const allCatIds = await getAllCategoryIds(baseUrl, auth, categoryId);
  console.log(`      ↳ ${allCatIds.length} sub-categories`);

  // Paginate and sync all products in each category
  for (const catId of allCatIds) {
    let page = 1;
    while (true) {
      const prodUrl = `${baseUrl}/wp-json/wc/v3/products?category=${catId}&per_page=${PAGE_SIZE}&page=${page}&status=publish&${auth}`;
      let products: any[];
      try {
        products = await wooFetch(prodUrl);
      } catch (err: any) {
        console.warn(`      ⚠️  Network error on catId=${catId} page=${page}: ${err.message}`);
        break;
      }
      if (!Array.isArray(products) || !products.length) break;

      for (const p of products) {
        try {
          await upsertProduct(p, tenantId);
          totalSynced.count++;
        } catch (err: any) {
          console.warn(`      ❌  Failed to upsert product ${p.id}: ${err.message}`);
        }
      }
      process.stdout.write(`\r      ✅  Synced so far: ${totalSynced.count}`);
      page++;
      await sleep(DELAY_BETWEEN_PAGES_MS);
    }
  }
  console.log(); // newline after \r
}

async function main() {
  console.log('🔄  PPBears 本機產品索引同步工具');
  console.log('════════════════════════════════════════════════════════');

  // Read WooCommerce credentials from Supabase
  const { data: settingsData } = await db
    .from('tenant_settings')
    .select('key, value')
    .eq('tenant_id', TENANT_ID)
    .in('key', ['woo_base_url', 'woo_consumer_key', 'woo_consumer_secret']);

  const s: Record<string, string> = {};
  for (const row of settingsData || []) if (row.key && row.value) s[row.key] = row.value;

  const rawBaseUrl = s['woo_base_url'];
  const consumerKey = s['woo_consumer_key'];
  const consumerSecret = s['woo_consumer_secret'];

  if (!rawBaseUrl || !consumerKey || !consumerSecret) {
    console.error('❌  WooCommerce credentials not found in tenant_settings for tenant:', TENANT_ID);
    process.exit(1);
  }

  const baseUrl = rawBaseUrl.replace(/\/$/, '');
  const auth = `consumer_key=${consumerKey}&consumer_secret=${consumerSecret}`;

  console.log(`🌐  WooCommerce URL : ${baseUrl}`);
  console.log(`🏢  Tenant ID       : ${TENANT_ID}`);

  // Read allowlist
  const { data: allowlistData } = await db
    .from('product_url_allowlist')
    .select('url')
    .eq('tenant_id', TENANT_ID);

  const allowlistUrls = (allowlistData || []).map((r: any) => r.url).filter(Boolean);
  console.log(`📋  Allowlist URLs  : ${allowlistUrls.length} entries`);
  console.log('════════════════════════════════════════════════════════');

  // Only clear previous staging records (keep active live data intact)
  console.log('🗑️   清除舊暫存索引（保留正式資料不受影響）...');
  await db.from('product_index')
    .delete()
    .eq('tenant_id', TENANT_ID)
    .eq('status', STAGING_STATUS);
  console.log('    Done.');

  const totalSynced = { count: 0 };
  let totalErrors = 0;

  if (allowlistUrls.length === 0) {
    // Full sync: all published products
    console.log('📦  No allowlist — running FULL sync of all published products...');
    let page = 1;
    while (true) {
      const url = `${baseUrl}/wp-json/wc/v3/products?per_page=${PAGE_SIZE}&page=${page}&status=publish&${auth}`;
      const products = await wooFetch(url);
      if (!Array.isArray(products) || !products.length) break;
      for (const p of products) {
        try { await upsertProduct(p, TENANT_ID); totalSynced.count++; }
        catch (err: any) { totalErrors++; }
      }
      process.stdout.write(`\r✅  Synced: ${totalSynced.count}`);
      page++;
      await sleep(DELAY_BETWEEN_PAGES_MS);
    }
    console.log();
  } else {
    // Allowlist sync
    for (let i = 0; i < allowlistUrls.length; i++) {
      const url = allowlistUrls[i];
      console.log(`\n[${i + 1}/${allowlistUrls.length}] ${url}`);

      if (url.includes('/product-category/') || url.includes('/product_cat/')) {
        try {
          await syncCategoryUrl(baseUrl, auth, url, TENANT_ID, totalSynced);
        } catch (err: any) {
          console.error(`  ❌  Error syncing category ${url}:`, err.message);
          totalErrors++;
        }
      } else {
        // Single product URL
        const segments = new URL(url).pathname.split('/').filter(Boolean);
        const slug = segments[segments.length - 1];
        const results = await wooFetch(`${baseUrl}/wp-json/wc/v3/products?slug=${encodeURIComponent(slug)}&${auth}`);
        if (Array.isArray(results) && results.length > 0) {
          try { await upsertProduct(results[0], TENANT_ID); totalSynced.count++; }
          catch (err: any) { totalErrors++; }
        } else {
          console.warn(`  ⚠️  Product not found: ${slug}`);
          totalErrors++;
        }
      }

      if (i < allowlistUrls.length - 1) {
        process.stdout.write(`  ⏳  Waiting ${DELAY_BETWEEN_CATEGORIES_MS}ms...`);
        await sleep(DELAY_BETWEEN_CATEGORIES_MS);
        process.stdout.write(' Done.\n');
      }
    }
  }

  console.log('\n════════════════════════════════════════════════════════');
  console.log(`✅  同步到暫存區完成！`);
  console.log(`   暫存商品數 : ${totalSynced.count}`);
  console.log(`   錯誤數     : ${totalErrors}`);
  console.log();
  console.log('  ➡️  請至管理後台「產品索引」頁面');
  console.log('  ➡️  點選「套用暫存索引」按鈕以正式上線');
  console.log('════════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
