'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../../lib/api';
import { ShieldAlert, Plus, Trash2, Save, Loader2, GripVertical } from 'lucide-react';

export default function StrictRulesPage() {
  const [rules, setRules] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch<{ settings: Array<{ key: string; value: string }> }>('/api/admin/settings')
      .then(d => {
        const raw = d.settings.find(s => s.key === 'ai_strict_rules')?.value;
        if (raw) {
          try { setRules(JSON.parse(raw)); } catch { setRules([]); }
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function saveRules(newRules: string[]) {
    setSaving(true);
    try {
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ key: 'ai_strict_rules', value: JSON.stringify(newRules) }),
      });
      setRules(newRules);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) { alert('儲存失敗：' + err.message); }
    finally { setSaving(false); }
  }

  function addRule() {
    const trimmed = input.trim();
    if (!trimmed) return;
    const newRules = [...rules, trimmed];
    setInput('');
    saveRules(newRules);
  }

  function removeRule(idx: number) {
    const newRules = rules.filter((_, i) => i !== idx);
    saveRules(newRules);
  }

  if (loading) return <div className="loading-center"><div className="loading-spinner" /></div>;

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">🛡️ AI 最優先規則</span>
        <div className="topbar-right">
          {saved && <span className="badge badge-success">✓ 已儲存</span>}
          <div className="topbar-avatar">A</div>
        </div>
      </div>

      <div className="page-content">
        {/* Intro */}
        <div className="section-header">
          <div>
            <div className="section-title">AI 最優先規則（絕對鐵則）</div>
            <div className="section-subtitle">這些規則會被注入到每次 AI 回覆的最高優先層，任何情況下 AI 都必須遵守</div>
          </div>
        </div>

        {/* Warning card */}
        <div style={{
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
          borderRadius: 12, padding: '14px 18px', marginBottom: 24,
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <ShieldAlert size={20} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13, color: '#c8a84b', lineHeight: 1.6 }}>
            <strong style={{ color: '#f59e0b' }}>這些規則優先於所有其他設定</strong>，包含系統提示詞和知識庫。<br />
            適合設定「絕對禁止報價」、「禁止承諾特定交期」等客服底線規則。
          </div>
        </div>

        {/* Rule list */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldAlert size={16} style={{ color: '#f59e0b' }} />
            目前規則（{rules.length} 條）
          </div>

          {rules.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 14 }}>
              尚未設定任何規則
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rules.map((rule, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '12px 14px', borderRadius: 8,
                  background: 'rgba(245,158,11,0.06)',
                  border: '1px solid rgba(245,158,11,0.12)',
                }}>
                  <span style={{
                    width: 24, height: 24, flexShrink: 0,
                    background: 'rgba(245,158,11,0.2)', color: '#f59e0b',
                    borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, marginTop: 1,
                  }}>{i + 1}</span>
                  <span style={{ flex: 1, fontSize: 14, lineHeight: 1.6, color: 'var(--text-primary)' }}>{rule}</span>
                  <button
                    onClick={() => removeRule(i)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-muted)', padding: 4, borderRadius: 4,
                      transition: 'color 0.2s', flexShrink: 0,
                    }}
                    onMouseOver={e => (e.currentTarget.style.color = '#ef4444')}
                    onMouseOut={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                    disabled={saving}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add new rule */}
        <div className="card">
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>新增規則</div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">規則描述（寫清楚 AI 在什麼情況下「不能」或「必須」做什麼）</label>
            <textarea
              className="form-textarea"
              rows={3}
              placeholder={'例如：系統絕對不能向客戶報任何價格，若客戶詢問價格，請回覆「價格會依商品規格有所不同，請參考 https://ppbears.com/specification/ 或直接聯繫客服」。'}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addRule();
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Ctrl+Enter 快速新增</span>
              <button
                className="btn btn-primary"
                onClick={addRule}
                disabled={!input.trim() || saving}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {saving
                  ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  : <Plus size={14} />}
                新增規則
              </button>
            </div>
          </div>
        </div>

        {/* How it works */}
        <div style={{
          marginTop: 20, padding: '14px 18px', borderRadius: 10,
          background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.15)',
          fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7,
        }}>
          <strong style={{ color: '#60a5fa' }}>📐 技術說明：</strong> 這些規則會被包裝成
          <code style={{ background: 'rgba(255,255,255,0.07)', padding: '1px 6px', borderRadius: 4, margin: '0 3px' }}>
            [ABSOLUTE RULES - NEVER VIOLATE]
          </code>
          的系統指令，放置在 AI 提示詞的最頂層，優先級高於知識庫和系統設定。
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
