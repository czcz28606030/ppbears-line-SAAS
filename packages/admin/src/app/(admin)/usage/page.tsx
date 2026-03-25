'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '../../../lib/api';

interface UsageStats {
  currentPeriod: Record<string, number>;
  plan: string;
  quotaStatus: {
    messages: { current: number; limit: number; percentage: number };
  };
}

interface FeatureFlag {
  feature: string;
  enabled: boolean;
  source: string;
}

export default function UsagePage() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingFlag, setTogglingFlag] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<UsageStats>('/api/admin/usage/stats'),
      apiFetch<{ flags: FeatureFlag[] }>('/api/admin/features'),
    ]).then(([s, f]) => {
      setStats(s);
      setFlags(f.flags);
    }).finally(() => setLoading(false));
  }, []);

  async function toggleFlag(feature: string, currentState: boolean) {
    setTogglingFlag(feature);
    try {
      await apiFetch(`/api/admin/features/${feature}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !currentState }),
      });
      setFlags(prev => prev.map(f => f.feature === feature ? { ...f, enabled: !currentState } : f));
    } finally { setTogglingFlag(null); }
  }

  const PLAN_LABELS: Record<string, string> = {
    free: '免費方案', starter: '入門方案', professional: '專業方案', enterprise: '企業方案',
  };

  const FEATURE_LABELS: Record<string, string> = {
    basic_ai: '基礎 AI 回覆', order_query: '訂單查詢', knowledge_base: '知識庫 RAG',
    live_agent: '真人接管', product_sync: '產品同步', analytics: '數據分析',
    custom_llm: '自訂 LLM', white_label: '白標客製',
    messenger_channel: 'Messenger 通路', whatsapp_channel: 'WhatsApp 通路',
    multi_model_fallback: '多模型容錯',
  };

  if (loading) return <div className="loading-state"><div className="loading-spinner" /></div>;

  const quota = stats?.quotaStatus.messages;
  const isUnlimited = quota?.limit === -1;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">用量統計 &amp; 功能開關</h1>
          <p className="page-subtitle">監控訊息用量與管理功能啟用狀態</p>
        </div>
      </div>

      {/* Plan & Quota */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div className="stat-card">
          <div className="stat-label">目前方案</div>
          <div className="stat-value" style={{ fontSize: '1.5rem' }}>{PLAN_LABELS[stats?.plan || 'free']}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">本月訊息</div>
          <div className="stat-value">{quota?.current || 0}</div>
          <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {isUnlimited ? '無限制' : `上限：${quota?.limit}`}
          </div>
          {!isUnlimited && (
            <div style={{ marginTop: '0.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: 8, height: 6, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(quota?.percentage || 0, 100)}%`, height: '100%', background: (quota?.percentage || 0) > 80 ? '#ef4444' : '#6366f1', borderRadius: 8, transition: 'width 0.5s' }} />
            </div>
          )}
        </div>
        {Object.entries(stats?.currentPeriod || {}).slice(0, 2).map(([k, v]) => (
          <div className="stat-card" key={k}>
            <div className="stat-label">{k}</div>
            <div className="stat-value">{v}</div>
          </div>
        ))}
      </div>

      {/* Feature Flags */}
      <div className="card">
        <h2 style={{ marginBottom: '1.5rem', fontSize: '1.1rem', color: 'var(--text-primary)' }}>功能開關</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
          {flags.map(flag => (
            <div key={flag.feature} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1rem', background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
              <div>
                <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{FEATURE_LABELS[flag.feature] || flag.feature}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{flag.feature}</div>
              </div>
              <button
                disabled={togglingFlag === flag.feature}
                onClick={() => toggleFlag(flag.feature, flag.enabled)}
                style={{
                  width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                  background: flag.enabled ? '#6366f1' : 'rgba(255,255,255,0.1)',
                  transition: 'background 0.3s', position: 'relative',
                }}
              >
                <span style={{
                  position: 'absolute', top: 2, width: 20, height: 20, borderRadius: '50%', background: '#fff',
                  left: flag.enabled ? 22 : 2, transition: 'left 0.3s',
                }} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
