'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { MessageSquare, Eye, Headphones, Bot, Loader2 } from 'lucide-react';

interface Conversation {
  id: string;
  channel_type: string;
  status: string;
  is_permanent?: boolean;
  last_message_at: string;
  started_at: string;
  users?: { display_name: string; unified_user_id: string };
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [toggling, setToggling] = useState<Record<string, boolean>>({});

  async function fetchConversations(silent = false) {
    if (!silent) setLoading(true);
    try {
      const params = statusFilter ? `?status=${statusFilter}` : '';
      const data = await apiFetch<{ conversations: Conversation[]; total: number }>(`/api/admin/conversations${params}`);
      setConversations(data.conversations);
      setTotal(data.total);
    } catch (err) { console.error(err); }
    finally { if (!silent) setLoading(false); }
  }

  useEffect(() => { 
    fetchConversations();
    const interval = setInterval(() => fetchConversations(true), 5000);
    return () => clearInterval(interval);
  }, [statusFilter]);

  async function handleTakeover(convId: string) {
    setToggling(t => ({ ...t, [convId]: true }));
    try {
      await apiFetch(`/api/admin/conversations/${convId}/takeover`, { method: 'POST', body: JSON.stringify({ permanent: false }) });
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, status: 'live_agent' } : c));
    } catch (err: any) { alert('接管失敗：' + err.message); }
    finally { setToggling(t => ({ ...t, [convId]: false })); }
  }

  async function handlePermanentTakeover(convId: string) {
    if (!confirm('確定要永久接管此對話？\nAI 將不再自動回覆，直到您手動點擊「還給AI」為止。')) return;
    setToggling(t => ({ ...t, [convId + '_perm']: true }));
    try {
      await apiFetch(`/api/admin/conversations/${convId}/takeover`, { method: 'POST', body: JSON.stringify({ permanent: true }) });
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, status: 'live_agent', is_permanent: true } : c));
    } catch (err: any) { alert('永久接管失敗：' + err.message); }
    finally { setToggling(t => ({ ...t, [convId + '_perm']: false })); }
  }

  async function handleRelease(convId: string) {
    setToggling(t => ({ ...t, [convId]: true }));
    try {
      await apiFetch(`/api/admin/conversations/${convId}/release`, { method: 'POST', body: '{}' });
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, status: 'active' } : c));
    } catch (err: any) { alert('還原失敗：' + err.message); }
    finally { setToggling(t => ({ ...t, [convId]: false })); }
  }

  const channelEmoji: Record<string, string> = { line: '💬 LINE', messenger: '📘 FB', whatsapp: '💚 WA' };


  return (
    <>
      <div className="topbar">
        <span className="topbar-title">💬 對話紀錄</span>
        <div className="topbar-right">
          <select className="form-select" style={{ width: 140 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">全部狀態</option>
            <option value="active">進行中</option>
            <option value="live_agent">真人接管</option>
            <option value="closed">已結束</option>
          </select>
          <div className="topbar-avatar">A</div>
        </div>
      </div>

      <div className="page-content">
        <div className="section-header">
          <div>
            <div className="section-title">對話紀錄</div>
            <div className="section-subtitle">共 {total} 筆對話</div>
          </div>
        </div>

        <div className="data-table-wrapper">
          {loading ? (
            <div className="loading-center"><div className="loading-spinner" /></div>
          ) : conversations.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><MessageSquare size={40} /></div>
              <p>目前沒有對話紀錄</p>
              <p className="text-xs">完成 LINE 設定後，客戶訊息將顯示於此</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>用戶</th>
                  <th>通路</th>
                  <th>狀態</th>
                  <th>最後訊息</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((conv) => (
                  <tr key={conv.id}>
                    <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      {conv.users?.display_name || conv.users?.unified_user_id || '匿名用戶'}
                    </td>
                    <td>{channelEmoji[conv.channel_type] || conv.channel_type}</td>
                    <td>
                      {conv.status === 'live_agent' && conv.is_permanent ? (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          background: 'rgba(217,119,6,0.15)', color: '#d97706',
                          border: '1px solid rgba(217,119,6,0.3)',
                          borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 600,
                        }}>
                          🔒 永久接管
                        </span>
                      ) : conv.status === 'live_agent' ? (
                        <span className="badge badge-live">
                          <span className="badge-dot" />
                          真人接管
                        </span>
                      ) : conv.status === 'active' ? (
                        <span className="badge badge-success">
                          <span className="badge-dot" />
                          進行中
                        </span>
                      ) : (
                        <span className="badge badge-muted">
                          <span className="badge-dot" />
                          {conv.status === 'closed' ? '已結束' : conv.status}
                        </span>
                      )}
                    </td>

                    <td className="text-sm">{new Date(conv.last_message_at).toLocaleString('zh-TW')}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {/* View button */}
                        <a href={`/conversations/${conv.id}`} className="btn btn-ghost btn-sm">
                          <Eye size={13} /> 查看
                        </a>

                        {/* Takeover / Release toggle */}
                        {conv.status === 'active' && (
                          <>
                            {/* Temporary takeover (24h) */}
                            <button
                              className="btn btn-sm"
                              disabled={toggling[conv.id]}
                              onClick={() => handleTakeover(conv.id)}
                              title="接管 24 小時，到期後自動恢復 AI"
                              style={{
                                background: 'linear-gradient(135deg, #1e3a5f, #2563eb)',
                                color: '#fff', border: 'none', borderRadius: 8,
                                padding: '5px 10px', cursor: 'pointer',
                                display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12,
                                opacity: toggling[conv.id] ? 0.6 : 1,
                              }}
                            >
                              {toggling[conv.id]
                                ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                                : <Headphones size={12} />}
                              接管
                            </button>

                            {/* Permanent takeover (never expires) */}
                            <button
                              className="btn btn-sm"
                              disabled={toggling[conv.id + '_perm']}
                              onClick={() => handlePermanentTakeover(conv.id)}
                              title="永久接管，AI 永遠不會自動恢復，須手動點「還給AI」"
                              style={{
                                background: 'linear-gradient(135deg, #4a2e00, #d97706)',
                                color: '#fff', border: 'none', borderRadius: 8,
                                padding: '5px 10px', cursor: 'pointer',
                                display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12,
                                opacity: toggling[conv.id + '_perm'] ? 0.6 : 1,
                              }}
                            >
                              {toggling[conv.id + '_perm']
                                ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                                : <span style={{ fontSize: 11 }}>🔒</span>}
                              永久
                            </button>
                          </>
                        )}


                        {conv.status === 'live_agent' && (
                          <button
                            className="btn btn-sm"
                            disabled={toggling[conv.id]}
                            onClick={() => handleRelease(conv.id)}
                            style={{
                              background: 'linear-gradient(135deg, #3a1f1f, #dc2626)',
                              color: '#fff', border: 'none', borderRadius: 8,
                              padding: '5px 10px', cursor: 'pointer',
                              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12,
                              opacity: toggling[conv.id] ? 0.6 : 1,
                            }}
                          >
                            {toggling[conv.id]
                              ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                              : <Bot size={12} />}
                            還給AI
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

