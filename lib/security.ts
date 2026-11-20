import type { IncomingMessage, ServerResponse } from 'node:http';

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false;

  // Localhost in development
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin) || /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) {
    return true;
  }

  // Configured ALLOWED_ORIGIN (e.g. https://thumbnix-yt.vercel.app)
  const allowedOrigin = process.env.ALLOWED_ORIGIN?.trim();
  if (allowedOrigin && origin.toLowerCase() === allowedOrigin.toLowerCase()) {
    return true;
  }

  // Official default production domain or vercel previews for this project
  if (/^https:\/\/thumbnix(?:-[a-z0-9_-]+)?\.vercel\.app$/i.test(origin)) {
    return true;
  }

  return false;
}

export function applySecurityHeaders(req: IncomingMessage, res: ServerResponse): boolean {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  const origin = req.headers.origin;
  if (typeof origin === 'string' && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true; // Request handled
  }

  return false;
}

export function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}
