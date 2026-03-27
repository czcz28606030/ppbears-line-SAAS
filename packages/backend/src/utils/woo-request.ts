/**
 * woo-request.ts
 *
 * WooCommerce HTTP utility using Node.js native `https`/`http` modules.
 * Also exposes a `diagnoseDns()` helper for debugging connectivity.
 */

import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns/promises';

export interface WooResponse {
  status: number;
  ok: boolean;
  text(): Promise<string>;
  json<T = any>(): Promise<T>;
}

export interface DiagResult {
  step: string;
  ok: boolean;
  detail: string;
}

type WooRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

/**
 * DNS check: returns the resolved IPs for a hostname, or an error string.
 */
export async function diagnoseDns(hostname: string): Promise<DiagResult> {
  try {
    const addresses = await dns.resolve4(hostname);
    return { step: 'DNS', ok: true, detail: `Resolved to: ${addresses.join(', ')}` };
  } catch (err: any) {
    return { step: 'DNS', ok: false, detail: `${err.code || ''} ${err.message || String(err)}`.trim() };
  }
}

/**
 * Make an HTTP/HTTPS request using Node.js core modules (not undici/fetch).
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
      req.destroy(new Error(`Connection timed out after 15s connecting to ${uri.hostname}`));
    });

    req.on('error', (err: NodeJS.ErrnoException) => {
      // Enrich error message with Node error code/syscall for diagnosis
      const code = err.code ? ` [${err.code}]` : '';
      const syscall = err.syscall ? ` syscall:${err.syscall}` : '';
      const msg = err.message || String(err);
      if (!err.message) {
        // Mutate to ensure message is non-empty
        (err as any).message = `Connection error${code}${syscall}`;
      } else {
        (err as any).message = `${msg}${code}${syscall}`;
      }
      reject(err);
    });

    if (options.body) {
      req.setHeader('Content-Type', 'application/json');
      req.write(options.body);
    }

    req.end();
  });
}
