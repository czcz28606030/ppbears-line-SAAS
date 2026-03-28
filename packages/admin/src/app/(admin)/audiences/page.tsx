'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../../lib/api';
import { Tags, UserCircle, Plus, Trash2, Search, RefreshCw, Zap, X, Check } from 'lucide-react';
import Link from 'next/link';

interface UserRow {
  id: string;
  display_name: string;
  unified_user_id: string;
  tags: string[];
}

interface TagRow {
  tag: string;
  source: string;
  created_at: string;
}

interface MessageRow {
  role: string;
  content: string;
  created_at: string;
}

export default function AudiencesPage() {
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedTag, setSelectedTag] = useState('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  // For per-user tag management panel
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [userTags, setUserTags] = useState<TagRow[]>([]);
  const [convoMessages, setConvoMessages] = useState<MessageRow[]>([]);
  const [newTag, setNewTag] = useState('');
  const [tagActionLoading, setTagActionLoading] = useState(false);
  const [error, setError] = useState('');

  // Knowledge Correction Modal
  const [correctionTarget, setCorrectionTarget] = useState<{ userMsg: string; aiMsg: string; timestamp: string } | null>(null);
  const [correctionText, setCorrectionText] = useState('');
  const [correctionLoading, setCorrectionLoading] = useState(false);
  const [correctionSuccess, setCorrectionSuccess] = useState(false);

  const loadTags = useCallback(async () => {
    try {
      const res = await apiFetch<{ tags: string[] }>('/api/admin/tags');
      setAllTags(res.tags);
    } catch {}
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (selectedTag) params.set('tag', selectedTag);
      const res = await apiFetch<{ users: UserRow[]; total: number }>(
        `/api/admin/users?${params}`,
      );
      setUsers(res.users);
      setTotal(res.total);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedTag]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleExpandUser = async (userId: string) => {
    if (expandedUser === userId) {
      setExpandedUser(null);
      return;
    }
    setExpandedUser(userId);
    setConvoMessages([]);
    try {
      const [tagsRes, convoRes] = await Promise.all([
        apiFetch<{ tags: TagRow[] }>(`/api/admin/users/${userId}/tags`),
        apiFetch<{ messages: MessageRow[] }>(`/api/admin/users/${userId}/conversations`),
      ]);
      setUserTags(tagsRes.tags);
      setConvoMessages(convoRes.messages);
    } catch {}
  };

  const handleAddTag = async (userId: string) => {
    const tag = newTag.trim();
    if (!tag) return;
    setTagActionLoading(true);
    try {
      await apiFetch(`/api/admin/users/${userId}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tag }),
      });
      setNewTag('');
      const res = await apiFetch<{ tags: TagRow[] }>(`/api/admin/users/${userId}/tags`);
      setUserTags(res.tags);
      await loadTags();
      await loadUsers();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTagActionLoading(false);
    }
  };

  const handleRemoveTag = async (userId: string, tag: string) => {
    setTagActionLoading(true);
    try {
      await apiFetch(`/api/admin/users/${userId}/tags/${encodeURIComponent(tag)}`, {
        method: 'DELETE',
      });
      const res = await apiFetch<{ tags: TagRow[] }>(`/api/admin/users/${userId}/tags`);
      setUserTags(res.tags);
      await loadTags();
      await loadUsers();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTagActionLoading(false);
    }
  };

  const handleOpenCorrection = (aiMsg: MessageRow, index: number) => {
    // try to find the immediate previous user message as context
    let prevUserMsg = '';
    for (let i = index - 1; i >= 0; i--) {
      if (convoMessages[i].role === 'user') {
        prevUserMsg = convoMessages[i].content;
        break;
      }
    }
    setCorrectionTarget({
      userMsg: prevUserMsg,
      aiMsg: aiMsg.content,
      timestamp: aiMsg.created_at,
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
    <div style={{ padding: '24px', maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Tags size={28} style={{ color: 'var(--accent)' }} />
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>受眾管理</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 13 }}>
            依手機型號標籤篩選族群，可手動編輯標籤
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        className="card"
        style={{ padding: '16px 20px', marginBottom: 20, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <Search size={16} style={{ color: 'var(--text-muted)' }} />
        <select
          value={selectedTag}
          onChange={(e) => setSelectedTag(e.target.value)}
          style={{
            flex: 1, minWidth: 200, padding: '8px 12px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)',
            fontSize: 14,
          }}
        >
          <option value="">— 所有標籤（顯示全部用戶）—</option>
          {allTags.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <button
          onClick={loadUsers}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8, cursor: 'pointer', color: 'var(--text)', fontSize: 14,
          }}
        >
          <RefreshCw size={14} />
          重新整理
        </button>

        {selectedTag && (
          <Link
            href={`/broadcast?tag=${encodeURIComponent(selectedTag)}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
              background: 'var(--accent)', borderRadius: 8, color: '#fff',
              textDecoration: 'none', fontSize: 14, fontWeight: 600,
            }}
          >
            📢 發送推播
          </Link>
        )}
      </div>

      {/* Stats */}
      <div style={{ marginBottom: 16, color: 'var(--text-muted)', fontSize: 13 }}>
        {selectedTag
          ? `「${selectedTag}」族群共 ${total} 人`
          : `所有已標記用戶共 ${total} 位`}
      </div>

      {error && (
        <div className="card" style={{ padding: 12, marginBottom: 16, color: '#ef4444', border: '1px solid #ef444440', borderRadius: 8 }}>
          ⚠️ {error}
        </div>
      )}

      {/* User List */}
      {loading ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
          載入中…
        </div>
      ) : users.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <Tags size={40} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            {selectedTag ? `尚無「${selectedTag}」標籤的用戶` : '尚無任何標籤資料'}
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 8 }}>
            當客戶在對話中提到手機型號，系統會自動打標籤
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {users.map((u) => (
            <div key={u.id} className="card" style={{ overflow: 'hidden' }}>
              {/* User Row */}
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
                  cursor: 'pointer',
                }}
                onClick={() => handleExpandUser(u.id)}
              >
                <UserCircle size={36} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    {u.display_name || '未命名用戶'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.unified_user_id}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {u.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        padding: '3px 10px', borderRadius: 100, fontSize: 11, fontWeight: 600,
                        background: 'var(--accent)22', color: 'var(--accent)', border: '1px solid var(--accent)44',
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <span style={{ color: 'var(--text-muted)', fontSize: 12, flexShrink: 0 }}>
                  {expandedUser === u.id ? '▲' : '▼'}
                </span>
              </div>

              {/* Expanded Tag Editor */}
              {expandedUser === u.id && (
                <div
                  style={{
                    borderTop: '1px solid var(--border)', padding: '14px 18px',
                    background: 'var(--surface)',
                  }}
                >
                  {/* Conversation Preview */}
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-muted)' }}>
                    💬 最近對話
                  </div>
                  <div
                    style={{
                      maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column',
                      gap: 6, marginBottom: 16, padding: '8px', background: 'var(--background)',
                      borderRadius: 8, border: '1px solid var(--border)',
                    }}
                  >
                    {convoMessages.length === 0 ? (
                      <span style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: '12px 0' }}>尚無對話紀錄</span>
                    ) : (
                      convoMessages.map((m, i) => (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                            {m.role === 'assistant' && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleOpenCorrection(m, i); }}
                                title="修正回覆並存入知識庫"
                                style={{
                                  background: 'none', border: 'none', padding: 4, cursor: 'pointer',
                                  color: 'var(--text-muted)', opacity: 0.6, marginTop: 4,
                                }}
                                onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                                onMouseLeave={e => e.currentTarget.style.opacity = '0.6'}
                              >
                                <Zap size={14} />
                              </button>
                            )}
                            <span
                              style={{
                                maxWidth: '300px', padding: '6px 10px', borderRadius: 10, fontSize: 12,
                                lineHeight: 1.5, wordBreak: 'break-word',
                                background: m.role === 'user' ? '#3b82f622' : '#6b728022',
                                color: m.role === 'user' ? '#60a5fa' : 'var(--text-muted)',
                                border: `1px solid ${m.role === 'user' ? '#3b82f644' : '#6b728044'}`,
                              }}
                            >
                              {m.content}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--text-muted)' }}>
                    所有標籤
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                    {userTags.map((t) => (
                      <div
                        key={t.tag}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 4,
                          padding: '4px 10px', borderRadius: 100, fontSize: 12,
                          background: t.source === 'manual' ? '#6366f122' : '#10b98122',
                          color: t.source === 'manual' ? '#6366f1' : '#10b981',
                          border: `1px solid ${t.source === 'manual' ? '#6366f144' : '#10b98144'}`,
                        }}
                      >
                        {t.tag}
                        <span style={{ fontSize: 10, opacity: 0.7 }}>
                          ({t.source === 'manual' ? '手動' : 'AI'})
                        </span>
                        <button
                          onClick={() => handleRemoveTag(u.id, t.tag)}
                          disabled={tagActionLoading}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                    {userTags.length === 0 && (
                      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>尚無標籤</span>
                    )}
                  </div>

                  {/* Add Tag Input */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      placeholder="新增標籤，例如：phone:iphone-15"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddTag(u.id)}
                      style={{
                        flex: 1, padding: '7px 12px', borderRadius: 8, fontSize: 13,
                        border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--text)',
                      }}
                    />
                    <button
                      onClick={() => handleAddTag(u.id)}
                      disabled={tagActionLoading || !newTag.trim()}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4, padding: '7px 14px',
                        background: 'var(--accent)', color: '#fff', border: 'none',
                        borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                        opacity: tagActionLoading || !newTag.trim() ? 0.5 : 1,
                      }}
                    >
                      <Plus size={14} /> 新增
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

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
    </div>
  );
}
