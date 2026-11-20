import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from '../api/thumbnails.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

function createMockReq(url: string, ip = '127.0.0.1'): IncomingMessage {
  return {
    method: 'GET',
    url,
    headers: {
      'x-forwarded-for': ip,
      host: 'localhost:3000'
    },
    socket: { remoteAddress: ip }
  } as unknown as IncomingMessage;
}

function createMockRes(): {
  res: ServerResponse;
  getStatusCode: () => number;
  getHeaders: () => Record<string, string>;
  getBody: () => string;
} {
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let body = '';

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    setHeader(key: string, value: string) {
      headers[key.toLowerCase()] = String(value);
    },
    getHeader(key: string) {
      return headers[key.toLowerCase()];
    },
    end(chunk?: string | Buffer) {
      if (chunk) {
        body += typeof chunk === 'string' ? chunk : chunk.toString();
      }
    }
  } as unknown as ServerResponse;

  return {
    res,
    getStatusCode: () => statusCode,
    getHeaders: () => headers,
    getBody: () => body
  };
}

// Minimal JPEG generator for mock responses
function createMockJpegBuffer(width: number, height: number): Uint8Array {
  const buf = Buffer.alloc(17);
  buf[0] = 0xff;
  buf[1] = 0xd8; // SOI
  buf[2] = 0xff;
  buf[3] = 0xc0; // SOF0
  buf.writeUInt16BE(11, 4);
  buf[6] = 8;
  buf.writeUInt16BE(height, 7);
  buf.writeUInt16BE(width, 9);
  buf[11] = 3;
  buf[12] = 1;
  buf[13] = 0x11;
  buf[14] = 0;
  buf[15] = 0xff;
  buf[16] = 0xd9; // EOI
  return new Uint8Array(buf);
}

describe('GET /api/thumbnails', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns all thumbnails and metadata when all sizes exist', async () => {
    const mockJpeg = createMockJpegBuffer(1280, 720);

    vi.spyOn(global, 'fetch').mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes('oembed')) {
        return new Response(
          JSON.stringify({
            title: 'Never Gonna Give You Up',
            author_name: 'Rick Astley'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(mockJpeg, {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' }
      });
    });

    const mock = createMockRes();
    await handler(createMockReq('/api/thumbnails?url=dQw4w9WgXcQ', '10.0.0.1'), mock.res);

    expect(mock.getStatusCode()).toBe(200);
    const data = JSON.parse(mock.getBody());
    expect(data.videoId).toBe('dQw4w9WgXcQ');
    expect(data.metadata).toEqual({
      title: 'Never Gonna Give You Up',
      channel: 'Rick Astley'
    });
    expect(data.best).toBe('maxresdefault');
    expect(data.thumbnails.length).toBe(5);
  });

  it('returns partial thumbnails if higher resolutions are placeholders and handles oEmbed failure gracefully', async () => {
    const placeholderJpeg = createMockJpegBuffer(120, 90);
    const hqJpeg = createMockJpegBuffer(480, 360);

    vi.spyOn(global, 'fetch').mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes('oembed')) {
        return new Response('Not Found', { status: 404 });
      }
      if (url.includes('maxresdefault') || url.includes('sddefault')) {
        // Return 120x90 placeholder
        return new Response(placeholderJpeg, { status: 200 });
      }
      if (url.includes('hqdefault')) {
        return new Response(hqJpeg, { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    });

    const mock = createMockRes();
    await handler(createMockReq('/api/thumbnails?url=dQw4w9WgXcQ', '10.0.0.2'), mock.res);

    expect(mock.getStatusCode()).toBe(200);
    const data = JSON.parse(mock.getBody());
    expect(data.metadata).toBeNull();
    expect(data.best).toBe('hqdefault');
    expect(data.thumbnails.some((t: { quality: string }) => t.quality === 'hqdefault')).toBe(true);
    expect(data.thumbnails.some((t: { quality: string }) => t.quality === 'maxresdefault')).toBe(false);
  });

  it('returns 404 when no thumbnails are available', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response('Not Found', { status: 404 });
    });

    const mock = createMockRes();
    await handler(createMockReq('/api/thumbnails?url=dQw4w9WgXcQ', '10.0.0.3'), mock.res);

    expect(mock.getStatusCode()).toBe(404);
    const data = JSON.parse(mock.getBody());
    expect(data.error.code).toBe('VIDEO_NOT_FOUND');
  });

  it('returns 400 for invalid YouTube URL', async () => {
    const mock = createMockRes();
    await handler(createMockReq('/api/thumbnails?url=invalid_video_url_123', '10.0.0.4'), mock.res);

    expect(mock.getStatusCode()).toBe(400);
    const data = JSON.parse(mock.getBody());
    expect(data.error.code).toBe('INVALID_URL');
  });

  it('returns 429 when rate limit is exceeded', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes('oembed')) {
        return new Response(JSON.stringify({ title: 'Test', author_name: 'Artist' }), { status: 200 });
      }
      const mockJpeg = createMockJpegBuffer(1280, 720);
      return new Response(mockJpeg, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
    });

    const ip = '192.168.1.99';
    // Exhaust limit (30)
    for (let i = 0; i < 30; i++) {
      const mock = createMockRes();
      await handler(createMockReq('/api/thumbnails?url=dQw4w9WgXcQ', ip), mock.res);
      expect(mock.getStatusCode()).toBe(200);
    }

    // 31st request should be rate-limited
    const rateLimitedMock = createMockRes();
    await handler(createMockReq('/api/thumbnails?url=dQw4w9WgXcQ', ip), rateLimitedMock.res);

    expect(rateLimitedMock.getStatusCode()).toBe(429);
    expect(rateLimitedMock.getHeaders()['retry-after']).toBeDefined();
    const data = JSON.parse(rateLimitedMock.getBody());
    expect(data.error.code).toBe('RATE_LIMITED');
  });
});
