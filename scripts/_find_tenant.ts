import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: 'packages/backend/.env' });

const db = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

async function run() {
  const { data } = await db.from('product_url_allowlist').select('tenant_id,url').limit(3);
  console.log(JSON.stringify(data, null, 2));

  const { data: tenants } = await db.from('tenants').select('id, name').limit(5);
  console.log('Tenants:', JSON.stringify(tenants, null, 2));
}
run();
