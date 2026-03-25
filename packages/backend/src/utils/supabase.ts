import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';

let supabaseAdmin: SupabaseClient | null = null;

/**
 * Get the Supabase admin client (service role - full access).
 * Used only in backend for server-side operations.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (!supabaseAdmin) {
    if (!config.supabase.url || !config.supabase.serviceRoleKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }
    supabaseAdmin = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return supabaseAdmin;
}

/**
 * Helper to scope all queries by tenant_id.
 * Usage: scopedQuery(tableName, tenantId).select('*')
 */
export function scopedQuery(table: string, tenantId: string) {
  return getSupabaseAdmin().from(table).select('*').eq('tenant_id', tenantId);
}

/**
 * Insert with automatic tenant_id injection.
 */
export function scopedInsert(table: string, tenantId: string, data: Record<string, unknown> | Record<string, unknown>[]) {
  const rows = Array.isArray(data)
    ? data.map((d) => ({ ...d, tenant_id: tenantId }))
    : { ...data, tenant_id: tenantId };
  return getSupabaseAdmin().from(table).insert(rows);
}
