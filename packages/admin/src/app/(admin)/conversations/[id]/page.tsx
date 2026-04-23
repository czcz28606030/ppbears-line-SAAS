'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '../../../../lib/api';
import { ArrowLeft, MessageSquare, User, Clock, Bot, UserCheck, Zap, X, Check, Plus, Tag } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  metadata_json?: { provider?: string; model?: string };
  corrected_at?: string | null;
  corrected_by?: string | null;
}

interface ConversationDetail {
  id: string;
  user_id: string;
  channel_type: string;
  status: string;
  started_at: string;
  last_message_at: string;
  users?: { display_name: string; unified_user_id: string };
}

interface ApiResponse {
  conversation: ConversationDetail;
  messages: Message[];
}

export default function ConversationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const conversationId = params.id as string;

  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ---- Tag management ----
  const [userTags, setUserTags] = useState<{ tag: string; source: string }[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [tagLoading, setTagLoading] = useState<string | null>(null);
  const tagPanelRef = useRef<HTMLDivElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  // 點擊外部關閉下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (tagPanelRef.current && !tagPanelRef.current.contains(e.target as Node)) {
        setTagDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  async function loadUserTags(userId: string) {
    try {
      const res = await apiFetch<{ tags: { tag: string; source: string }[] }>(`/api/admin/users/${userId}/tags`);
      setUserTags(res.tags);
    } catch {}
  }

  async function handleAddTag(tag: string) {
    if (!conv?.user_id || !tag.trim()) return;
    if (userTags.some(t => t.tag === tag)) { setTagInput(''); setTagDropdownOpen(false); return; }
    setTagLoading('add');
    try {
      await apiFetch(`/api/admin/users/${conv.user_id}/tags`, { method: 'POST', body: JSON.stringify({ tag: tag.trim() }) });
      setUserTags(prev => [...prev, { tag: tag.trim(), source: 'manual' }]);
      setAllTags(prev => prev.includes(tag.trim()) ? prev : [...prev, tag.trim()].sort());
      setTagInput('');
      setTagDropdownOpen(false);
    } catch (e: any) { alert('新增標籤失敗：' + e.message); }
    finally { setTagLoading(null); }
  }

  async function handleRemoveTag(tag: string) {
    if (!conv?.user_id) return;
    setTagLoading(tag);
    try {
      await apiFetch(`/api/admin/users/${conv.user_id}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' });
      setUserTags(prev => prev.filter(t => t.tag !== tag));
    } catch (e: any) { alert('刪除標籤失敗：' + e.message); }
    finally { setTagLoading(null); }
  }

  // Knowledge Correction Modal
  const [correctionTarget, setCorrectionTarget] = useState<{ userMsg: string; aiMsg: string; timestamp: string; messageId?: string } | null>(null);
  const [correctionText, setCorrectionText] = useState('');
  const [correctionLoading, setCorrectionLoading] = useState(false);
  const [correctionSuccess, setCorrectionSuccess] = useState(false);

  useEffect(() => {
    async function fetchDetail(silent = false) {
      if (!silent) setLoading(true);
      try {
        const data = await apiFetch<ApiResponse>(`/api/admin/conversations/${conversationId}`);
        setConv(data.conversation);
        setMessages(data.messages || []);
      } catch (err: any) {
        if (!silent) setError(err.message || '載入失敗');
      } finally {
        if (!silent) setLoading(false);
      }
    }
    
    if (conversationId) {
      fetchDetail();
      const interval = setInterval(() => fetchDetail(true), 5000);
      return () => clearInterval(interval);
    }
  }, [conversationId]);

  // 載入標籤：在 conv 載入完成後才執行
  useEffect(() => {
    if (!conv?.user_id) return;
    loadUserTags(conv.user_id);
    apiFetch<{ tags: string[] }>('/api/admin/tags')
      .then(res => setAllTags(res.tags))
      .catch(() => {});
  }, [conv?.user_id]);

  const statusBadge: Record<string, string> = { active: 'badge-success', live_agent: 'badge-live', closed: 'badge-muted' };
  const statusLabel: Record<string, string> = { active: '進行中', live_agent: '真人接管', closed: '已結束' };
  const channelEmoji: Record<string, string> = { line: '💬 LINE', messenger: '📘 FB', whatsapp: '💚 WA' };

  const handleOpenCorrection = (aiMsg: Message, index: number) => {
    let prevUserMsg = '';
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        prevUserMsg = messages[i].content;
        break;
      }
    }
    setCorrectionTarget({
      userMsg: prevUserMsg,
      aiMsg: aiMsg.content,
      timestamp: aiMsg.created_at,
      messageId: aiMsg.id,
    });
    setCorrectionText('');
    setCorrectionSuccess(false);
  };

  const handleSubmitCorrection = async () => {
    if (!correctionTarget || !correctionText.trim()) return;
    setCorrectionLoading(true);
    try {
      const content = `【情境】：客戶詢問「${correctionTarget.userMsg || '(無前文)'}」\n【原本回覆】：${correctionTarget.aiMsg}\n\n【正確處理方式 / 知識點】：\n${correctionText.trim()}`;
      
      const payload = {
        filename: `對話修正_${new Date(correctionTarget.timestamp).getTime()}_${Math.floor(Math.random() * 1000)}.txt`,
        content,
        category: 'manual_correction',
      };

      await apiFetch('/api/admin/knowledge/upload-text', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      // Mark message as corrected in DB and update local state immediately
      if (correctionTarget.messageId) {
        const result = await apiFetch<{ success: boolean; corrected_at: string }>(
          `/api/admin/messages/${correctionTarget.messageId}/correct`,
          { method: 'PATCH' }
        );
        setMessages(prev =>
          prev.map(m =>
            m.id === correctionTarget.messageId
              ? { ...m, corrected_at: result.corrected_at }
              : m
          )
        );
      }
      
      setCorrectionSuccess(true);
      setTimeout(() => {
        setCorrectionTarget(null);
      }, 1500);
    } catch (e: any) {
      alert(`存入失敗: ${e.message}`);
    } finally {
      setCorrectionLoading(false);
    }
  };

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">💬 對話詳情</span>
        <div className="topbar-right">
          <div className="topbar-avatar">A</div>
        </div>
      </div>

      <div className="page-content">
        <button className="btn btn-ghost btn-sm" style={{ marginBottom: 16 }} onClick={() => router.back()}>
          <ArrowLeft size={14} /> 返回列表
        </button>

        {loading && <div className="loading-center"><div className="loading-spinner" /></div>}

        {error && (
          <div className="empty-state">
            <p style={{ color: 'var(--danger)' }}>⚠️ {error}</p>
          </div>
        )}

        {conv && (
          <>
            {/* Conversation Info Card */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 4 }}>用戶</div>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <User size={14} />
                    {conv.users?.display_name || conv.users?.unified_user_id || '匿名用戶'}
                  </div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 4 }}>通路</div>
                  <div style={{ fontWeight: 600 }}>{channelEmoji[conv.channel_type] || conv.channel_type}</div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 4 }}>狀態</div>
                  <span className={`badge ${statusBadge[conv.status] || 'badge-muted'}`}>
                    <span className="badge-dot" />
                    {statusLabel[conv.status] || conv.status}
                  </span>
                </div>
                <div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 4 }}>開始時間</div>
                  <div style={{ fontSize: 13 }}>{new Date(conv.started_at).toLocaleString('zh-TW')}</div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 4 }}>最後訊息</div>
                  <div style={{ fontSize: 13 }}>{new Date(conv.last_message_at).toLocaleString('zh-TW')}</div>
                </div>

                {/* Tag editor */}
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Tag size={11} /> 客戶標籤
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {userTags.map(t => (
                      <span key={t.tag} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '3px 10px', borderRadius: 100, fontSize: 12, fontWeight: 600,
                        background: t.source === 'manual' ? '#6366f1' : '#10b981',
                        color: '#fff',
                      }}>
                        {t.tag}
                        <button
                          onClick={() => handleRemoveTag(t.tag)}
                          disabled={tagLoading === t.tag}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#fff', opacity: 0.7, display: 'flex', lineHeight: 1 }}
                        >
                          {tagLoading === t.tag
                            ? <span style={{ fontSize: 10 }}>...</span>
                            : <X size={11} />}
                        </button>
                      </span>
                    ))}

                    {/* Add tag button + dropdown */}
                    <div ref={tagPanelRef} style={{ position: 'relative' }}>
                      {tagDropdownOpen ? (
                        <form onSubmit={e => { e.preventDefault(); handleAddTag(tagInput); }} style={{ display: 'flex', gap: 4 }}>
                          <input
                            ref={tagInputRef}
                            autoFocus
                            value={tagInput}
                            onChange={e => setTagInput(e.target.value)}
                            placeholder="搜尋或輸入新標籤…"
                            style={{
                              width: 150, padding: '3px 8px', borderRadius: 6, fontSize: 12,
                              border: '1px solid rgba(108,99,255,0.5)', background: '#1a1d35', color: '#f0f0ff',
                            }}
                          />
                          <button type="submit" disabled={!tagInput.trim() || tagLoading === 'add'}
                            style={{ background: '#6c63ff', border: 'none', borderRadius: 6, color: '#fff', padding: '3px 10px', cursor: 'pointer', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 3 }}
                          >
                            <Plus size={11} /> 新增
                          </button>
                        </form>
                      ) : (
                        <button
                          onClick={() => { setTagDropdownOpen(true); setTimeout(() => tagInputRef.current?.focus(), 50); }}
                          style={{
                            background: 'rgba(108,99,255,0.15)', border: '1px dashed rgba(108,99,255,0.5)',
                            borderRadius: 100, color: '#8b85ff', padding: '3px 10px',
                            cursor: 'pointer', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}
                        >
                          <Plus size={11} /> 加標籤
                        </button>
                      )}

                      {/* Existing tags dropdown */}
                      {tagDropdownOpen && (() => {
                        const currentSet = new Set(userTags.map(t => t.tag));
                        const filtered = allTags.filter(t =>
                          !currentSet.has(t) &&
                          (tagInput === '' || t.toLowerCase().includes(tagInput.toLowerCase()))
                        );
                        if (!filtered.length) return null;
                        return (
                          <div style={{
                            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 999,
                            background: '#13152b', border: '1px solid rgba(108,99,255,0.4)',
                            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                            minWidth: 170, maxHeight: 220, overflowY: 'auto',
                          }}>
                            <div style={{ padding: '6px 10px', fontSize: 10, color: '#5a5d82', fontWeight: 600, letterSpacing: 1 }}>選擇既有標籤</div>
                            {filtered.map(t => (
                              <div key={t} onClick={() => handleAddTag(t)}
                                style={{ padding: '7px 12px', fontSize: 13, cursor: 'pointer', color: '#f0f0ff', display: 'flex', alignItems: 'center', gap: 6 }}
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
                  </div>
                </div>
              </div>
            </div>

            {/* Message Thread */}
            <div className="card">
              <div className="card-header">
                <MessageSquare size={16} />
                <span>訊息記錄（{messages.length} 則）</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
                {messages.length === 0 && (
                  <div className="empty-state"><p>暫無訊息記錄</p></div>
                )}
                {messages.map((msg: Message, i: number) => (
                  <div
                    key={msg.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginBottom: 4,
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                    }}>
                      {msg.role === 'user' ? <User size={11} /> : <Bot size={11} />}
                      <span>{msg.role === 'user' ? '客戶' : 'AI 客服'}</span>
                      <span>·</span>
                      <span>{new Date(msg.created_at).toLocaleString('zh-TW')}</span>
                      {msg.metadata_json?.model && (
                        <span style={{ opacity: 0.6 }}>· {msg.metadata_json.model}</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                      <div style={{
                        maxWidth: '600px',
                        padding: '10px 14px',
                        borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                        background: msg.role === 'user' ? '#3b82f622' : '#6b728022',
                        color: msg.role === 'user' ? '#60a5fa' : 'var(--text-muted)',
                        border: `1px solid ${msg.role === 'user' ? '#3b82f644' : '#6b728044'}`,
                        fontSize: 14,
                        lineHeight: 1.6,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}>
                        {msg.content}
                      </div>

                      {msg.role === 'assistant' && !msg.corrected_at && (
                        <button
                          onClick={() => handleOpenCorrection(msg, i)}
                          title="修正回覆並存入知識庫"
                          style={{
                            background: 'none', border: 'none', padding: 6, cursor: 'pointer',
                            color: 'var(--text-muted)', opacity: 0.6, marginTop: 4,
                          }}
                          onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                          onMouseLeave={e => e.currentTarget.style.opacity = '0.6'}
                        >
                          <Zap size={16} />
                        </button>
                      )}
                      {msg.role === 'assistant' && msg.corrected_at && (
                        <div
                          title={`由 ${msg.corrected_by || '管理員'} 於 ${new Date(msg.corrected_at).toLocaleString('zh-TW')} 修正`}
                          style={{ marginTop: 6, fontSize: 11, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 4, opacity: 0.85 }}
                        >
                          <Zap size={10} />
                          已加入知識庫
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Correction Modal Overlay */}
      {correctionTarget && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)', padding: 16
        }}>
          <div className="card" style={{
            width: '100%', maxWidth: 500, padding: 24, position: 'relative',
            display: 'flex', flexDirection: 'column', gap: 16
          }}>
            <button
              onClick={() => setCorrectionTarget(null)}
              style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
            <h2 style={{ fontSize: 18, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Zap size={20} style={{ color: '#fbbf24' }} /> 修正 AI 回覆 (存入知識庫)
            </h2>
            
            <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--background)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
              {correctionTarget.userMsg && (
                <div style={{ marginBottom: 8 }}>
                  <strong>客：</strong> {correctionTarget.userMsg}
                </div>
              )}
              <div>
                <strong>AI 原本：</strong> {correctionTarget.aiMsg}
              </div>
            </div>

            {correctionSuccess ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#10b981', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <div style={{ background: '#10b98122', padding: 12, borderRadius: '50%' }}>
                  <Check size={32} />
                </div>
                <div style={{ fontWeight: 600 }}>已儲存至知識庫！自動關閉中...</div>
              </div>
            ) : (
              <>
                <div>
                  <div style={{ fontSize: 13, marginBottom: 6, fontWeight: 600 }}>請輸入期望的正確回答或處理方針：</div>
                  <textarea
                    value={correctionText}
                    onChange={e => setCorrectionText(e.target.value)}
                    placeholder="下次有人這樣問時，我希望 AI 回..."
                    style={{
                      width: '100%', height: 120, padding: 12, borderRadius: 8,
                      border: '1px solid var(--border)', background: 'var(--background)',
                      color: 'var(--text)', fontSize: 14, resize: 'vertical',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                  <button
                    onClick={() => setCorrectionTarget(null)}
                    disabled={correctionLoading}
                    style={{
                      padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)',
                      background: 'transparent', color: 'var(--text)', cursor: 'pointer'
                    }}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSubmitCorrection}
                    disabled={correctionLoading || !correctionText.trim()}
                    style={{
                      padding: '8px 16px', borderRadius: 8, border: 'none',
                      background: '#fbbf24', color: '#000', fontWeight: 600, cursor: 'pointer',
                      opacity: correctionLoading || !correctionText.trim() ? 0.6 : 1,
                      display: 'flex', alignItems: 'center', gap: 6
                    }}
                  >
                    {correctionLoading ? '儲存中...' : '送出至知識庫'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
