'use client';

import { useAuth } from '../../lib/auth-context';
import Sidebar from '../../components/Sidebar';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

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
      <Sidebar />
      <div className="main-content">
        {children}
      </div>
    </div>
  );
}
