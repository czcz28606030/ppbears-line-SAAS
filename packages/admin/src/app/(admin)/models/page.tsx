'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { Bot, Plus, Star, Trash2, ToggleLeft } from 'lucide-react';

interface Model {
  id: string;
  provider: string;
  model_name: string;
  temperature: number;
  max_tokens: number;
  is_default: boolean;
  enabled: boolean;
}

export default function ModelsPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ provider: 'openai', model_name: 'gpt-4o-mini', api_key: '', temperature: 0.7, max_tokens: 1024, is_default: false });

  async function fetchModels() {
    try {
      const data = await apiFetch<{ models: Model[] }>('/api/admin/models');
      setModels(data.models);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function addModel(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/models', { method: 'POST', body: JSON.stringify(form) });
      setShowAdd(false);
      fetchModels();
    } catch (err: any) { alert(err.message); }
  }

  useEffect(() => { fetchModels(); }, []);

  const providerColor: Record<string, string> = { openai: 'badge-success', gemini: 'badge-info', claude: 'badge-warning' };
  const modelDefaults: Record<string, string[]> = {
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    gemini: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
    claude: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku'],
  };

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">🤖 模型設定</span>
        <div className="topbar-right">
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>
            <Plus size={14} /> 新增模型
          </button>
          <div className="topbar-avatar">A</div>
        </div>
      </div>

      <div className="page-content">
        <div className="section-header">
          <div>
            <div className="section-title">LLM 模型設定</div>
            <div className="section-subtitle">管理各租戶的 AI 模型與 API 金鑰配置</div>
          </div>
        </div>

        <div className="data-table-wrapper">
          {loading ? (
            <div className="loading-center"><div className="loading-spinner" /></div>
          ) : models.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><Bot size={40} /></div>
              <p>尚未設定模型</p>
              <p className="text-xs">點擊「新增模型」設定您的 AI 模型</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>模型名稱</th>
                  <th>Temperature</th>
                  <th>Max Tokens</th>
                  <th>狀態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.id}>
                    <td><span className={`badge ${providerColor[m.provider] || 'badge-muted'}`}>{m.provider}</span></td>
                    <td style={{ color: 'var(--text-primary)', fontWeight: 500, fontFamily: 'monospace' }}>{m.model_name}</td>
                    <td>{m.temperature}</td>
                    <td>{m.max_tokens}</td>
                    <td>
                      {m.is_default && <span className="badge badge-warning"><Star size={10} /> 預設</span>}
                      {!m.enabled && <span className="badge badge-muted">停用</span>}
                      {m.enabled && !m.is_default && <span className="badge badge-success">啟用</span>}
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm"><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Add Model Modal */}
        {showAdd && (
          <div className="modal-overlay" onClick={() => setShowAdd(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <h3 className="modal-title">新增 LLM 模型</h3>
              <form onSubmit={addModel}>
                <div className="form-group">
                  <label className="form-label">Provider</label>
                  <select className="form-select" value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value, model_name: modelDefaults[e.target.value]?.[0] || '' })}>
                    <option value="openai">OpenAI</option>
                    <option value="gemini">Gemini</option>
                    <option value="claude">Claude</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">模型名稱</label>
                  <select className="form-select" value={form.model_name} onChange={e => setForm({ ...form, model_name: e.target.value })}>
                    {(modelDefaults[form.provider] || []).map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">API Key</label>
                  <input type="password" className="form-input" placeholder="sk-..." value={form.api_key} onChange={e => setForm({ ...form, api_key: e.target.value })} required />
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Temperature</label>
                    <input type="number" className="form-input" step="0.1" min="0" max="2" value={form.temperature} onChange={e => setForm({ ...form, temperature: parseFloat(e.target.value) })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Max Tokens</label>
                    <input type="number" className="form-input" value={form.max_tokens} onChange={e => setForm({ ...form, max_tokens: parseInt(e.target.value) })} />
                  </div>
                </div>
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.is_default} onChange={e => setForm({ ...form, is_default: e.target.checked })} />
                    <span className="form-label" style={{ margin: 0 }}>設為預設模型</span>
                  </label>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-ghost" onClick={() => setShowAdd(false)}>取消</button>
                  <button type="submit" className="btn btn-primary">儲存</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
