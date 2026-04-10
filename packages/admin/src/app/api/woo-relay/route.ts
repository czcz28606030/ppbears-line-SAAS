/**
 * WooCommerce Relay API Route
 *
 * 部署在 Vercel 上，作為 Render 後端與 WooCommerce 之間的中繼。
 * Render IP (74.220.49.248) 被 Hostinger Imunify360 封鎖，
 * 但 Vercel 的 IP 是乾淨的，可以正常存取 WooCommerce API。
 *
 * Render env vars:
 *   WOO_PROXY_URL    = https://<your-vercel-domain>/api/woo-relay
 *   WOO_PROXY_SECRET = ppbx_8f3a2c9d7b1e4f6a0e5d2c8b
 *
 * Vercel env vars:
 *   WOO_RELAY_SECRET = ppbx_8f3a2c9d7b1e4f6a0e5d2c8b  (同 Render 的 WOO_PROXY_SECRET)
 */

import { NextRequest, NextResponse } from 'next/server';

// 只允許轉發到這個域名，防止此 Route 被濫用發起任意 HTTP 請求
const ALLOWED_HOST = 'www.ppbears.com';

export async function GET(request: NextRequest) {
  // ── 1. 驗證 Secret ──────────────────────────────────────────
  const relaySecret = process.env.WOO_RELAY_SECRET;
  const incoming    = request.headers.get('X-Proxy-Secret');
  if (!relaySecret || incoming !== relaySecret) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── 2. 解析請求參數 ─────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const path = searchParams.get('path') ?? '';

  const forwardParams = new URLSearchParams();
  searchParams.forEach((v, k) => {
    if (k !== 'path') forwardParams.set(k, v);
  });

  // ── 3. 轉發至 WooCommerce ───────────────────────────────────
  const wooUrl = `https://${ALLOWED_HOST}/wp-json/wc/v3/${path}${forwardParams.toString() ? `?${forwardParams.toString()}` : ''}`;

  try {
    const res = await fetch(wooUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':     'application/json',
      },
    });

    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err: any) {
    return NextResponse.json({ error: `Relay fetch error: ${err.message}` }, { status: 502 });
  }
}
