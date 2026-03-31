import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: 'packages/backend/.env' });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const db = createClient(supabaseUrl, supabaseKey);

async function testWoo() {
  const tenantId = '1';
  const { data } = await db
    .from('tenant_settings')
    .select('key, value')
    .eq('tenant_id', tenantId)
    .in('key', [
      'woo_base_url',
      'woo_consumer_key',
      'woo_consumer_secret',
      'quick_order_product_id'
    ]);

  const s: Record<string, string> = {};
  for (const row of data || []) if (row.key && row.value) s[row.key] = row.value;

  const rawWooBaseUrl   = s['woo_base_url'];
  const consumerKey    = s['woo_consumer_key'];
  const consumerSecret = s['woo_consumer_secret'];

  if (!rawWooBaseUrl || !consumerKey || !consumerSecret) {
    console.log("Missing config");
    return;
  }
  const wooBaseUrl = rawWooBaseUrl.replace(/^(https?:\/\/)(?!www\.)/i, '$1www.');

  const auth = `consumer_key=${consumerKey}&consumer_secret=${consumerSecret}`;
  const base = wooBaseUrl.replace(/\/$/, '');
  const url = `${base}/wp-json/wc/v3/products/1230491039120391?${auth}`; // Fake ID to trigger 404 or something

  console.log(`URL: ${url}`);
  try {
    const r = await fetch(url);
    const text = await r.text();
    console.log(`Status: ${r.status}`);
    console.log(`Body: ${text}`);
  } catch(e) {
    console.error("Fetch threw:", e);
  }

  // Next, try a POST (what quick-order uses)
  const postUrl = `${base}/wp-json/wc/v3/products?${auth}`;
  console.log(`\nPOST URL: ${postUrl}`);

  const productPayload = {
    name: 'Test Name Server Issue',
    slug: 'test-name-server-issue',
    type: 'simple',
    status: 'publish',
    catalog_visibility: 'hidden',
    regular_price: '100',
    meta_data: [
      { key: '_is_quick_order', value: 'yes' },
    ],
  };

  try {
    const r = await fetch(postUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(productPayload)
    });
    const text = await r.text();
    console.log(`POST Status: ${r.status}`);
    console.log(`POST Body: ${text}`);
  } catch(e) {
    console.error("POST Fetch threw:", e);
  }
}

testWoo();
