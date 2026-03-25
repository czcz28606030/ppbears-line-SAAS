'use client';

import { useState } from 'react';
import { useAuth } from '../../lib/auth-context';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || '登入失敗，請確認帳號密碼');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon">🐻</div>
          <h1 className="login-title">PPBears CS Admin</h1>
          <p className="login-subtitle">多平台 AI 客服中控系統</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">電子郵件</label>
            <input
              id="login-email"
              type="email"
              className="form-input"
              placeholder="admin@ppbears.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">密碼</label>
            <input
              id="login-password"
              type="password"
              className="form-input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <div className="login-error">{error}</div>}
          <button
            id="login-submit"
            type="submit"
            className="btn btn-primary login-btn"
            disabled={loading}
          >
            {loading ? '登入中...' : '登入後台'}
          </button>
        </form>
      </div>
    </div>
  );
}
