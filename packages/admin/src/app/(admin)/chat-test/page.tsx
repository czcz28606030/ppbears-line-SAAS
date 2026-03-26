'use client';

import { useState, useRef, useEffect } from 'react';
import { apiFetch } from '../../../lib/api';
import { Send, Trash2, Bot, Package, BookOpen, Cpu, Loader2, FlaskConical } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: { usedProducts: boolean; usedKnowledge: boolean; productCount: number; kbCount: number };
  model?: string;
  provider?: string;
  timestamp: Date;
}

export default function ChatTestPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: 'user', content: text, timestamp: new Date() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const history = newMessages.slice(0, -1).map(m => ({ role: m.role, content: m.content }));
      const data = await apiFetch<{
        reply: string;
        sources: { usedProducts: boolean; usedKnowledge: boolean; productCount: number; kbCount: number };
        model: string;
        provider: string;
      }>('/api/admin/chat/test', {
        method: 'POST',
        body: JSON.stringify({ message: text, history }),
      });

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.reply,
        sources: data.sources,
        model: data.model,
        provider: data.provider,
        timestamp: new Date(),
      }]);
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ 錯誤：${err.message}`,
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function clearChat() {
    setMessages([]);
    textareaRef.current?.focus();
  }

  function SourceBadge({ sources }: { sources?: Message['sources'] }) {
    if (!sources) return null;
    const badges = [];
    if (sources.usedProducts) badges.push(
      <span key="prod" style={badgeStyle('#1e3a5f', '#5bbdff')}>
        <Package size={11} /> 產品索引 ×{sources.productCount}
      </span>
    );
    if (sources.usedKnowledge) badges.push(
      <span key="kb" style={badgeStyle('#1e3d1e', '#5dde6b')}>
        <BookOpen size={11} /> 知識庫 ×{sources.kbCount}
      </span>
    );
    if (!sources.usedProducts && !sources.usedKnowledge) badges.push(
      <span key="ai" style={badgeStyle('#3a2d5c', '#c4a3ff')}>
        <Cpu size={11} /> AI 推理
      </span>
    );
    return <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>{badges}</div>;
  }

  function badgeStyle(bg: string, color: string): React.CSSProperties {
    return {
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: bg, color, padding: '3px 8px', borderRadius: 12,
      fontSize: 11, fontWeight: 600, letterSpacing: 0.3,
    };
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 0 20px 0', borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: 'linear-gradient(135deg, #6c47ff, #c471ed)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FlaskConical size={20} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>聊天測試平台</h1>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
              模擬客戶對話，驗證知識庫與產品索引效果
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-muted)',
              cursor: 'pointer', fontSize: 13, transition: 'all 0.2s',
            }}
            onMouseOver={e => (e.currentTarget.style.borderColor = '#ff4d4d', e.currentTarget.style.color = '#ff4d4d')}
            onMouseOut={e => (e.currentTarget.style.borderColor = 'var(--border)', e.currentTarget.style.color = 'var(--text-muted)')}
          >
            <Trash2 size={14} /> 清除對話
          </button>
        )}
      </div>

      {/* Chat area */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '20px 0',
        display: 'flex', flexDirection: 'column', gap: 16,
        minHeight: 0,
      }}>
        {messages.length === 0 && (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🧪</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>開始測試您的 AI 客服</div>
            <div style={{ fontSize: 13 }}>輸入任何問題，測試機器人的回覆效果</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
              {['iPhone 17 Pro 有什麼殼？', '你們的客製化流程是什麼？', '我想查詢訂單', 'Samsung S25 Ultra'].map(q => (
                <button key={q} onClick={() => setInput(q)} style={{
                  padding: '8px 14px', borderRadius: 20, border: '1px solid var(--border)',
                  background: 'var(--surface)', color: 'var(--text-secondary)',
                  cursor: 'pointer', fontSize: 13, transition: 'all 0.2s',
                }}
                  onMouseOver={e => (e.currentTarget.style.borderColor = 'var(--accent)', e.currentTarget.style.color = 'var(--accent)')}
                  onMouseOut={e => (e.currentTarget.style.borderColor = 'var(--border)', e.currentTarget.style.color = 'var(--text-secondary)')}
                >{q}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{
            display: 'flex',
            flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
            alignItems: 'flex-start', gap: 10,
          }}>
            {/* Avatar */}
            <div style={{
              width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: msg.role === 'user'
                ? 'linear-gradient(135deg, #6c47ff, #c471ed)'
                : 'linear-gradient(135deg, #1a1a2e, #16213e)',
              border: '2px solid var(--border)',
              fontSize: 16,
            }}>
              {msg.role === 'user' ? '👤' : '🐻'}
            </div>

            {/* Bubble */}
            <div style={{ maxWidth: '72%' }}>
              <div style={{
                padding: '12px 16px', borderRadius: msg.role === 'user' ? '18px 4px 18px 18px' : '4px 18px 18px 18px',
                background: msg.role === 'user'
                  ? 'linear-gradient(135deg, #6c47ff, #8b5cf6)'
                  : 'var(--surface)',
                border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none',
                color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
                fontSize: 14, lineHeight: 1.6,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
              }}>
                {msg.content}
              </div>

              {/* Source badges for bot replies */}
              {msg.role === 'assistant' && <SourceBadge sources={msg.sources} />}

              {/* Meta: model + time */}
              <div style={{
                fontSize: 11, color: 'var(--text-muted)', marginTop: 4,
                textAlign: msg.role === 'user' ? 'right' : 'left',
              }}>
                {msg.timestamp.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
                {msg.model && <span style={{ marginLeft: 8, opacity: 0.7 }}>· {msg.provider}/{msg.model}</span>}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'linear-gradient(135deg, #1a1a2e, #16213e)',
              border: '2px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
            }}>🐻</div>
            <div style={{
              padding: '12px 16px', borderRadius: '4px 18px 18px 18px',
              background: 'var(--surface)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13,
            }}>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
              AI 正在思考中...
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div style={{
        borderTop: '1px solid var(--border)', paddingTop: 16, flexShrink: 0,
        display: 'flex', gap: 10, alignItems: 'flex-end',
      }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="輸入測試訊息... (Enter 發送，Shift+Enter 換行)"
          rows={2}
          style={{
            flex: 1, padding: '12px 16px', borderRadius: 12,
            border: '1px solid var(--border)', background: 'var(--surface)',
            color: 'var(--text-primary)', fontSize: 14, resize: 'none',
            outline: 'none', lineHeight: 1.5, fontFamily: 'inherit',
            transition: 'border-color 0.2s',
          }}
          onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
          onBlur={e => (e.target.style.borderColor = 'var(--border)')}
          autoFocus
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || loading}
          style={{
            width: 48, height: 48, borderRadius: 12, border: 'none',
            background: input.trim() && !loading
              ? 'linear-gradient(135deg, #6c47ff, #c471ed)'
              : 'var(--surface)',
            color: input.trim() && !loading ? '#fff' : 'var(--text-muted)',
            cursor: input.trim() && !loading ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s', flexShrink: 0,
            boxShadow: input.trim() && !loading ? '0 4px 15px rgba(108,71,255,0.4)' : 'none',
          }}
        >
          <Send size={18} />
        </button>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
