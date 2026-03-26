const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('ppbears_admin_token');
}

export function setToken(token: string) {
  localStorage.setItem('ppbears_admin_token', token);
}

export function clearToken() {
  localStorage.removeItem('ppbears_admin_token');
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const isFormData = typeof window !== 'undefined' && options.body instanceof FormData;
  const hasBody = options.body !== undefined && options.body !== null;

  const headers: Record<string, string> = {
    ...(isFormData ? {} : hasBody ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error((err as any).error || 'Request failed');
  }

  return res.json() as Promise<T>;
}
