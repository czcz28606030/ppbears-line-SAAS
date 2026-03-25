'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { apiFetch, setToken, clearToken } from '../lib/api';

interface User {
  id: string;
  email: string;
  role: string;
  tenantId: string;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('ppbears_admin_token') : null;
    if (token) {
      // Parse JWT payload for user info (no need to re-fetch for basic hydration)
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUser({
          id: payload.sub,
          email: payload.email,
          role: payload.role,
          tenantId: payload.tenantId,
        });
      } catch {
        clearToken();
      }
    }
    setLoading(false);
  }, []);

  async function login(email: string, password: string) {
    const data = await apiFetch<{ token: string; user: User }>('/api/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setToken(data.token);
    setUser(data.user);
  }

  function logout() {
    clearToken();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
