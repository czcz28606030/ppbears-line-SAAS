'use client';

import React, { useEffect, useState, useRef } from 'react';
import { apiFetch } from '../../../lib/api';
import { MessageSquare, Eye, Headphones, Bot, Loader2, Plus, X, Send, UserCheck, Filter } from 'lucide-react';

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
  const [tagFilter, setTagFilter] = useState('');
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const tagFilterRef = useRef<HTMLDivElement>(null);
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

  // ---- Inline reply ----
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [senderType, setSenderType] = useState<'human' | 'ai'>('human');
  const [replySending, setReplySending] = useState(false);

  // 點擊外部關閉 tag filter 下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (tagFilterRef.current && !tagFilterRef.current.contains(e.target as Node)) {
        setTagFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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

  async function handleSendReplyInline(convId: string) {
    if (!replyText.trim() || replySending) return;
    setReplySending(true);
    try {
      await apiFetch(`/api/admin/conversations/${convId}/send`, {
        method: 'POST',
        body: JSON.stringify({ content: replyText.trim(), sender_type: senderType }),
      });
      setReplyText('');
      setReplyingTo(null);
    } catch (err: any) { alert('發送失敗：' + err.message); }
    finally { setReplySending(false); }
  }

  // 依標籤篩選（client-side）
  const filteredConversations = tagFilter
    ? conversations.filter(c => (c.user_tags || []).some(t => t.tag === tagFilter))
    : conversations;

  const channelEmoji: Record<string, string> = { line: '💬 LINE', messenger: '📘 FB', whatsapp: '💚 WA' };


  return (
    <>
      <div className="topbar">
        <span className="topbar-title">💬 對話紀錄</span>
        <div className="topbar-right">
          {/* 狀態篩選 */}
          <select className="form-select" style={{ width: 140 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">全部狀態</option>
            <option value="active">進行中</option>
            <option value="live_agent">真人接管</option>
            <option value="closed">已結束</option>
          </select>

          {/* 標籤篩選（自製深色下拉）*/}
          <div ref={tagFilterRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setTagFilterOpen(o => !o)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                border: tagFilter ? '1px solid #6c63ff' : '1px solid rgba(255,255,255,0.12)',
                background: tagFilter ? 'rgba(108,99,255,0.2)' : '#1a1d35',
                color: tagFilter ? '#8b85ff' : '#9b9ec8', fontSize: 13,
                minWidth: 130,
              }}
            >
              <Filter size={13} />
              <span style={{ flex: 1, textAlign: 'left' }}>{tagFilter || '標籤篩選'}</span>
              <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
            </button>

            {tagFilterOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 1000,
                background: '#13152b', border: '1px solid rgba(108,99,255,0.4)',
                borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                minWidth: 180, maxHeight: 280, overflowY: 'auto',
              }}>
                <div
                  onClick={() => { setTagFilter(''); setTagFilterOpen(false); }}
                  style={{
                    padding: '8px 14px', fontSize: 13, cursor: 'pointer',
                    color: tagFilter === '' ? '#6c63ff' : '#f0f0ff',
                    fontWeight: tagFilter === '' ? 700 : 400,
                    background: tagFilter === '' ? 'rgba(108,99,255,0.15)' : 'transparent',
                  }}
                  onMouseEnter={e => { if (tagFilter !== '') e.currentTarget.style.background = '#1f2340'; }}
                  onMouseLeave={e => { if (tagFilter !== '') e.currentTarget.style.background = 'transparent'; }}
                >
                  全部標籤
                </div>
                {allTags.map(t => (
                  <div
                    key={t}
                    onClick={() => { setTagFilter(t); setTagFilterOpen(false); }}
                    style={{
                      padding: '8px 14px', fontSize: 13, cursor: 'pointer',
                      color: tagFilter === t ? '#6c63ff' : '#f0f0ff',
                      fontWeight: tagFilter === t ? 700 : 400,
                      background: tagFilter === t ? 'rgba(108,99,255,0.15)' : 'transparent',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}
                    onMouseEnter={e => { if (tagFilter !== t) e.currentTarget.style.background = '#1f2340'; }}
                    onMouseLeave={e => { if (tagFilter !== t) e.currentTarget.style.background = tagFilter === t ? 'rgba(108,99,255,0.15)' : 'transparent'; }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#6c63ff', flexShrink: 0 }} />
                    {t}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="topbar-avatar">A</div>
        </div>
      </div>

      <div className="page-content">
        <div className="section-header">
          <div>
            <div className="section-title">對話紀錄</div>
            <div className="section-subtitle">
              {tagFilter
                ? `標籤「${tagFilter}」共 ${filteredConversations.length} 筆（全部 ${total} 筆）`
                : `共 ${total} 筆對話`}
            </div>
          </div>
          {tagFilter && (
            <button
              onClick={() => setTagFilter('')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                borderRadius: 8, border: '1px solid rgba(108,99,255,0.4)', background: 'rgba(108,99,255,0.1)',
                color: '#8b85ff', cursor: 'pointer', fontSize: 13,
              }}
            >
              <X size={13} /> 清除篩選：{tagFilter}
            </button>
          )}
        </div>

        <div className="data-table-wrapper">
          {loading ? (
            <div className="loading-center"><div className="loading-spinner" /></div>
          ) : filteredConversations.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><MessageSquare size={40} /></div>
              <p>{tagFilter ? `沒有標籤「${tagFilter}」的對話` : '目前沒有對話紀錄'}</p>
              {tagFilter && <p className="text-xs">試著選擇其他標籤或清除篩選</p>}
              {!tagFilter && <p className="text-xs">完成 LINE 設定後，客戶訊息將顯示於此</p>}
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
                {filteredConversations.map((conv) => (
                  <React.Fragment key={conv.id}>
                    <tr>
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
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        {/* View button */}
                        <a href={`/conversations/${conv.id}`} className="btn btn-ghost btn-sm">
                          <Eye size={13} /> 查看
                        </a>

                        {/* 回覆按鈕 */}
                        <button
                          onClick={() => {
                            if (replyingTo === conv.id) {
                              setReplyingTo(null);
                              setReplyText('');
                            } else {
                              setReplyingTo(conv.id);
                              setReplyText('');
                            }
                          }}
                          style={{
                            background: replyingTo === conv.id ? 'rgba(245,158,11,0.2)' : 'rgba(245,158,11,0.1)',
                            border: `1px solid ${replyingTo === conv.id ? '#f59e0b' : 'rgba(245,158,11,0.4)'}`,
                            color: '#f59e0b', borderRadius: 8, padding: '5px 10px',
                            cursor: 'pointer', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5,
                          }}
                        >
                          <Send size={12} /> {replyingTo === conv.id ? '收起' : '回覆'}
                        </button>

                        {/* Takeover / Release toggle */}
                        {conv.status === 'active' && (
                          <>
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

                  {/* Inline reply panel */}
                  {replyingTo === conv.id && (
                    <tr key={conv.id + '_reply'} style={{ background: 'rgba(245,158,11,0.04)' }}>
                      <td colSpan={6} style={{ padding: '12px 20px', borderTop: '1px solid rgba(245,158,11,0.15)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {/* 發送身份切換 */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 12, color: '#5a5d82' }}>發送身份：</span>
                            <button
                              onClick={() => setSenderType('human')}
                              style={{
                                padding: '3px 10px', borderRadius: 100, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
                                background: senderType === 'human' ? '#f59e0b' : 'rgba(245,158,11,0.12)',
                                color: senderType === 'human' ? '#1a1d35' : '#f59e0b',
                              }}
                            >
                              <UserCheck size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                              人工客服
                            </button>
                            <button
                              onClick={() => setSenderType('ai')}
                              style={{
                                padding: '3px 10px', borderRadius: 100, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
                                background: senderType === 'ai' ? '#6c63ff' : 'rgba(108,99,255,0.12)',
                                color: senderType === 'ai' ? '#fff' : '#8b85ff',
                              }}
                            >
                              <Bot size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                              AI 客服
                            </button>
                            <span style={{ fontSize: 11, color: '#5a5d82', marginLeft: 8 }}>
                              回覆給：{conv.users?.display_name || conv.users?.unified_user_id || '匿名用戶'}
                              ・{channelEmoji[conv.channel_type] || conv.channel_type}
                            </span>
                          </div>

                          {/* 輸入 + 送出 */}
                          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                            <textarea
                              autoFocus
                              value={replyText}
                              onChange={e => setReplyText(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                  e.preventDefault();
                                  handleSendReplyInline(conv.id);
                                }
                              }}
                              placeholder={`以「${senderType === 'human' ? '人工客服' : 'AI 客服'}」身份回覆… (Ctrl+Enter 送出)`}
                              rows={2}
                              style={{
                                flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 13,
                                border: `1px solid ${senderType === 'human' ? 'rgba(245,158,11,0.5)' : 'rgba(108,99,255,0.5)'}`,
                                background: '#13152b', color: '#f0f0ff', resize: 'vertical', lineHeight: 1.5, outline: 'none',
                              }}
                            />
                            <button
                              onClick={() => handleSendReplyInline(conv.id)}
                              disabled={!replyText.trim() || replySending}
                              style={{
                                padding: '8px 16px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13,
                                background: senderType === 'human'
                                  ? (replyText.trim() && !replySending ? '#f59e0b' : '#f59e0b44')
                                  : (replyText.trim() && !replySending ? '#6c63ff' : '#6c63ff44'),
                                color: '#fff', cursor: replyText.trim() && !replySending ? 'pointer' : 'not-allowed',
                                display: 'flex', alignItems: 'center', gap: 6, height: 'fit-content',
                              }}
                            >
                              {replySending
                                ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                                : <Send size={13} />}
                              {replySending ? '送出中…' : '送出'}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
            </table>
          )}
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

