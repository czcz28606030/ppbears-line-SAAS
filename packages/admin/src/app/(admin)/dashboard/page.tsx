'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { MessageSquare, Bot, Headphones, AlertCircle, RefreshCw, TrendingUp, Zap } from 'lucide-react';

interface Stats {
  todayConversations: number;
  todayAiReplies: number;
  activeLiveAgents: number;
  todayErrors: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchStats() {
    try {
      const data = await apiFetch<Stats>('/api/admin/dashboard/stats');
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchStats(); }, []);

  const statCards = stats ? [
    {
      label: '今日對話數',
      value: stats.todayConversations,
      icon: MessageSquare,
      color: 'var(--brand-primary)',
      bg: 'rgba(108,99,255,0.12)',
    },
    {
      label: 'AI 回覆數',
      value: stats.todayAiReplies,
      icon: Bot,
      color: 'var(--status-success)',
      bg: 'var(--status-success-bg)',
    },
    {
      label: '真人接管中',
      value: stats.activeLiveAgents,
      icon: Headphones,
      color: 'var(--status-live)',
      bg: 'var(--status-live-bg)',
    },
    {
      label: '今日錯誤',
      value: stats.todayErrors,
      icon: AlertCircle,
      color: 'var(--status-error)',
      bg: 'var(--status-error-bg)',
    },
  ] : [];

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">🏠 儀表板</span>
        <div className="topbar-right">
          <button className="btn btn-ghost btn-sm" onClick={fetchStats}>
            <RefreshCw size={14} /> 重新整理
          </button>
          <div className="topbar-avatar">A</div>
        </div>
      </div>

      <div className="page-content">
        {/* Welcome Banner */}
        <div className="card" style={{
          marginBottom: 'var(--space-xl)',
          background: 'linear-gradient(135deg, rgba(108,99,255,0.15), rgba(255,101,132,0.08))',
          border: '1px solid rgba(108,99,255,0.25)',
        }}>
          <div className="flex-row">
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>
                歡迎回來，PPBears 管理員 👋
              </h2>
              <p className="text-muted text-sm">
                以下是今日系統運行概況 · {new Date().toLocaleDateString('zh-TW', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
            <div className="ml-auto" style={{ fontSize: 48, opacity: 0.6 }}>🐻</div>
          </div>
        </div>

        {/* Stats Grid */}
        {loading ? (
          <div className="loading-center"><div className="loading-spinner" /></div>
        ) : (
          <div className="stats-grid">
            {statCards.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.label} className="stat-card">
                  <div className="stat-icon" style={{ background: s.bg }}>
                    <Icon size={20} color={s.color} />
                  </div>
                  <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
                  <div className="stat-label">{s.label}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Quick Actions */}
        <div className="section-header">
          <div>
            <div className="section-title">快速操作</div>
            <div className="section-subtitle">常用管理功能捷徑</div>
          </div>
        </div>
        <div className="grid-3" style={{ marginBottom: 'var(--space-xl)' }}>
          {[
            { href: '/conversations', icon: '💬', title: '查看對話', desc: '瀏覽最新客服對話' },
            { href: '/knowledge', icon: '📚', title: '上傳知識庫', desc: '新增或更新文件' },
            { href: '/models', icon: '🤖', title: '切換模型', desc: '更換 AI 模型設定' },
            { href: '/live-agent', icon: '🎧', title: '真人接管', desc: '管理客服接管 session' },
            { href: '/products', icon: '📦', title: '同步產品', desc: '更新產品索引資訊' },
            { href: '/audit-logs', icon: '📋', title: '稽核日誌', desc: '查看操作紀錄' },
          ].map((item) => (
            <a key={item.href} href={item.href} className="card flex-row gap-md" style={{ cursor: 'pointer', textDecoration: 'none' }}>
              <span style={{ fontSize: 28 }}>{item.icon}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{item.title}</div>
                <div className="text-muted text-xs">{item.desc}</div>
              </div>
            </a>
          ))}
        </div>

        {/* System Status */}
        <div className="data-table-wrapper">
          <div className="data-table-header">
            <span className="data-table-title">系統模組狀態</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>模組</th>
                <th>狀態</th>
                <th>說明</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: '🔌 LINE Webhook', status: 'ready', desc: '等待連線設定' },
                { name: '🤖 LLM 路由器', status: 'ready', desc: '等待 API Key 設定' },
                { name: '📚 知識庫 RAG', status: 'ready', desc: '等待文件上傳' },
                { name: '⏱️ 訊息合併閘門', status: 'active', desc: '8秒合併視窗已就緒' },
                { name: '🎧 真人接管', status: 'active', desc: '觸發詞監聽中' },
                { name: '🗄️ 資料庫', status: 'ready', desc: '等待 Supabase 連線' },
              ].map((row) => (
                <tr key={row.name}>
                  <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{row.name}</td>
                  <td>
                    <span className={`badge ${row.status === 'active' ? 'badge-success' : 'badge-info'}`}>
                      <span className="badge-dot" />
                      {row.status === 'active' ? '運行中' : '就緒'}
                    </span>
                  </td>
                  <td>{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
