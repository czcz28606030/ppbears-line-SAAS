'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { BookOpen, Upload, Trash2, FileText, RefreshCw, Edit2 } from 'lucide-react';

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
  const [editDoc, setEditDoc] = useState<{ id: string; content: string; filename: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function fetchDocs() {
    setLoading(true);
    try {
      const data = await apiFetch<{ documents: KnowledgeDoc[] }>('/api/admin/knowledge');
      setDocs(data.documents || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function handleUpload() {
    if (!form.file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', form.file);
      formData.append('category', form.category);

      await apiFetch('/api/admin/knowledge/upload', {
        method: 'POST',
        body: formData,
      });

      setShowUpload(false);
      setForm({ category: 'general', file: null });
      fetchDocs();
    } catch (err: any) {
      alert('上傳失敗: ' + (err.message || 'Unknown error'));
    } finally {
      setUploading(false);
    }
  }

  async function handleEditClick(doc: KnowledgeDoc) {
    try {
      const { content } = await apiFetch<{ content: string }>(`/api/admin/knowledge/${doc.id}/content`);
      // Fallback empty text if null
      setEditDoc({ id: doc.id, content: content || '', filename: doc.filename });
    } catch (err: any) {
      alert('無法載入文件內容: ' + (err.message || 'Error'));
    }
  }

  async function handleSaveEdit() {
    if (!editDoc) return;
    setSaving(true);
    try {
      await apiFetch(`/api/admin/knowledge/${editDoc.id}/content`, {
        method: 'PUT',
        body: JSON.stringify({ content: editDoc.content }),
      });
      setEditDoc(null);
      fetchDocs();
    } catch (err: any) {
      alert('儲存失敗: ' + (err.message || 'Error'));
    } finally {
      setSaving(false);
    }
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
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleEditClick(doc)} title="編輯內容">
                        <Edit2 size={13} />
                      </button>
                      <button className="btn btn-danger btn-sm" title="刪除">
                        <Trash2 size={13} />
                      </button>
                    </td>
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
                <button className="btn btn-primary" disabled={!form.file || uploading} onClick={handleUpload}>
                  {uploading ? '上傳中...' : '確認上傳'}
                </button>
              </div>
            </div>
          </div>
        )}

        {editDoc && (
          <div className="modal-overlay" onClick={() => setEditDoc(null)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ width: '80%', maxWidth: '800px' }}>
              <h3 className="modal-title">編輯文件：{editDoc.filename}</h3>
              <div className="form-group">
                <textarea 
                  className="form-input" 
                  style={{ height: '400px', resize: 'vertical', fontFamily: 'monospace' }}
                  value={editDoc.content}
                  onChange={e => setEditDoc({ ...editDoc, content: e.target.value })}
                  placeholder="輸入或貼上文件純文字內容..."
                />
              </div>
              <div className="modal-footer">
                <button className="btn btn-ghost" onClick={() => setEditDoc(null)}>取消</button>
                <button className="btn btn-primary" disabled={saving} onClick={handleSaveEdit}>
                  {saving ? '儲存中...' : '儲存變更'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
