'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { Settings, Save, Wifi, WifiOff } from 'lucide-react';

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({
    woo_base_url: '',
    woo_consumer_key: '',
    woo_consumer_secret: '',
    live_agent_duration_hours: '24',
    message_gate_window_ms: '8000',
    bot_message_footer: '',
    admin_unlock_whitelist: '',
    quick_order_keyword: 'ppbears888',
    quick_order_product_id: '',
    quick_order_product_url: '',
    quick_order_reply_template: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [wooTest, setWooTest] = useState<{ ok: boolean; diagnosis?: any; error?: string } | null>(null);
  const [wooTesting, setWooTesting] = useState(false);

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

  async function testWooConnection() {
    setWooTesting(true);
    setWooTest(null);
    try {
      const result = await apiFetch<any>('/api/admin/woo/test-connection');
      setWooTest(result);
    } catch (err: any) {
      setWooTest({ ok: false, error: err.message });
    } finally {
      setWooTesting(false);
    }
  }

  if (loading) return <div className="loading-center"><div className="loading-spinner" /></div>;

  const sections = [
    {
      title: '🛒 WooCommerce 設定',
      fields: [
        { key: 'woo_base_url', label: '商店基本 URL（必填）', placeholder: 'https://ppbears.com', type: 'text' },
        { key: 'woo_consumer_key', label: 'Consumer Key（ck_...）', placeholder: 'ck_...', type: 'text' },
        { key: 'woo_consumer_secret', label: 'Consumer Secret（cs_...）', placeholder: 'cs_...', type: 'text' },
      ],
      extra: (
        <div style={{ marginTop: 12 }}>
          <button
            className="btn btn-primary btn-sm"
            onClick={testWooConnection}
            disabled={wooTesting}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            {wooTesting ? '測試中...' : <><Wifi size={14} /> 測試 WooCommerce 連線</>}
          </button>

          {wooTest && (
            <div style={{
              marginTop: 12, padding: '12px 16px', borderRadius: 10, fontSize: 12,
              fontFamily: 'monospace', whiteSpace: 'pre-wrap',
              background: wooTest.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
              border: `1px solid ${wooTest.ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
              color: wooTest.ok ? '#4ade80' : '#f87171',
              overflowX: 'auto',
            }}>
              {wooTest.ok
                ? `✅ WooCommerce 連線成功\n\n${JSON.stringify(wooTest.diagnosis, null, 2)}`
                : `❌ 連線失敗\n錯誤：${wooTest.error || '未知錯誤'}\n\n診斷資訊：\n${JSON.stringify(wooTest.diagnosis, null, 2)}`}
            </div>
          )}
        </div>
      ),
    },
    {
      title: '⚡ 快速開單設定',
      fields: [
        {
          key: 'quick_order_keyword',
          label: '觸發密碼（輸入此密碼開頭才會觸發開單）',
          placeholder: 'ppbears888',
          type: 'text',
        },
        {
          key: 'quick_order_product_id',
          label: 'WooCommerce 開單商品 ID（從 WP 後台商品頁 URL 取得）',
          placeholder: '123',
          type: 'text',
        },
        {
          key: 'quick_order_product_url',
          label: '開單商品網址（回覆訊息中顯示的商品連結）',
          placeholder: 'https://ppbears.com/product/line1/',
          type: 'text',
        },
        {
          key: 'quick_order_reply_template',
          label: '回覆訊息模板（支援 {name}、{order_number}、{product_url}、{amount}）',
          placeholder: '哈囉～{name}您好😊\n這是您的專屬下單頁面：\n\n🔹 訂單ID：{order_number}\n🔹 商品連結：{product_url}',
          type: 'textarea',
        },
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
              {(section as any).extra}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
