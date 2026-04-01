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
  // Staging index
  const [stagingCount, setStagingCount] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ promoted: number; time: string } | null>(null);

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
      const newList = (data.products || []).filter((p: any) => p.status === 'active' || !p.status);
      setProducts(newList);
      return newList.length;
    } catch (err) { console.error(err); return 0; }
    finally { setLoading(false); }
  }

  async function fetchStagingCount() {
    try {
      const data = await apiFetch<{ stagingCount: number; activeCount: number }>('/api/admin/products/staging/count');
      setStagingCount(data.stagingCount || 0);
      setActiveCount(data.activeCount || 0);
    } catch { /* ignore */ }
  }

  async function applyStaging() {
    if (!confirm(`確定要將 ${stagingCount} 筆暫存商品套用到正式索引嗎？\n（目前正式索引有 ${activeCount} 筆，套用後將被取代）`)) return;
    setApplying(true);
    setApplyResult(null);
    try {
      const data = await apiFetch<{ success: boolean; promoted: number }>('/api/admin/products/staging/apply', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (data.success) {
        setApplyResult({ promoted: data.promoted, time: new Date().toLocaleTimeString('zh-TW') });
        setStagingCount(0);
        setActiveCount(data.promoted);
        await fetchProducts();
        await fetchStagingCount();
      }
    } catch (err: any) { alert('套用失敗：' + err.message); }
    finally { setApplying(false); }
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

  useEffect(() => { fetchProducts(); fetchAllowlist(); fetchStagingCount(); }, []);

  const isAllowlistMode = allowlist.length > 0;

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">📦 產品索引</span>
        <div className="topbar-right">
          <button
            className="btn btn-ghost btn-sm"
            title="刷新"
            onClick={() => { fetchProducts(); fetchAllowlist(); fetchStagingCount(); }}
          >
            <RefreshCw size={14} />
          </button>
          <div className="topbar-avatar">A</div>
        </div>
      </div>

      <div className="page-content">

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* 索引狀態卡片 */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Package size={16} /> 產品索引狀態
          </div>

          {/* 數字框 */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            {/* 正式索引 */}
            <div style={{
              flex: 1, minWidth: 160,
              background: activeCount > 0 ? 'rgba(34,197,94,0.08)' : 'rgba(100,116,139,0.08)',
              border: `1px solid ${activeCount > 0 ? 'rgba(34,197,94,0.25)' : 'rgba(100,116,139,0.2)'}`,
              borderRadius: 10, padding: '14px 18px'
            }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: activeCount > 0 ? '#22c55e' : 'var(--text-muted)' }}>
                {loading ? '—' : activeCount.toLocaleString()}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>✅ 正式索引中的商品</div>
            </div>

            {/* 暫存區 */}
            <div style={{
              flex: 1, minWidth: 160,
              background: stagingCount > 0 ? 'rgba(250,204,21,0.08)' : 'rgba(100,116,139,0.06)',
              border: `1px solid ${stagingCount > 0 ? 'rgba(250,204,21,0.35)' : 'rgba(100,116,139,0.15)'}`,
              borderRadius: 10, padding: '14px 18px'
            }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: stagingCount > 0 ? '#f59e0b' : 'var(--text-muted)' }}>
                {loading ? '—' : stagingCount.toLocaleString()}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>📥 暫存區（待套用）</div>
            </div>

            {/* 暫存套用按鈕 */}
            {stagingCount > 0 && (
              <div style={{
                flex: 1, minWidth: 160,
                background: 'rgba(250,204,21,0.12)',
                border: '1px solid rgba(250,204,21,0.4)',
                borderRadius: 10, padding: '14px 18px',
                display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6
              }}>
                <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>暫存區有新資料！</div>
                <button
                  className="btn btn-sm"
                  style={{ background: '#f59e0b', color: '#000', fontWeight: 700, border: 'none', borderRadius: 6 }}
                  onClick={applyStaging}
                  disabled={applying}
                >
                  {applying ? '套用中...' : `⬆️ 套用暫存索引 (${stagingCount.toLocaleString()} 筆)`}
                </button>
              </div>
            )}
          </div>

          {/* 如何同步說明 */}
          <div style={{
            background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)',
            borderRadius: 8, padding: '10px 14px',
            fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8
          }}>
            <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>💡 如何更新商品索引？</span><br />
            <strong>步驟 1</strong>：雙擊專案內的「同步商品索引.bat」（等待約 10~15 分鐘）<br />
            <strong>步驟 2</strong>：回到此頁面，黃色框出現後點「套用暫存索引」按鈕 → 商品立即上線。
          </div>

          {/* 成功 / 失敗 banner */}
          {applyResult && (
            <div style={{
              marginTop: 12,
              background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
              borderRadius: 8, padding: '10px 14px',
              display: 'flex', alignItems: 'center', gap: 10
            }}>
              <span>🚀</span>
              <span style={{ fontWeight: 600, color: '#22c55e' }}>
                套用完成！正式索引已更新為 <strong>{applyResult.promoted.toLocaleString()}</strong> 個商品
              </span>
              <span className="text-xs text-muted" style={{ marginLeft: 'auto' }}>{applyResult.time}</span>
            </div>
          )}
        </div>
        {/* ─────────────────────────────────────────────────────────────────── */}

        {/* Old banners removed — replaced by status card above */}
        {syncResult && (
          <div style={{
            background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
            borderRadius: 8, padding: '10px 16px', marginBottom: 16,
            display: 'flex', alignItems: 'center', gap: 10
          }}>
            <span>✅</span>
            <span style={{ fontWeight: 600, color: '#22c55e' }}>雲端同步完成！共索引 <strong>{syncResult.count}</strong> 個商品</span>
            <span className="text-xs text-muted" style={{ marginLeft: 'auto' }}>{syncResult.time}</span>
          </div>
        )}
        {syncing && (
          <div style={{
            background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.3)',
            borderRadius: 8, padding: '10px 16px', marginBottom: 16,
            display: 'flex', alignItems: 'center', gap: 10
          }}>
            <span>⏳</span>
            <span style={{ color: 'var(--status-info)' }}>正在從 WooCommerce 同步商品，請稍候...</span>
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
