'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { Headphones, UserCheck, Clock, RefreshCw, Save } from 'lucide-react';

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

  // Settings state
  const [settings, setSettings] = useState<Record<string, string>>({
    live_agent_duration_hours: '24',
    live_agent_hours_start: '',
    live_agent_hours_end: '',
    live_agent_takeover_message: '',
    live_agent_off_hours_message: '',
    takeover_keywords: '真人,轉真人,我要找客服,有人嗎,客服處理',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function fetchData() {
    setLoading(true);
    try {
      // Fetch sessions
      const sessionData = await apiFetch<{ sessions: LiveSession[] }>('/api/admin/live-agent');
      setSessions(sessionData.sessions);

      // Fetch settings
      const settingData = await apiFetch<{ settings: Array<{ key: string; value: string }> }>('/api/admin/settings');
      const map: Record<string, string> = { ...settings };
      for (const s of settingData.settings) {
        if (Object.keys(settings).includes(s.key)) map[s.key] = s.value;
      }
      setSettings(map);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function handleSave(key: string) {
    setSaving(true);
    try {
      await apiFetch('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ key, value: settings[key] }) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) { alert(err.message); }
    finally { setSaving(false); }
  }

  async function release(id: string) {
    if (!confirm('確定要結束此真人客服 session？')) return;
    try {
      await apiFetch(`/api/admin/live-agent/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (err: any) { alert(err.message); }
  }

  useEffect(() => { fetchData(); }, []);

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
          {saved && <span className="badge badge-success">✓ 已儲存</span>}
          <button className="btn btn-ghost btn-sm" onClick={fetchData}><RefreshCw size={14} /></button>
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

        <div className="card" style={{ marginTop: 'var(--space-lg)' }}>
          <div style={{ fontWeight: 600, marginBottom: 16, color: 'var(--status-live)' }}>📌 真人接管設定</div>

          {/* Keywords */}
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label" style={{ fontWeight: 600 }}>觸發詞 (以半形逗點分隔)</label>
            <input
              type="text"
              className="form-input"
              placeholder="真人,轉真人,我要找客服,有人嗎,客服處理"
              value={settings['takeover_keywords'] || ''}
              onChange={e => setSettings({ ...settings, takeover_keywords: e.target.value })}
            />
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              目前設定：{settings['takeover_keywords']?.split(',').map((k, i) => (
                <span key={i} className="badge badge-live" style={{ padding: '0px 6px', marginRight: 4, display: 'inline-block' }}>{k.trim()}</span>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => handleSave('takeover_keywords')} disabled={saving}>
                <Save size={13} /> 儲存觸發詞
              </button>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label" style={{ fontWeight: 600 }}>真人接管預設時長（小時）</label>
            <input
              type="number"
              className="form-input"
              value={settings['live_agent_duration_hours'] || '24'}
              onChange={e => setSettings({ ...settings, live_agent_duration_hours: e.target.value })}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => handleSave('live_agent_duration_hours')} disabled={saving}>
                <Save size={13} /> 儲存時長
              </button>
            </div>
          </div>

          {/* Time range row */}
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label" style={{ fontWeight: 600 }}>真人客服服務時段（空白表示不限時間，全天可轉接）</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <input
                type="time"
                className="form-input"
                style={{ width: 140 }}
                value={settings['live_agent_hours_start'] || ''}
                onChange={e => setSettings({ ...settings, live_agent_hours_start: e.target.value })}
              />
              <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>到</span>
              <input
                type="time"
                className="form-input"
                style={{ width: 140 }}
                value={settings['live_agent_hours_end'] || ''}
                onChange={e => setSettings({ ...settings, live_agent_hours_end: e.target.value })}
              />
              <button
                className="btn btn-ghost btn-sm"
                onClick={async () => {
                  setSaving(true);
                  try {
                    await apiFetch('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ key: 'live_agent_hours_start', value: settings['live_agent_hours_start'] || '' }) });
                    await apiFetch('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ key: 'live_agent_hours_end', value: settings['live_agent_hours_end'] || '' }) });
                    setSaved(true); setTimeout(() => setSaved(false), 2000);
                  } catch (err: any) { alert(err.message); }
                  finally { setSaving(false); }
                }}
                disabled={saving}
              >
                <Save size={13} /> 儲存時段
              </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              例：設定 10:00 到 21:00，則只有這段時間客戶輸入「真人」才能轉接。
            </div>
          </div>

          {/* Takeover success message */}
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label" style={{ fontWeight: 600 }}>✅ 接通成功訊息（轉接真人客服成功時，回給客戶的文字）</label>
            <textarea
              className="form-textarea"
              placeholder="已為您轉接真人客服，請稍候。我們的客服人員會盡快回覆您！"
              value={settings['live_agent_takeover_message'] || ''}
              onChange={e => setSettings({ ...settings, live_agent_takeover_message: e.target.value })}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => handleSave('live_agent_takeover_message')} disabled={saving}>
                <Save size={13} /> 儲存
              </button>
            </div>
          </div>

          {/* Off-hours message */}
          <div className="form-group">
            <label className="form-label" style={{ fontWeight: 600 }}>🌙 非服務時間訊息（超出時段客戶輸入觸發詞時，回給客戶的文字，不會轉接）</label>
            <textarea
              className="form-textarea"
              placeholder="真人客服目前休息中，如有問題請先說明，客服看到後會盡快回覆您！"
              value={settings['live_agent_off_hours_message'] || ''}
              onChange={e => setSettings({ ...settings, live_agent_off_hours_message: e.target.value })}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => handleSave('live_agent_off_hours_message')} disabled={saving}>
                <Save size={13} /> 儲存
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
