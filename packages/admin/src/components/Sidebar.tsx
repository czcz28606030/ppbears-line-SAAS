'use client';

import Link from 'next/link';
import packageJson from '../../package.json';
import { usePathname } from 'next/navigation';
import { useAuth } from '../lib/auth-context';
import {
  LayoutDashboard, Bot, BookOpen, MessageSquare, Headphones,
  Package, Settings, PlugZap, Users, ClipboardList, LogOut, BarChart2, FlaskConical,
} from 'lucide-react';

const navItems = [
  {
    section: '概覽',
    links: [
      { href: '/dashboard', label: '儀表板', icon: LayoutDashboard },
    ],
  },
  {
    section: '客服管理',
    links: [
      { href: '/conversations', label: '對話紀錄', icon: MessageSquare },
      { href: '/live-agent', label: '真人客服', icon: Headphones, live: true },
    ],
  },
  {
    section: 'AI 設定',
    links: [
      { href: '/models', label: '模型設定', icon: Bot },
      { href: '/knowledge', label: '知識庫', icon: BookOpen },
      { href: '/products', label: '產品索引', icon: Package },
      { href: '/chat-test', label: '聊天測試', icon: FlaskConical },
    ],
  },
  {
    section: '系統',
    links: [
      { href: '/channels', label: '通路設定', icon: PlugZap },
      { href: '/tenants', label: '租戶管理', icon: Users },
      { href: '/usage', label: '用量統計', icon: BarChart2 },
      { href: '/audit-logs', label: '稽核日誌', icon: ClipboardList },
      { href: '/settings', label: '系統設定', icon: Settings },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">🐻</div>
        <div>
          <div className="sidebar-logo-text">PPBears CS</div>
          <div className="sidebar-logo-sub">Admin Panel v{packageJson.version}</div>
        </div>
      </div>

      {navItems.map((section) => (
        <div key={section.section}>
          <div className="sidebar-section-label">{section.section}</div>
          {section.links.map((link) => {
            const Icon = link.icon;
            const isActive = pathname === link.href || pathname.startsWith(link.href + '/');
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`sidebar-link ${isActive ? 'active' : ''}`}
              >
                <Icon className="sidebar-link-icon" size={18} />
                {link.label}
                {(link as any).live && (
                  <span className="sidebar-badge ml-auto">LIVE</span>
                )}
              </Link>
            );
          })}
        </div>
      ))}

      <div className="sidebar-bottom">
        <div style={{ padding: '8px 8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
          登入帳號：{user?.email || '—'}
        </div>
        <button
          className="sidebar-link"
          style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left' }}
          onClick={logout}
        >
          <LogOut size={18} className="sidebar-link-icon" />
          登出
        </button>
      </div>
    </aside>
  );
}
