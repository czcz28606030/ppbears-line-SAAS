'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { Headphones, UserCheck, Clock, RefreshCw } from 'lucide-react';

interface LiveSession {
  id: string;
  reason: string;
  started_at: string;
  expires_at: string;
  users?: { display_name: string; unified_user_id: string };
}

export default function LiveAgentPage() {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchSessions() {
    setLoading(true);
    try {
      const data = await apiFetch<{ sessions: LiveSession[] }>('/api/admin/live-agent');
      setSessions(data.sessions);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function release(id: string) {
    if (!confirm('確定要結束此真人客服 session？')) return;
    try {
      await apiFetch(`/api/admin/live-agent/${id}`, { method: 'DELETE' });
      fetchSessions();
    } catch (err: any) { alert(err.message); }
  }

  useEffect(() => { fetchSessions(); }, []);

  const timeRemaining = (expiresAt: string) => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return '已過期';
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    return `${hrs}h ${mins}m`;
  };

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">🎧 真人客服管理</span>
        <div className="topbar-right">
          <button className="btn btn-ghost btn-sm" onClick={fetchSessions}><RefreshCw size={14} /></button>
          <div className="topbar-avatar">A</div>
        </div>
      </div>

      <div className="page-content">
        <div className="section-header">
          <div>
            <div className="section-title">進行中的真人接管</div>
            <div className="section-subtitle">Bot 在這些 session 期間保持靜默</div>
          </div>
          <div className="flex-row">
            <div className="stat-card" style={{ padding: '12px 20px', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Headphones size={20} color="var(--status-live)" />
              <div>
                <div className="stat-value" style={{ fontSize: 24, color: 'var(--status-live)' }}>{sessions.length}</div>
                <div className="stat-label">進行中</div>
              </div>
            </div>
          </div>
        </div>

        <div className="data-table-wrapper">
          {loading ? (
            <div className="loading-center"><div className="loading-spinner" /></div>
          ) : sessions.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><UserCheck size={40} /></div>
              <p>目前沒有進行中的真人客服 session</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>用戶</th>
                  <th>觸發原因</th>
                  <th>開始時間</th>
                  <th>剩餘時間</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      <div className="flex-row gap-sm">
                        <span className="live-dot" />
                        {s.users?.display_name || s.users?.unified_user_id || '未知用戶'}
                      </div>
                    </td>
                    <td className="text-sm">{s.reason}</td>
                    <td className="text-sm">{new Date(s.started_at).toLocaleString('zh-TW')}</td>
                    <td>
                      <span className="badge badge-warning">
                        <Clock size={10} /> {timeRemaining(s.expires_at)}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-danger btn-sm" onClick={() => release(s.id)}>結束接管</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card" style={{ marginTop: 'var(--space-lg)', background: 'rgba(255,101,132,0.05)', borderColor: 'rgba(255,101,132,0.2)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--status-live)' }}>📌 觸發詞設定</div>
          <div className="flex-row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {['真人', '轉真人', '我要找客服', '有人嗎', '客服處理'].map(phrase => (
              <span key={phrase} className="badge badge-live">{phrase}</span>
            ))}
          </div>
          <p className="text-muted text-xs" style={{ marginTop: 8 }}>客戶傳送上述詞語時，Bot 將靜默 24 小時</p>
        </div>
      </div>
    </>
  );
}
