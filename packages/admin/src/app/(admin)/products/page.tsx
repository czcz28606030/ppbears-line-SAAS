'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { Package, RefreshCw, ExternalLink } from 'lucide-react';

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

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  async function fetchProducts() {
    try {
      const data = await apiFetch<{ products: Product[] }>('/api/admin/products');
      setProducts(data.products || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function triggerSync() {
    setSyncing(true);
    try {
      await apiFetch('/api/admin/products/sync', { method: 'POST' });
      setTimeout(fetchProducts, 2000);
    } catch (err: any) { alert(err.message); }
    finally { setSyncing(false); }
  }

  useEffect(() => { fetchProducts(); }, []);

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">📦 產品索引</span>
        <div className="topbar-right">
          <button className="btn btn-ghost btn-sm" onClick={fetchProducts}><RefreshCw size={14} /></button>
          <button className="btn btn-primary btn-sm" onClick={triggerSync} disabled={syncing}>
            <RefreshCw size={14} className={syncing ? 'animate-pulse' : ''} />
            {syncing ? '同步中...' : '立即同步'}
          </button>
          <div className="topbar-avatar">A</div>
        </div>
      </div>

      <div className="page-content">
        <div className="section-header">
          <div>
            <div className="section-title">WooCommerce 產品索引</div>
            <div className="section-subtitle">同步自 ppbears.com，用於新品推薦回覆</div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 'var(--space-lg)', background: 'rgba(96,165,250,0.05)', borderColor: 'rgba(96,165,250,0.2)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--status-info)' }}>💡 自動同步機制（Phase 2）</div>
          <p className="text-muted text-sm">產品索引每日自動同步 WooCommerce 商品。當客戶查詢手機型號或新品時，系統從此索引匹配並回傳官網連結。</p>
        </div>

        <div className="data-table-wrapper">
          {loading ? (
            <div className="loading-center"><div className="loading-spinner" /></div>
          ) : products.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><Package size={40} /></div>
              <p>尚無產品索引</p>
              <p className="text-xs">設定 WooCommerce API 後點擊「立即同步」</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>商品名稱</th>
                  <th>分類</th>
                  <th>支援機型</th>
                  <th>價格</th>
                  <th>上次同步</th>
                  <th>連結</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
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
