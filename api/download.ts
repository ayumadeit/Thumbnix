import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { VIDEO_ID_REGEX } from '../lib/parseVideoId.js';
import { QUALITY_WHITELIST, Quality } from '../lib/qualities.js';
import { readJpegDimensions, isPlaceholder } from '../lib/probeThumbnail.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { createErrorResponse } from '../lib/errors.js';
import { applySecurityHeaders, sendJson } from '../lib/security.js';

const DownloadSchema = z.object({
  id: z.string().regex(VIDEO_ID_REGEX),
  quality: z.enum(QUALITY_WHITELIST)
});

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (applySecurityHeaders(req, res)) return;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end();
    return;
  }

  // 1. Validate query params strictly
  const parsedUrl = new URL(req.url || '', 'http://localhost');
  const validation = DownloadSchema.safeParse({
    id: parsedUrl.searchParams.get('id'),
    quality: parsedUrl.searchParams.get('quality')
  });

  if (!validation.success) {
    const err = createErrorResponse('INVALID_URL');
    sendJson(res, err.status, err.body);
    return;
  }

  const { id, quality } = validation.data;

  // 2. Rate limit check (20 downloads/min)
  const rl = await checkRateLimit(req, 'download');
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    const err = createErrorResponse('RATE_LIMITED');
    sendJson(res, err.status, err.body);
    return;
  }

  // 3. Strictly build upstream URL (only i.ytimg.com)
  const upstreamUrl = `https://i.ytimg.com/vi/${id}/${quality}.jpg`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const upstreamRes = await fetch(upstreamUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Thumbnix/1.0; +https://thumbnix-yt.vercel.app)'
      }
    });

    clearTimeout(timeoutId);

    if (!upstreamRes.ok) {
      const err = createErrorResponse('VIDEO_NOT_FOUND');
      sendJson(res, err.status, err.body);
      return;
    }

    const contentLength = Number(upstreamRes.headers.get('content-length')) || 0;
    if (contentLength > MAX_IMAGE_BYTES) {
      const err = createErrorResponse('INTERNAL', 'Image exceeded maximum allowed size.');
      sendJson(res, err.status, err.body);
      return;
    }

    const arrayBuffer = await upstreamRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
      const err = createErrorResponse('VIDEO_NOT_FOUND');
      sendJson(res, err.status, err.body);
      return;
    }

    // 4. Verify JPEG dimensions and placeholder
    const dims = readJpegDimensions(buffer);
    if (dims && isPlaceholder(quality as Quality, dims.width, dims.height)) {
      const err = createErrorResponse('VIDEO_NOT_FOUND');
      sendJson(res, err.status, err.body);
      return;
    }

    // 5. Send file with download attachment header
    const filename = `thumbnix-${id}-${quality}.jpg`;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    res.end(buffer);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      const err = createErrorResponse('UPSTREAM_TIMEOUT');
      sendJson(res, err.status, err.body);
      return;
    }
    const err = createErrorResponse('INTERNAL');
    sendJson(res, err.status, err.body);
  }
}
