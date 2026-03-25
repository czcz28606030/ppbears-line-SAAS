'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '../../../lib/api';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  created_at: string;
}

const PLAN_COLORS: Record<string, string> = {
  free: '#6b7280',
  starter: '#3b82f6',
  professional: '#8b5cf6',
  enterprise: '#f59e0b',
};

const STATUS_COLORS: Record<string, string> = {
  active: '#10b981',
  suspended: '#ef4444',
};

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '', slug: '', plan: 'starter', adminEmail: '', adminPassword: '',
  });
  const [message, setMessage] = useState('');

  useEffect(() => { fetchTenants(); }, []);

  async function fetchTenants() {
    setLoading(true);
    try {
      const d = await apiFetch<{ tenants: Tenant[] }>('/api/admin/tenants');
      setTenants(d.tenants);
    } finally { setLoading(false); }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await apiFetch('/api/admin/tenants', { method: 'POST', body: JSON.stringify(form) });
      setMessage('租戶建立成功！');
      setShowCreate(false);
      setForm({ name: '', slug: '', plan: 'starter', adminEmail: '', adminPassword: '' });
      fetchTenants();
    } catch (err: any) {
      setMessage(`錯誤：${err.message}`);
    } finally { setCreating(false); }
  }

  async function toggleStatus(t: Tenant) {
    const newStatus = t.status === 'active' ? 'suspended' : 'active';
    await apiFetch(`/api/admin/tenants/${t.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
    fetchTenants();
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">租戶管理</h1>
          <p className="page-subtitle">管理所有 SaaS 客戶與其方案設定</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ 新增租戶</button>
      </div>

      {message && (
        <div className="alert" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: '8px', background: 'rgba(16,185,129,0.1)', border: '1px solid #10b981', color: '#10b981' }}>
          {message}
          <button onClick={() => setMessage('')} style={{ marginLeft: '1rem', color: 'inherit', cursor: 'pointer', background:'none', border:'none' }}>✕</button>
        </div>
      )}

      {showCreate && (
        <div className="card" style={{ marginBottom: '1.5rem', border: '1px solid rgba(99,102,241,0.4)' }}>
          <h3 style={{ marginBottom: '1rem' }}>新增租戶</h3>
          <form onSubmit={handleCreate}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {[
                { label: '公司名稱', key: 'name', placeholder: 'PPBears 範例店' },
                { label: '識別碼 (slug)', key: 'slug', placeholder: 'ppbears-sample' },
                { label: '管理員 Email', key: 'adminEmail', placeholder: 'admin@example.com' },
                { label: '管理員密碼', key: 'adminPassword', placeholder: '••••••••', type: 'password' },
              ].map(f => (
                <div className="form-group" key={f.key}>
                  <label className="form-label">{f.label}</label>
                  <input className="form-input" type={f.type || 'text'} placeholder={f.placeholder}
                    value={(form as any)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} required />
                </div>
              ))}
              <div className="form-group">
                <label className="form-label">方案</label>
                <select className="form-input" value={form.plan} onChange={e => setForm(p => ({ ...p, plan: e.target.value }))}>
                  <option value="free">免費 (500訊息/月)</option>
                  <option value="starter">入門 (3,000訊息/月)</option>
                  <option value="professional">專業 (15,000訊息/月)</option>
                  <option value="enterprise">企業 (無限)</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? '建立中...' : '確認建立'}
              </button>
              <button type="button" className="btn" onClick={() => setShowCreate(false)}>取消</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="loading-state"><div className="loading-spinner" /></div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>租戶名稱</th>
                <th>識別碼</th>
                <th>方案</th>
                <th>狀態</th>
                <th>建立日期</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map(t => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td><code style={{ background: 'rgba(99,102,241,0.15)', padding: '2px 6px', borderRadius: 4, fontSize: '0.8rem' }}>{t.slug}</code></td>
                  <td>
                    <span className="badge" style={{ background: PLAN_COLORS[t.plan] + '22', color: PLAN_COLORS[t.plan], border: `1px solid ${PLAN_COLORS[t.plan]}55` }}>
                      {t.plan}
                    </span>
                  </td>
                  <td>
                    <span className="badge" style={{ background: STATUS_COLORS[t.status] + '22', color: STATUS_COLORS[t.status] }}>
                      {t.status === 'active' ? '運行中' : '已停用'}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    {new Date(t.created_at).toLocaleDateString('zh-TW')}
                  </td>
                  <td>
                    <button className="btn" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => toggleStatus(t)}>
                      {t.status === 'active' ? '停用' : '啟用'}
                    </button>
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>尚無租戶</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
