import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

// In-memory store (keyed by route + hashed IP)
const memoryStore = new Map<string, RateLimitRecord>();

// Clean up expired keys every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of memoryStore.entries()) {
    if (record.resetAt <= now) {
      memoryStore.delete(key);
    }
  }
}, 60000).unref();

export interface RateLimitResult {
  allowed: boolean;
  retryAfter: number; // seconds
}

export function hashIp(ip: string): string {
  return createHash('sha256').update(`thumbnix-salt-${ip}`).digest('hex').slice(0, 32);
}

export function getClientIp(req: IncomingMessage): string {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (typeof xForwardedFor === 'string') {
    const firstIp = xForwardedFor.split(',')[0].trim();
    if (firstIp) return firstIp;
  }
  const xRealIp = req.headers['x-real-ip'];
  if (typeof xRealIp === 'string' && xRealIp.trim()) {
    return xRealIp.trim();
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

export async function checkRateLimit(
  req: IncomingMessage,
  type: 'thumbnails' | 'download'
): Promise<RateLimitResult> {
  const limit = type === 'thumbnails' ? 30 : 20;
  const windowMs = 60 * 1000;
  const now = Date.now();

  const rawIp = getClientIp(req);
  const hashedIp = hashIp(rawIp);
  const key = `${type}:${hashedIp}`;

  // Optional Upstash Redis check if configured
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (upstashUrl && upstashToken) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);

      const redisRes = await fetch(`${upstashUrl}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${upstashToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([
          ['INCR', `tnx:rl:${key}`],
          ['EXPIRE', `tnx:rl:${key}`, 60, 'NX'],
          ['TTL', `tnx:rl:${key}`]
        ]),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (redisRes.ok) {
        const results = (await redisRes.json()) as Array<{ result?: number }>;
        const count = Number(results[0]?.result) || 1;
        const ttl = Number(results[2]?.result) || 60;

        if (count > limit) {
          return { allowed: false, retryAfter: Math.max(1, ttl) };
        }
        return { allowed: true, retryAfter: 0 };
      }
    } catch {
      // Fallback to in-memory if Redis fails
    }
  }

  // Fallback / default: in-memory rate limiting
  const existing = memoryStore.get(key);

  if (!existing || existing.resetAt <= now) {
    memoryStore.set(key, {
      count: 1,
      resetAt: now + windowMs
    });
    return { allowed: true, retryAfter: 0 };
  }

  existing.count++;

  if (existing.count > limit) {
    const retryAfter = Math.ceil((existing.resetAt - now) / 1000);
    return { allowed: false, retryAfter: Math.max(1, retryAfter) };
  }

  return { allowed: true, retryAfter: 0 };
}
