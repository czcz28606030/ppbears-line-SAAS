'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '../../../../lib/api';
import { ArrowLeft, MessageSquare, User, Clock, Bot, UserCheck } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  metadata_json?: { provider?: string; model?: string };
}

interface ConversationDetail {
  id: string;
  channel_type: string;
  status: string;
  started_at: string;
  last_message_at: string;
  users?: { display_name: string; unified_user_id: string };
}

interface ApiResponse {
  conversation: ConversationDetail;
  messages: Message[];
}

export default function ConversationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const conversationId = params.id as string;

  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchDetail() {
      try {
        const data = await apiFetch<ApiResponse>(`/api/admin/conversations/${conversationId}`);
        setConv(data.conversation);
        setMessages(data.messages || []);
      } catch (err: any) {
        setError(err.message || '載入失敗');
      } finally {
        setLoading(false);
      }
    }
    if (conversationId) fetchDetail();
  }, [conversationId]);

  const statusBadge: Record<string, string> = { active: 'badge-success', live_agent: 'badge-live', closed: 'badge-muted' };
  const statusLabel: Record<string, string> = { active: '進行中', live_agent: '真人接管', closed: '已結束' };
  const channelEmoji: Record<string, string> = { line: '💬 LINE', messenger: '📘 FB', whatsapp: '💚 WA' };

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">💬 對話詳情</span>
        <div className="topbar-right">
          <div className="topbar-avatar">A</div>
        </div>
      </div>

      <div className="page-content">
        <button className="btn btn-ghost btn-sm" style={{ marginBottom: 16 }} onClick={() => router.back()}>
          <ArrowLeft size={14} /> 返回列表
        </button>

        {loading && <div className="loading-center"><div className="loading-spinner" /></div>}

        {error && (
          <div className="empty-state">
            <p style={{ color: 'var(--danger)' }}>⚠️ {error}</p>
          </div>
        )}

        {conv && (
          <>
            {/* Conversation Info Card */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 4 }}>用戶</div>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <User size={14} />
                    {conv.users?.display_name || conv.users?.unified_user_id || '匿名用戶'}
                  </div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 4 }}>通路</div>
                  <div style={{ fontWeight: 600 }}>{channelEmoji[conv.channel_type] || conv.channel_type}</div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 4 }}>狀態</div>
                  <span className={`badge ${statusBadge[conv.status] || 'badge-muted'}`}>
                    <span className="badge-dot" />
                    {statusLabel[conv.status] || conv.status}
                  </span>
                </div>
                <div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 4 }}>開始時間</div>
                  <div style={{ fontSize: 13 }}>{new Date(conv.started_at).toLocaleString('zh-TW')}</div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 4 }}>最後訊息</div>
                  <div style={{ fontSize: 13 }}>{new Date(conv.last_message_at).toLocaleString('zh-TW')}</div>
                </div>
              </div>
            </div>

            {/* Message Thread */}
            <div className="card">
              <div className="card-header">
                <MessageSquare size={16} />
                <span>訊息記錄（{messages.length} 則）</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
                {messages.length === 0 && (
                  <div className="empty-state"><p>暫無訊息記錄</p></div>
                )}
                {messages.map((msg: Message) => (
                  <div
                    key={msg.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginBottom: 4,
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                    }}>
                      {msg.role === 'user' ? <User size={11} /> : <Bot size={11} />}
                      <span>{msg.role === 'user' ? '客戶' : 'AI 客服'}</span>
                      <span>·</span>
                      <span>{new Date(msg.created_at).toLocaleString('zh-TW')}</span>
                      {msg.metadata_json?.model && (
                        <span style={{ opacity: 0.6 }}>· {msg.metadata_json.model}</span>
                      )}
                    </div>
                    <div style={{
                      maxWidth: '75%',
                      padding: '10px 14px',
                      borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-secondary)',
                      color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
                      fontSize: 14,
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}>
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
