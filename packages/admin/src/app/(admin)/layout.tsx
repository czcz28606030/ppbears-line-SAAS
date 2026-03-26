'use client';

import { useAuth } from '../../lib/auth-context';
import Sidebar from '../../components/Sidebar';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar on route change (mobile nav)
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="loading-center" style={{ minHeight: '100vh' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="admin-layout">
      {/* Mobile overlay — click to close sidebar */}
      {sidebarOpen && (
        <div
          className="sidebar-overlay active"
          onClick={() => setSidebarOpen(false)}
          style={{ display: 'block' }}
        />
      )}

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="main-content">
        {/* Mobile hamburger button — fixed top-left */}
        <button
          className="sidebar-hamburger"
          onClick={() => setSidebarOpen(true)}
          aria-label="開啟選單"
        >
          <Menu size={22} />
        </button>

        {children}
      </div>
    </div>
  );
}
