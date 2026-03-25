import { getSupabaseAdmin } from './supabase.js';

interface AuditEntry {
  tenant_id: string;
  actor_type: 'system' | 'admin' | 'customer';
  actor_id: string;
  action: string;
  target: string;
  details_json: Record<string, unknown>;
}

/**
 * Write an audit log entry. Fire-and-forget by default.
 */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    const db = getSupabaseAdmin();
    await db.from('audit_logs').insert({
      ...entry,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    // Audit logging should never crash the main flow
    console.error('[AuditLog] Failed to write:', err);
  }
}

/**
 * Log a system error to the system_errors table.
 */
export async function logSystemError(
  tenantId: string,
  module: string,
  errorMessage: string,
  stackTrace?: string,
): Promise<void> {
  try {
    const db = getSupabaseAdmin();
    await db.from('system_errors').insert({
      tenant_id: tenantId,
      module,
      error_message: errorMessage,
      stack_trace: stackTrace || null,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[SystemError] Failed to log:', err);
  }
}
