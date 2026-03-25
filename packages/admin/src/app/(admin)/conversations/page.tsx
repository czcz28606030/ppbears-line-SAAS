'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { MessageSquare, Search, Eye } from 'lucide-react';

interface Conversation {
  id: string;
  channel_type: string;
  status: string;
  last_message_at: string;
  started_at: string;
  users?: { display_name: string; unified_user_id: string };
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  async function fetchConversations() {
    setLoading(true);
    try {
      const params = statusFilter ? `?status=${statusFilter}` : '';
      const data = await apiFetch<{ conversations: Conversation[]; total: number }>(`/api/admin/conversations${params}`);
      setConversations(data.conversations);
      setTotal(data.total);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchConversations(); }, [statusFilter]);

  const channelEmoji: Record<string, string> = { line: '💬 LINE', messenger: '📘 FB', whatsapp: '💚 WA' };
  const statusBadge: Record<string, string> = { active: 'badge-success', live_agent: 'badge-live', closed: 'badge-muted' };
  const statusLabel: Record<string, string> = { active: '進行中', live_agent: '真人接管', closed: '已結束' };

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">💬 對話紀錄</span>
        <div className="topbar-right">
          <select className="form-select" style={{ width: 140 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">全部狀態</option>
            <option value="active">進行中</option>
            <option value="live_agent">真人接管</option>
            <option value="closed">已結束</option>
          </select>
          <div className="topbar-avatar">A</div>
        </div>
      </div>

      <div className="page-content">
        <div className="section-header">
          <div>
            <div className="section-title">對話紀錄</div>
            <div className="section-subtitle">共 {total} 筆對話</div>
          </div>
        </div>

        <div className="data-table-wrapper">
          {loading ? (
            <div className="loading-center"><div className="loading-spinner" /></div>
          ) : conversations.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><MessageSquare size={40} /></div>
              <p>目前沒有對話紀錄</p>
              <p className="text-xs">完成 LINE 設定後，客戶訊息將顯示於此</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>用戶</th>
                  <th>通路</th>
                  <th>狀態</th>
                  <th>最後訊息</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((conv) => (
                  <tr key={conv.id}>
                    <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      {conv.users?.display_name || conv.users?.unified_user_id || '匿名用戶'}
                    </td>
                    <td>{channelEmoji[conv.channel_type] || conv.channel_type}</td>
                    <td>
                      <span className={`badge ${statusBadge[conv.status] || 'badge-muted'}`}>
                        <span className="badge-dot" />
                        {statusLabel[conv.status] || conv.status}
                      </span>
                    </td>
                    <td className="text-sm">{new Date(conv.last_message_at).toLocaleString('zh-TW')}</td>
                    <td>
                      <a href={`/conversations/${conv.id}`} className="btn btn-ghost btn-sm">
                        <Eye size={13} /> 查看
                      </a>
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
