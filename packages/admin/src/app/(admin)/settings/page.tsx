'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { Settings, Save } from 'lucide-react';

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({
    woo_base_url: '',
    woo_consumer_key: '',
    woo_consumer_secret: '',
    live_agent_duration_hours: '24',
    message_gate_window_ms: '8000',
    bot_message_footer: '',
    admin_unlock_whitelist: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch<{ settings: Array<{ key: string; value: string }> }>('/api/admin/settings')
      .then(d => {
        const map: Record<string, string> = { ...settings };
        for (const s of d.settings) map[s.key] = s.value;
        setSettings(map);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(key: string) {
    setSaving(true);
    try {
      await apiFetch('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ key, value: settings[key] }) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) { alert(err.message); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="loading-center"><div className="loading-spinner" /></div>;

  const sections = [
    {
      title: '🛒 WooCommerce 設定',
      fields: [
        { key: 'woo_base_url', label: '商店基本 URL', placeholder: 'https://ppbears.com', type: 'text' },
        { key: 'woo_consumer_key', label: 'Consumer Key', placeholder: 'ck_...', type: 'password' },
        { key: 'woo_consumer_secret', label: 'Consumer Secret', placeholder: 'cs_...', type: 'password' },
      ],
    },
    {
      title: '⚙️ 行為設定',
      fields: [
        { key: 'live_agent_duration_hours', label: '真人接管預設時長（小時）', placeholder: '24', type: 'number' },
        { key: 'message_gate_window_ms', label: '訊息合併視窗（毫秒）', placeholder: '8000', type: 'number' },
        { key: 'bot_message_footer', label: '機器人結語 (自動附加於每則 AI 回覆後)', placeholder: '目前為ppbears AI客服，需要真人客服請輸入「真人」。', type: 'textarea' },
      ],
    },
    {
      title: '🔒 管理員白名單',
      fields: [
        { key: 'admin_unlock_whitelist', label: 'LINE 管理員 User ID（每行一個）', placeholder: 'Uxxxxxxxxxxxxxxxxxx', type: 'textarea' },
      ],
    },
  ];

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">⚙️ 系統設定</span>
        <div className="topbar-right">
          {saved && <span className="badge badge-success">✓ 已儲存</span>}
          <div className="topbar-avatar">A</div>
        </div>
      </div>
      <div className="page-content">
        <div className="section-header">
          <div>
            <div className="section-title">系統設定</div>
            <div className="section-subtitle">所有設定即時生效，無需重新部署</div>
          </div>
        </div>

        <div className="flex-col">
          {sections.map((section) => (
            <div key={section.title} className="card">
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 'var(--space-md)' }}>{section.title}</div>
              {section.fields.map((field) => (
                <div key={field.key} className="form-group">
                  <label className="form-label">{field.label}</label>
                  {field.type === 'textarea' ? (
                    <textarea
                      className="form-textarea"
                      placeholder={field.placeholder}
                      value={settings[field.key] || ''}
                      onChange={e => setSettings({ ...settings, [field.key]: e.target.value })}
                    />
                  ) : (
                    <input
                      type={field.type}
                      className="form-input"
                      placeholder={field.placeholder}
                      value={settings[field.key] || ''}
                      onChange={e => setSettings({ ...settings, [field.key]: e.target.value })}
                    />
                  )}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleSave(field.key)} disabled={saving}>
                      <Save size={13} /> 儲存
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
