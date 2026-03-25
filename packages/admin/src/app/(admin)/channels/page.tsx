'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { PlugZap, CheckCircle, XCircle, Copy } from 'lucide-react';

export default function ChannelsPage() {
  const [channels, setChannels] = useState<any[]>([]);

  useEffect(() => {
    apiFetch<{ channels: any[] }>('/api/admin/channels')
      .then(d => setChannels(d.channels))
      .catch(console.error);
  }, []);

  const channelInfo: Record<string, { icon: string; name: string; webhookPath: string; docsUrl: string }> = {
    line: {
      icon: '💬',
      name: 'LINE Official Account',
      webhookPath: '/webhooks/line/{tenantId}',
      docsUrl: 'https://developers.line.biz/console/',
    },
    messenger: {
      icon: '📘',
      name: 'Facebook Messenger',
      webhookPath: '/webhooks/messenger/{tenantId}',
      docsUrl: 'https://developers.facebook.com/apps/',
    },
    whatsapp: {
      icon: '💚',
      name: 'WhatsApp Cloud API',
      webhookPath: '/webhooks/whatsapp/{tenantId}',
      docsUrl: 'https://developers.facebook.com/apps/',
    },
  };

  const configuredTypes = channels.map(c => c.channel_type);

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">🔌 通路設定</span>
        <div className="topbar-right"><div className="topbar-avatar">A</div></div>
      </div>

      <div className="page-content">
        <div className="section-header">
          <div>
            <div className="section-title">通路整合設定</div>
            <div className="section-subtitle">設定各通路的 Webhook 和 API 憑證</div>
          </div>
        </div>

        <div className="flex-col">
          {Object.entries(channelInfo).map(([type, info]) => {
            const configured = configuredTypes.includes(type);
            const ch = channels.find(c => c.channel_type === type);
            const apiBase = process.env.NEXT_PUBLIC_API_URL || 'https://your-backend.run.app';
            const webhook = `${apiBase}${info.webhookPath}`;

            return (
              <div key={type} className="card">
                <div className="flex-row" style={{ marginBottom: 'var(--space-md)' }}>
                  <span style={{ fontSize: 28 }}>{info.icon}</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{info.name}</div>
                    <a href={info.docsUrl} target="_blank" className="text-muted text-xs">開啟開發者控制台 →</a>
                  </div>
                  <div className="ml-auto">
                    {configured && ch?.enabled ? (
                      <span className="badge badge-success"><CheckCircle size={12} /> 已啟用</span>
                    ) : (
                      <span className="badge badge-muted"><XCircle size={12} /> 未設定</span>
                    )}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Webhook URL（複製貼入平台）</label>
                  <div className="flex-row">
                    <input readOnly className="form-input" value={webhook} style={{ fontFamily: 'monospace', fontSize: 12 }} />
                    <button className="btn btn-ghost btn-icon" onClick={() => navigator.clipboard.writeText(webhook)}>
                      <Copy size={14} />
                    </button>
                  </div>
                </div>

                {type === 'line' && (
                  <div className="grid-2">
                    <div className="form-group">
                      <label className="form-label">Channel Secret</label>
                      <input type="password" className="form-input" placeholder="LINE Channel Secret" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Channel Access Token</label>
                      <input type="password" className="form-input" placeholder="LINE Access Token" />
                    </div>
                  </div>
                )}

                {type === 'messenger' && (
                  <div className="grid-2">
                    <div className="form-group">
                      <label className="form-label">Page Access Token</label>
                      <input type="password" className="form-input" placeholder="FB Page Token" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">App Secret</label>
                      <input type="password" className="form-input" placeholder="App Secret" />
                    </div>
                  </div>
                )}

                {type === 'whatsapp' && (
                  <div className="grid-2">
                    <div className="form-group">
                      <label className="form-label">Phone Number ID</label>
                      <input className="form-input" placeholder="WhatsApp Phone Number ID" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Access Token</label>
                      <input type="password" className="form-input" placeholder="WhatsApp Access Token" />
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn btn-primary btn-sm">儲存設定</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
