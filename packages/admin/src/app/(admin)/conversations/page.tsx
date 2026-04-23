'use client';

import { useEffect, useState, useRef } from 'react';
import { apiFetch } from '../../../lib/api';
import { MessageSquare, Eye, Headphones, Bot, Loader2, Plus, X } from 'lucide-react';

interface Conversation {
  id: string;
  user_id: string;
  channel_type: string;
  status: string;
  is_permanent?: boolean;
  last_message_at: string;
  started_at: string;
  users?: { display_name: string; unified_user_id: string };
  user_tags?: { tag: string; source: string }[];
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

  // ---- Tag management ----
  const [allTags, setAllTags] = useState<string[]>([]);
  const [editingTagsFor, setEditingTagsFor] = useState<string | null>(null);
  const [newTagInput, setNewTagInput] = useState('');
  const [tagLoading, setTagLoading] = useState<string | null>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);

  // 載入所有既有標籤（用於下拉選擇）
  useEffect(() => {
    apiFetch<{ tags: string[] }>('/api/admin/tags')
      .then(res => setAllTags(res.tags))
      .catch(() => {});
  }, []);

  // 點擊外部關閉標籤下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setEditingTagsFor(null);
        setNewTagInput('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  async function handleAddTag(convId: string, userId: string, tagOverride?: string) {
    const tag = (tagOverride ?? newTagInput).trim();
    if (!tag) return;
    // 不重複加
    const conv = conversations.find(c => c.id === convId);
    if (conv?.user_tags?.some(t => t.tag === tag)) {
      setNewTagInput('');
      return;
    }
    setTagLoading(convId);
    try {
      await apiFetch(`/api/admin/users/${userId}/tags`, { method: 'POST', body: JSON.stringify({ tag }) });
      setConversations(prev => prev.map(c =>
        c.id === convId
          ? { ...c, user_tags: [...(c.user_tags || []), { tag, source: 'manual' }] }
          : c
      ));
      // 若是新標籤，加入全域清單
      setAllTags(prev => prev.includes(tag) ? prev : [...prev, tag].sort());
      setNewTagInput('');
      if (!tagOverride) setEditingTagsFor(null);
    } catch (err: any) { alert('新增標籤失敗：' + err.message); }
    finally { setTagLoading(null); }
  }

  async function handleRemoveTag(convId: string, userId: string, tag: string) {
    setTagLoading(convId + tag);
    try {
      await apiFetch(`/api/admin/users/${userId}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' });
      setConversations(prev => prev.map(c =>
        c.id === convId
          ? { ...c, user_tags: (c.user_tags || []).filter(t => t.tag !== tag) }
          : c
      ));
    } catch (err: any) { alert('刪除標籤失敗：' + err.message); }
    finally { setTagLoading(null); }
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
                  <th>狀態</th>                  <th>標籤</th>                  <th>最後訊息</th>
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

                    {/* Tags cell */}
                    <td style={{ minWidth: 160, maxWidth: 260 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                        {(conv.user_tags || []).map((t) => (
                          <span
                            key={t.tag}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3,
                              padding: '2px 8px', borderRadius: 100, fontSize: 11, fontWeight: 600,
                              background: t.source === 'manual' ? '#6366f1' : '#10b981',
                              color: '#fff',
                            }}
                          >
                            {t.tag}
                            <button
                              onClick={() => handleRemoveTag(conv.id, conv.user_id, t.tag)}
                              disabled={tagLoading === conv.id + t.tag}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#fff', opacity: 0.7, display: 'flex', lineHeight: 1 }}
                            >
                              {tagLoading === conv.id + t.tag
                                ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
                                : <X size={10} />}
                            </button>
                          </span>
                        ))}
                        {editingTagsFor === conv.id ? (
                          <div ref={tagDropdownRef} style={{ position: 'relative' }}>
                            {/* 搜尋 / 輸入框 */}
                            <form
                              onSubmit={(e) => { e.preventDefault(); handleAddTag(conv.id, conv.user_id); }}
                              style={{ display: 'flex', gap: 4 }}
                            >
                              <input
                                ref={tagInputRef}
                                autoFocus
                                value={newTagInput}
                                onChange={(e) => setNewTagInput(e.target.value)}
                                placeholder="搜尋或輸入新標籤…"
                                style={{
                                  width: 140, padding: '3px 8px', borderRadius: 6, fontSize: 11,
                                  border: '1px solid rgba(108,99,255,0.5)', background: '#1a1d35', color: '#f0f0ff',
                                }}
                              />
                              <button type="submit" disabled={!newTagInput.trim() || tagLoading === conv.id}
                                style={{ background: '#6c63ff', border: 'none', borderRadius: 6, color: '#fff', padding: '3px 8px', cursor: 'pointer', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3 }}
                              >
                                {tagLoading === conv.id ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={10} />}
                                新增
                              </button>
                            </form>

                            {/* 下拉：既有標籤（過濾已套用 + 依輸入篩選）*/}
                            {(() => {
                              const currentTags = new Set((conv.user_tags || []).map(t => t.tag));
                              const filtered = allTags.filter(t =>
                                !currentTags.has(t) &&
                                (newTagInput === '' || t.toLowerCase().includes(newTagInput.toLowerCase()))
                              );
                              if (filtered.length === 0) return null;
                              return (
                                <div style={{
                                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 999,
                                  background: '#13152b', border: '1px solid rgba(108,99,255,0.4)',
                                  borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                                  minWidth: 160, maxHeight: 200, overflowY: 'auto',
                                }}>
                                  <div style={{ padding: '6px 10px', fontSize: 10, color: '#5a5d82', fontWeight: 600, letterSpacing: 1 }}>選擇既有標籤</div>
                                  {filtered.map(t => (
                                    <div
                                      key={t}
                                      onClick={() => handleAddTag(conv.id, conv.user_id, t)}
                                      style={{
                                        padding: '7px 12px', fontSize: 12, cursor: 'pointer',
                                        color: '#f0f0ff', display: 'flex', alignItems: 'center', gap: 6,
                                      }}
                                      onMouseEnter={e => e.currentTarget.style.background = '#1f2340'}
                                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                    >
                                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#6c63ff', flexShrink: 0 }} />
                                      {t}
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingTagsFor(conv.id); setNewTagInput(''); }}
                            title="新增標籤"
                            style={{
                              background: 'rgba(108,99,255,0.2)', border: '1px dashed rgba(108,99,255,0.5)',
                              borderRadius: 100, color: '#8b85ff', padding: '2px 6px',
                              cursor: 'pointer', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3,
                            }}
                          >
                            <Plus size={10} /> 標籤
                          </button>
                        )}
                      </div>
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

