'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { BookOpen, Upload, Trash2, FileText, RefreshCw } from 'lucide-react';

interface KnowledgeDoc {
  id: string;
  filename: string;
  file_type: string;
  category: string;
  status: string;
  uploaded_at: string;
}

export default function KnowledgePage() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [form, setForm] = useState({ category: 'general', file: null as File | null });

  async function fetchDocs() {
    setLoading(true);
    try {
      const data = await apiFetch<{ documents: KnowledgeDoc[] }>('/api/admin/knowledge');
      setDocs(data.documents || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchDocs(); }, []);

  const categories = [
    { value: 'general', label: '一般' },
    { value: 'brand', label: '品牌語調' },
    { value: 'product', label: '產品介紹' },
    { value: 'sop', label: 'SOP 流程' },
    { value: 'after_sales', label: '售後服務' },
    { value: 'shipping', label: '出貨規則' },
    { value: 'policy', label: '退換貨政策' },
    { value: 'faq', label: 'FAQ' },
    { value: 'forbidden', label: '禁止聲明' },
  ];

  const statusBadge: Record<string, string> = { pending: 'badge-muted', processing: 'badge-warning', ready: 'badge-success', error: 'badge-error' };
  const statusLabel: Record<string, string> = { pending: '等待中', processing: '處理中', ready: '就緒', error: '錯誤' };

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">📚 知識庫管理</span>
        <div className="topbar-right">
          <button className="btn btn-ghost btn-sm" onClick={fetchDocs}><RefreshCw size={14} /></button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowUpload(true)}>
            <Upload size={14} /> 上傳文件
          </button>
          <div className="topbar-avatar">A</div>
        </div>
      </div>

      <div className="page-content">
        <div className="section-header">
          <div>
            <div className="section-title">知識庫文件</div>
            <div className="section-subtitle">上傳後文件將自動分塊、向量化並建立索引（Phase 2）</div>
          </div>
        </div>

        {/* Category Legend */}
        <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
          <div className="card-title">文件分類</div>
          <div className="flex-row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {categories.map(c => (
              <span key={c.value} className="badge badge-info">{c.label}</span>
            ))}
          </div>
        </div>

        <div className="data-table-wrapper">
          {loading ? (
            <div className="loading-center"><div className="loading-spinner" /></div>
          ) : docs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><BookOpen size={40} /></div>
              <p>知識庫尚無文件</p>
              <p className="text-xs">支援 PDF、DOCX、TXT、MD、CSV、JSON</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>文件名稱</th>
                  <th>分類</th>
                  <th>格式</th>
                  <th>狀態</th>
                  <th>上傳時間</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((doc) => (
                  <tr key={doc.id}>
                    <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      <div className="flex-row gap-sm"><FileText size={14} /> {doc.filename}</div>
                    </td>
                    <td><span className="badge badge-info">{categories.find(c => c.value === doc.category)?.label || doc.category}</span></td>
                    <td><span className="badge badge-muted">{doc.file_type}</span></td>
                    <td><span className={`badge ${statusBadge[doc.status] || 'badge-muted'}`}><span className="badge-dot" />{statusLabel[doc.status] || doc.status}</span></td>
                    <td className="text-sm">{new Date(doc.uploaded_at).toLocaleString('zh-TW')}</td>
                    <td><button className="btn btn-danger btn-sm"><Trash2 size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {showUpload && (
          <div className="modal-overlay" onClick={() => setShowUpload(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <h3 className="modal-title">上傳知識庫文件</h3>
              <div className="form-group">
                <label className="form-label">文件分類</label>
                <select className="form-select" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">選擇文件</label>
                <input type="file" className="form-input" accept=".pdf,.docx,.txt,.md,.csv,.json" onChange={e => setForm({ ...form, file: e.target.files?.[0] || null })} />
                <div className="text-muted text-xs" style={{ marginTop: 4 }}>支援：PDF、DOCX、TXT、MD、CSV、JSON</div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-ghost" onClick={() => setShowUpload(false)}>取消</button>
                <button className="btn btn-primary" disabled={!form.file || uploading}>
                  {uploading ? '上傳中...' : '確認上傳'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
