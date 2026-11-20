import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { parseVideoId } from '../lib/parseVideoId.js';
import { QUALITY_WHITELIST } from '../lib/qualities.js';
import { probeThumbnail } from '../lib/probeThumbnail.js';
import { fetchVideoMetadata } from '../lib/oembed.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { createErrorResponse } from '../lib/errors.js';
import { applySecurityHeaders, sendJson } from '../lib/security.js';

const QuerySchema = z.object({
  url: z.string().min(1).max(300)
});

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (applySecurityHeaders(req, res)) return;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end();
    return;
  }

  // 1. Parse query
  const parsedUrl = new URL(req.url || '', 'http://localhost');
  const rawUrl = parsedUrl.searchParams.get('url');

  const validation = QuerySchema.safeParse({ url: rawUrl });
  if (!validation.success) {
    const err = createErrorResponse('INVALID_URL');
    sendJson(res, err.status, err.body);
    return;
  }

  // 2. Validate video ID
  const videoId = parseVideoId(validation.data.url);
  if (!videoId) {
    const err = createErrorResponse('INVALID_URL');
    sendJson(res, err.status, err.body);
    return;
  }

  // 3. Rate limiting check (30 req / min)
  const rl = await checkRateLimit(req, 'thumbnails');
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    const err = createErrorResponse('RATE_LIMITED');
    sendJson(res, err.status, err.body);
    return;
  }

  try {
    // 4. Fetch metadata and probe thumbnails concurrently
    const [metadata, ...probedResults] = await Promise.all([
      fetchVideoMetadata(videoId),
      ...QUALITY_WHITELIST.map((q) => probeThumbnail(videoId, q))
    ]);

    const thumbnails = probedResults.filter(
      (t): t is NonNullable<typeof t> => t !== null
    );

    if (thumbnails.length === 0) {
      const err = createErrorResponse('VIDEO_NOT_FOUND');
      sendJson(res, err.status, err.body);
      return;
    }

    const best = thumbnails[0].quality;

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

    sendJson(res, 200, {
      videoId,
      metadata,
      best,
      thumbnails
    });
  } catch {
    const err = createErrorResponse('INTERNAL');
    sendJson(res, err.status, err.body);
  }
}
