'use client';

import { useEffect, useState, useCallback, Suspense, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '../../../lib/api';
import { Megaphone, Send, Users, CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react';

interface Campaign {
  id: string;
  name: string;
  tag_filter: string;
  message: string;
  status: 'pending' | 'sending' | 'done' | 'failed';
  total_recipients: number;
  error_message?: string;
  created_at: string;
  sent_at?: string;
}

function BroadcastContent() {
  const searchParams = useSearchParams();
  const [tags, setTags] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Form state
  const [form, setForm] = useState({
    name: '',
    tag_filter: searchParams.get('tag') || '',
    message: '',
  });

  const loadTags = useCallback(async () => {
    try {
      const res = await apiFetch<{ tags: string[] }>('/api/admin/tags');
      setTags(res.tags);
    } catch {}
  }, []);

  const loadCampaigns = useCallback(async () => {
    setCampaignLoading(true);
    try {
      const res = await apiFetch<{ campaigns: Campaign[] }>('/api/admin/broadcast');
      setCampaigns(res.campaigns);
    } catch {} finally {
      setCampaignLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTags();
    loadCampaigns();
  }, [loadTags, loadCampaigns]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handlePreview = async () => {
    if (!form.tag_filter) return;
    setPreviewLoading(true);
    setPreviewCount(null);
    try {
      const res = await apiFetch<{ count: number }>('/api/admin/broadcast/preview', {
        method: 'POST',
        body: JSON.stringify({ tag_filter: form.tag_filter }),
      });
      setPreviewCount(res.count);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSend = async () => {
    setError('');
    setSuccess('');
    if (!form.name.trim() || !form.tag_filter || !form.message.trim()) {
      setError('請填寫所有欄位');
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch<{ campaignId: string }>('/api/admin/broadcast', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setSuccess(`推播任務已建立 (ID: ${res.campaignId})，正在發送中…`);
      setForm({ name: '', tag_filter: form.tag_filter, message: '' });
      setPreviewCount(null);
      await loadCampaigns();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const statusIcon = (status: Campaign['status']) => {
    switch (status) {
      case 'done': return <CheckCircle size={16} style={{ color: '#10b981' }} />;
      case 'failed': return <XCircle size={16} style={{ color: '#ef4444' }} />;
      case 'sending': case 'pending': return <Clock size={16} style={{ color: '#f59e0b' }} />;
    }
  };

  const statusLabel = (status: Campaign['status']) => {
    switch (status) {
      case 'done': return '已完成';
      case 'failed': return '失敗';
      case 'sending': return '發送中';
      case 'pending': return '等待中';
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Megaphone size={28} style={{ color: 'var(--accent)' }} />
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>行銷推播</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 13 }}>
            依標籤族群發送 LINE 推播訊息
          </p>
        </div>
      </div>

      {/* New Campaign Form */}
      <div className="card" style={{ padding: '20px 24px', marginBottom: 28 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 0, marginBottom: 18 }}>
          ✉️ 建立新推播
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Campaign Name */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-muted)' }}>
              活動名稱
            </label>
            <input
              type="text"
              placeholder="例如：iPhone 16 系列新品通知"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              style={{
                width: '100%', padding: '9px 14px', borderRadius: 8, fontSize: 14,
                border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Tag Filter */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-muted)' }}>
              目標族群標籤
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              {/* Custom dropdown — avoids native <select> white-background issue in dark mode */}
              <div ref={dropdownRef} style={{ flex: 1, position: 'relative' }}>
                {/* Trigger button */}
                <button
                  type="button"
                  onClick={() => setDropdownOpen((o) => !o)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '9px 14px', borderRadius: 8, fontSize: 14,
                    border: '1px solid var(--border)', background: 'var(--surface)', color: form.tag_filter ? 'var(--text)' : 'var(--text-muted)',
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span>{form.tag_filter || '— 選擇標籤 —'}</span>
                  <span style={{ marginLeft: 8, fontSize: 10, opacity: 0.6 }}>{dropdownOpen ? '▲' : '▼'}</span>
                </button>

                {/* Dropdown list */}
                {dropdownOpen && (
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                    background: '#1a1d2e', border: '1px solid var(--border)',
                    borderRadius: 8, zIndex: 999, maxHeight: 260, overflowY: 'auto',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                  }}>
                    {/* "— 選擇標籤 —" placeholder option */}
                    <div
                      onClick={() => { setForm((f) => ({ ...f, tag_filter: '' })); setPreviewCount(null); setDropdownOpen(false); }}
                      style={{
                        padding: '9px 14px', fontSize: 14, cursor: 'pointer', color: '#8b93b0',
                        borderBottom: '1px solid rgba(255,255,255,0.07)',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#2a2d3e')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      — 選擇標籤 —
                    </div>
                    {tags.map((t) => (
                      <div
                        key={t}
                        onClick={() => { setForm((f) => ({ ...f, tag_filter: t })); setPreviewCount(null); setDropdownOpen(false); }}
                        style={{
                          padding: '9px 14px', fontSize: 14, cursor: 'pointer',
                          color: t === form.tag_filter ? '#ffffff' : '#d0d5ea',
                          background: t === form.tag_filter ? 'var(--accent)' : 'transparent',
                          fontWeight: t === form.tag_filter ? 600 : 400,
                        }}
                        onMouseEnter={(e) => { if (t !== form.tag_filter) e.currentTarget.style.background = '#2a2d3e'; }}
                        onMouseLeave={(e) => { if (t !== form.tag_filter) e.currentTarget.style.background = 'transparent'; }}
                      >
                        {t}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={handlePreview}
                disabled={!form.tag_filter || previewLoading}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text)',
                  opacity: !form.tag_filter ? 0.4 : 1, whiteSpace: 'nowrap',
                }}
              >
                <Users size={14} />
                {previewLoading ? '計算中…' : '預覽人數'}
              </button>
            </div>
            {previewCount !== null && (
              <div style={{
                marginTop: 8, padding: '8px 14px', borderRadius: 8, fontSize: 13,
                background: previewCount > 0 ? '#10b98122' : '#f59e0b22',
                color: previewCount > 0 ? '#10b981' : '#f59e0b',
                border: `1px solid ${previewCount > 0 ? '#10b98144' : '#f59e0b44'}`,
              }}>
                {previewCount > 0
                  ? `✅ 此族群共 ${previewCount} 位 LINE 用戶將收到推播`
                  : `⚠️ 此族群目前沒有可發送的 LINE 用戶`}
              </div>
            )}
          </div>

          {/* Message */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-muted)' }}>
              推播訊息內容
            </label>
            <textarea
              rows={4}
              placeholder="例如：🐻 PPBears 新品上架！iPhone 16 Pro 專屬熊繪手機殼，限時 9 折優惠 → https://ppbears.com"
              value={form.message}
              onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
              style={{
                width: '100%', padding: '9px 14px', borderRadius: 8, fontSize: 14,
                border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)',
                resize: 'vertical', boxSizing: 'border-box',
              }}
            />
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {form.message.length} 字元
            </div>
          </div>

          {error && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: '#ef444422', color: '#ef4444', fontSize: 13, border: '1px solid #ef444440' }}>
              ⚠️ {error}
            </div>
          )}
          {success && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: '#10b98122', color: '#10b981', fontSize: 13, border: '1px solid #10b98140' }}>
              ✅ {success}
            </div>
          )}

          <button
            onClick={handleSend}
            disabled={loading || !form.name.trim() || !form.tag_filter || !form.message.trim()}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '11px 24px', background: 'var(--accent)', color: '#fff', border: 'none',
              borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 700,
              opacity: loading || !form.name.trim() || !form.tag_filter || !form.message.trim() ? 0.5 : 1,
              transition: 'opacity 0.2s',
            }}
          >
            <Send size={16} />
            {loading ? '發送中…' : '發送推播'}
          </button>
        </div>
      </div>

      {/* Campaign History */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>📋 推播記錄</h2>
        <button
          onClick={loadCampaigns}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8, cursor: 'pointer', color: 'var(--text)', fontSize: 13,
          }}
        >
          <RefreshCw size={13} /> 重新整理
        </button>
      </div>

      {campaignLoading ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>載入中…</div>
      ) : campaigns.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <Megaphone size={40} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>尚未發送任何推播</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {campaigns.map((c) => (
            <div key={c.id} className="card" style={{ padding: '14px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ marginTop: 2 }}>{statusIcon(c.status)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</span>
                    <span style={{
                      padding: '2px 10px', borderRadius: 100, fontSize: 11,
                      background: 'var(--accent)22', color: 'var(--accent)',
                      border: '1px solid var(--accent)44',
                    }}>
                      {c.tag_filter}
                    </span>
                    <span style={{
                      padding: '2px 8px', borderRadius: 100, fontSize: 11,
                      background: c.status === 'done' ? '#10b98122' : c.status === 'failed' ? '#ef444422' : '#f59e0b22',
                      color: c.status === 'done' ? '#10b981' : c.status === 'failed' ? '#ef4444' : '#f59e0b',
                    }}>
                      {statusLabel(c.status)}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.message}
                  </div>
                  <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                    <span>👥 {c.total_recipients} 人</span>
                    <span>📅 {new Date(c.created_at).toLocaleString('zh-TW')}</span>
                    {c.sent_at && <span>✅ {new Date(c.sent_at).toLocaleString('zh-TW')}</span>}
                  </div>
                  {c.error_message && (
                    <div style={{ marginTop: 6, fontSize: 12, color: '#ef4444' }}>
                      錯誤：{c.error_message}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BroadcastPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32 }}>載入中…</div>}>
      <BroadcastContent />
    </Suspense>
  );
}
