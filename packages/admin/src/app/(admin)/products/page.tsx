'use client';

import { useEffect, useState, useMemo } from 'react';
import { apiFetch, getToken } from '../../../lib/api';
import { Package, RefreshCw, ExternalLink, Plus, Trash2, Link, ChevronUp, ChevronDown } from 'lucide-react';

interface Product {
  id: string;
  woo_product_id: number;
  name: string;
  categories: string;
  price: string;
  url: string;
  phone_models: string;
  synced_at: string;
}

interface AllowlistItem {
  id: string;
  url: string;
  note: string;
  created_at: string;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [allowlist, setAllowlist] = useState<AllowlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newNote, setNewNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [syncResult, setSyncResult] = useState<{ count: number; time: string } | null>(null);
  const [sortColumn, setSortColumn] = useState<keyof Product>('categories');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  const sortedProducts = useMemo(() => {
    return [...products].sort((a, b) => {
      const aVal = String(a[sortColumn] ?? '').toLowerCase();
      const bVal = String(b[sortColumn] ?? '').toLowerCase();
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
  }, [products, sortColumn, sortDir]);

  function handleSort(col: keyof Product) {
    if (col === sortColumn) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortColumn(col); setSortDir('asc'); }
  }

  function SortIcon({ col }: { col: keyof Product }) {
    if (col !== sortColumn) return <ChevronUp size={12} style={{ opacity: 0.2 }} />;
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  }

  async function fetchProducts() {
    try {
      const data = await apiFetch<{ products: Product[] }>('/api/admin/products');
      const newList = data.products || [];
      setProducts(newList);
      return newList.length;
    } catch (err) { console.error(err); return 0; }
    finally { setLoading(false); }
  }

  async function fetchAllowlist() {
    try {
      const data = await apiFetch<{ allowlist: AllowlistItem[] }>('/api/admin/products/allowlist');
      setAllowlist(data.allowlist || []);
    } catch (err) { console.error(err); }
  }

  async function triggerSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const token = getToken();
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/admin/products/sync`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error((err as any).message || (err as any).error || 'Request failed');
      }

      // Poll sync job status until completed or failed (max 90s)
      const started = Date.now();
      const poll = async () => {
        try {
          const data = await apiFetch<{ job: { status: string; items_processed: number; error_message?: string } | null }>(
            '/api/admin/products/sync/last-result'
          );
          const job = data.job;
          if (job && job.status === 'completed') {
            await fetchProducts();
            setSyncResult({ count: job.items_processed ?? 0, time: new Date().toLocaleTimeString('zh-TW') });
            setSyncing(false);
          } else if (job && job.status === 'failed') {
            setSyncing(false);
            alert('同步失敗：' + (job.error_message || '未知錯誤'));
          } else if (Date.now() - started < 90000) {
            setTimeout(poll, 3000);
          } else {
            // Timeout: show current DB count
            const count = await fetchProducts();
            setSyncResult({ count, time: new Date().toLocaleTimeString('zh-TW') });
            setSyncing(false);
          }
        } catch {
          setSyncing(false);
        }
      };
      setTimeout(poll, 5000); // wait 5s before first poll
    } catch (err: any) {
      alert('同步失敗：' + err.message);
      setSyncing(false);
    }
  }

  async function addToAllowlist() {
    if (!newUrl.trim()) return;
    setAdding(true);
    try {
      await apiFetch('/api/admin/products/allowlist', {
        method: 'POST',
        body: JSON.stringify({ url: newUrl.trim(), note: newNote.trim() }),
      });
      setNewUrl('');
      setNewNote('');
      await fetchAllowlist();
    } catch (err: any) { alert('新增失敗：' + err.message); }
    finally { setAdding(false); }
  }

  async function removeFromAllowlist(id: string) {
    setDeleting(true);
    try {
      // Use POST-based delete to avoid DELETE method CORS/caching issues
      const res = await apiFetch<{ success: boolean }>(`/api/admin/products/allowlist/${id}/delete`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setAllowlist(prev => prev.filter(item => item.id !== id));
      setConfirmDeleteId(null);
    } catch (err: any) {
      alert('刪除失敗：' + err.message);
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => { fetchProducts(); fetchAllowlist(); }, []);

  const isAllowlistMode = allowlist.length > 0;

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">📦 產品索引</span>
        <div className="topbar-right">
          <button className="btn btn-ghost btn-sm" onClick={() => { fetchProducts(); fetchAllowlist(); }}><RefreshCw size={14} /></button>
          <button className="btn btn-primary btn-sm" onClick={triggerSync} disabled={syncing}>
            <RefreshCw size={14} className={syncing ? 'animate-pulse' : ''} />
            {syncing ? '同步中...' : '立即同步'}
          </button>
          <div className="topbar-avatar">A</div>
        </div>
      </div>

      <div className="page-content">
        {/* Sync result banner */}
        {syncResult && (
          <div style={{
            background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
            borderRadius: 8, padding: '10px 16px', marginBottom: 16,
            display: 'flex', alignItems: 'center', gap: 10
          }}>
            <span style={{ fontSize: 18 }}>✅</span>
            <span style={{ fontWeight: 600, color: '#22c55e' }}>
              同步完成！目前共索引 <strong>{syncResult.count}</strong> 個商品
            </span>
            <span className="text-xs text-muted" style={{ marginLeft: 'auto' }}>
              {syncResult.time}
            </span>
          </div>
        )}
        {/* Syncing indicator */}
        {syncing && (
          <div style={{
            background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.3)',
            borderRadius: 8, padding: '10px 16px', marginBottom: 16,
            display: 'flex', alignItems: 'center', gap: 10
          }}>
            <span style={{ fontSize: 18 }}>⏳</span>
            <span style={{ color: 'var(--status-info)' }}>正在從 WooCommerce 同步商品，請稍候（約 10~30 秒）...</span>
          </div>
        )}

        <div className="section-header">
          <div>
            <div className="section-title">WooCommerce 產品索引</div>
            <div className="section-subtitle">
              {isAllowlistMode
                ? `白名單模式：僅同步 ${allowlist.length} 個指定商品 URL`
                : '全站模式：同步所有已發佈的 WooCommerce 商品'}
            </div>
          </div>
        </div>

        {/* ── URL 白名單管理 ─────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
          <div style={{ fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link size={16} />
            指定商品 URL 白名單
            {isAllowlistMode ? (
              <span style={{ fontSize: 12, background: 'rgba(96,165,250,0.15)', color: 'var(--status-info)', borderRadius: 4, padding: '2px 8px', marginLeft: 4 }}>
                白名單模式已啟用
              </span>
            ) : (
              <span style={{ fontSize: 12, background: 'rgba(156,163,175,0.15)', color: 'var(--text-muted)', borderRadius: 4, padding: '2px 8px', marginLeft: 4 }}>
                全站同步模式
              </span>
            )}
          </div>
          <p className="text-sm text-muted" style={{ marginBottom: 16 }}>
            新增商品 URL 後，「立即同步」將只索引白名單內的商品。清空白名單則同步全站所有商品。
          </p>

          {/* 新增欄位 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              className="input"
              style={{ flex: 2 }}
              placeholder="貼上商品網址，例如 https://ppbears.com/product/water-case/"
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addToAllowlist()}
            />
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="備註（選填）"
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
            />
            <button className="btn btn-primary btn-sm" onClick={addToAllowlist} disabled={adding || !newUrl.trim()}>
              <Plus size={14} /> 新增
            </button>
          </div>

          {/* 白名單清單 */}
          {allowlist.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {allowlist.map(item => (
                <div key={item.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: confirmDeleteId === item.id ? 'rgba(239,68,68,0.05)' : 'rgba(96,165,250,0.05)',
                  border: `1px solid ${confirmDeleteId === item.id ? 'rgba(239,68,68,0.3)' : 'rgba(96,165,250,0.15)'}`,
                  borderRadius: 6, padding: '8px 12px', transition: 'all 0.2s'
                }}>
                  <ExternalLink size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <a href={item.url} target="_blank" className="text-sm" style={{
                    flex: 1, color: 'var(--status-info)', overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                  }}>{item.url}</a>
                  {item.note && <span className="text-xs text-muted">{item.note}</span>}

                  {confirmDeleteId === item.id ? (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <span className="text-xs" style={{ color: 'var(--status-error)', whiteSpace: 'nowrap' }}>確定刪除？</span>
                      <button
                        className="btn btn-sm"
                        style={{ padding: '2px 8px', background: 'rgba(239,68,68,0.8)', color: '#fff', fontSize: 12 }}
                        onClick={() => removeFromAllowlist(item.id)}
                        disabled={deleting}
                      >
                        {deleting ? '...' : '確定'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '2px 8px', fontSize: 12 }}
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={deleting}
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '2px 6px', color: 'var(--status-error)' }}
                      onClick={() => setConfirmDeleteId(item.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted">尚未加入任何 URL，目前為「同步全站商品」模式。</p>
          )}
        </div>

        {/* ── 已索引商品清單 ─────────────────────────────────────────────── */}
        <div className="data-table-wrapper">
          {loading ? (
            <div className="loading-center"><div className="loading-spinner" /></div>
          ) : products.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><Package size={40} /></div>
              <p>尚無產品索引</p>
              <p className="text-xs">設定 WooCommerce API 後，加入 URL 並點擊「立即同步」</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  {([['name', '商品名稱'], ['categories', '分類'], ['phone_models', '支援機型'], ['price', '價格'], ['synced_at', '上次同步']] as [keyof Product, string][]).map(([col, label]) => (
                    <th
                      key={col}
                      onClick={() => handleSort(col)}
                      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {label} <SortIcon col={col} />
                      </span>
                    </th>
                  ))}
                  <th>連結</th>
                </tr>
              </thead>
              <tbody>
                {sortedProducts.map((p) => (
                  <tr key={p.id}>
                    <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{p.name}</td>
                    <td className="text-sm">{p.categories}</td>
                    <td className="text-sm" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.phone_models}</td>
                    <td>{p.price ? `NT$${p.price}` : '—'}</td>
                    <td className="text-sm">{new Date(p.synced_at).toLocaleString('zh-TW')}</td>
                    <td>
                      <a href={p.url} target="_blank" className="btn btn-ghost btn-sm"><ExternalLink size={13} /></a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
