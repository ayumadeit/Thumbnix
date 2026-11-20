import type { IncomingMessage, ServerResponse } from 'node:http';
import { applySecurityHeaders, sendJson } from '../lib/security.js';

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  if (applySecurityHeaders(req, res)) return;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end();
    return;
  }

  sendJson(res, 200, {
    ok: true,
    version: '1.0.0',
    service: 'thumbnix-api'
  });
}
