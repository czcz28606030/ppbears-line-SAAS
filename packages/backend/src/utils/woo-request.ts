/**
 * woo-request.ts
 *
 * WooCommerce HTTP utility using Node.js native `https`/`http` modules.
 *
 * WHY: Node.js 18+ built-in `fetch` uses `undici` which throws `AggregateError`
 * when a shared-hosting server (e.g. Hostinger + Imunify360) blocks cloud
 * provider IP ranges at the TCP level. The legacy `node:https` module uses a
 * different connection implementation and typically bypasses these restrictions.
 */

import https from 'node:https';
import http from 'node:http';

export interface WooResponse {
  status: number;
  ok: boolean;
  text(): Promise<string>;
  json<T = any>(): Promise<T>;
}

type WooRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

/**
 * Make an HTTP/HTTPS request using Node.js core modules (not undici/fetch).
 * This avoids `AggregateError` failures caused by cloud-provider IP blocking
 * that affects undici differently from the classic https agent.
 */
export function wooRequest(url: string, options: WooRequestOptions = {}): Promise<WooResponse> {
  return new Promise((resolve, reject) => {
    const uri = new URL(url);
    const lib = uri.protocol === 'https:' ? https : http;

    const req = lib.request(
      {
        hostname: uri.hostname,
        port: uri.port ? Number(uri.port) : uri.protocol === 'https:' ? 443 : 80,
        path: uri.pathname + uri.search,
        method: options.method ?? 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          ...options.headers,
        },
        timeout: options.timeoutMs ?? 15_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          const status = res.statusCode ?? 0;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            text: () => Promise.resolve(raw),
            json: <T>() => Promise.resolve(JSON.parse(raw) as T),
          });
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error(`WooCommerce request timed out (15s) for ${uri.hostname}`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (options.body) {
      req.setHeader('Content-Type', 'application/json');
      req.write(options.body);
    }

    req.end();
  });
}
