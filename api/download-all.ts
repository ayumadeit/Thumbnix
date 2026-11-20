import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { zipSync } from 'fflate';
import { VIDEO_ID_REGEX } from '../lib/parseVideoId.js';
import { QUALITY_WHITELIST, QUALITY_INFO, Quality } from '../lib/qualities.js';
import { readJpegDimensions, isPlaceholder } from '../lib/probeThumbnail.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { createErrorResponse } from '../lib/errors.js';
import { applySecurityHeaders, sendJson } from '../lib/security.js';

const DownloadAllSchema = z.object({
  id: z.string().regex(VIDEO_ID_REGEX)
});

const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (applySecurityHeaders(req, res)) return;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end();
    return;
  }

  // 1. Validate query
  const parsedUrl = new URL(req.url || '', 'http://localhost');
  const validation = DownloadAllSchema.safeParse({
    id: parsedUrl.searchParams.get('id')
  });

  if (!validation.success) {
    const err = createErrorResponse('INVALID_URL');
    sendJson(res, err.status, err.body);
    return;
  }

  const { id } = validation.data;

  // 2. Rate limiting check
  const rl = await checkRateLimit(req, 'download');
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    const err = createErrorResponse('RATE_LIMITED');
    sendJson(res, err.status, err.body);
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    // 3. Fetch all sizes concurrently
    const fetchPromises = QUALITY_WHITELIST.map(async (quality) => {
      const url = `https://i.ytimg.com/vi/${id}/${quality}.jpg`;
      try {
        const upstreamRes = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Thumbnix/1.0; +https://thumbnix-yt.vercel.app)'
          }
        });
        if (!upstreamRes.ok) return null;

        const arrayBuffer = await upstreamRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        if (buffer.length === 0) return null;

        const dims = readJpegDimensions(buffer);
        const width = dims?.width || QUALITY_INFO[quality as Quality].expectedWidth;
        const height = dims?.height || QUALITY_INFO[quality as Quality].expectedHeight;

        if (isPlaceholder(quality as Quality, width, height)) {
          return null;
        }

        return {
          quality,
          width,
          height,
          buffer: new Uint8Array(buffer)
        };
      } catch {
        return null;
      }
    });

    const results = await Promise.all(fetchPromises);
    clearTimeout(timeoutId);

    const available = results.filter((item): item is NonNullable<typeof item> => item !== null);

    if (available.length === 0) {
      const err = createErrorResponse('VIDEO_NOT_FOUND');
      sendJson(res, err.status, err.body);
      return;
    }

    // 4. Build zip file
    const zipFiles: Record<string, Uint8Array> = {};
    let totalBytes = 0;

    for (const item of available) {
      totalBytes += item.buffer.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) {
        break;
      }
      const filename = `${id}-${item.quality}-${item.width}x${item.height}.jpg`;
      zipFiles[filename] = item.buffer;
    }

    const zipBuffer = zipSync(zipFiles);

    // 5. Stream response
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(zipBuffer.byteLength));
    res.setHeader('Content-Disposition', `attachment; filename="thumbnix-${id}.zip"`);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    res.end(Buffer.from(zipBuffer));
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
