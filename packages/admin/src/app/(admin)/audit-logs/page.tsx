'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { ClipboardList } from 'lucide-react';

interface AuditLog {
  id: string;
  actor_type: string;
  actor_id: string;
  action: string;
  target: string;
  details_json: Record<string, unknown>;
  created_at: string;
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ logs: AuditLog[] }>('/api/admin/audit-logs')
      .then(d => setLogs(d.logs))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const actorColor: Record<string, string> = { admin: 'badge-warning', system: 'badge-info', customer: 'badge-muted' };

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">📋 稽核日誌</span>
        <div className="topbar-right"><div className="topbar-avatar">A</div></div>
      </div>
      <div className="page-content">
        <div className="section-header">
          <div>
            <div className="section-title">稽核日誌</div>
            <div className="section-subtitle">所有敏感操作的追蹤紀錄</div>
          </div>
        </div>
        <div className="data-table-wrapper">
          {loading ? (
            <div className="loading-center"><div className="loading-spinner" /></div>
          ) : logs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><ClipboardList size={40} /></div>
              <p>暫無稽核紀錄</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>時間</th>
                  <th>執行者</th>
                  <th>動作</th>
                  <th>目標</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="text-sm">{new Date(log.created_at).toLocaleString('zh-TW')}</td>
                    <td>
                      <span className={`badge ${actorColor[log.actor_type] || 'badge-muted'}`}>{log.actor_type}</span>
                      <span className="text-xs text-muted" style={{ marginLeft: 8 }}>{log.actor_id.slice(0, 16)}…</span>
                    </td>
                    <td style={{ color: 'var(--text-primary)', fontWeight: 500, fontFamily: 'monospace', fontSize: 13 }}>{log.action}</td>
                    <td className="text-sm">{log.target}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
