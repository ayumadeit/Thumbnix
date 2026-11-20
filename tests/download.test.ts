import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from '../api/download.js';
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
  getBody: () => Buffer;
} {
  let statusCode = 200;
  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];

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
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
    }
  } as unknown as ServerResponse;

  return {
    res,
    getStatusCode: () => statusCode,
    getHeaders: () => headers,
    getBody: () => Buffer.concat(chunks)
  };
}

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

describe('GET /api/download', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('streams valid image with proper attachment headers', async () => {
    const mockJpeg = createMockJpegBuffer(1280, 720);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(mockJpeg, {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(mockJpeg.length) }
      })
    );

    const mock = createMockRes();
    await handler(createMockReq('/api/download?id=dQw4w9WgXcQ&quality=maxresdefault', '10.0.1.1'), mock.res);

    expect(mock.getStatusCode()).toBe(200);
    expect(mock.getHeaders()['content-type']).toBe('image/jpeg');
    expect(mock.getHeaders()['content-disposition']).toBe('attachment; filename="thumbnix-dQw4w9WgXcQ-maxresdefault.jpg"');
    expect(mock.getHeaders()['x-content-type-options']).toBe('nosniff');
    expect(mock.getBody().length).toBe(mockJpeg.length);
  });

  it('returns 404 if upstream image is placeholder', async () => {
    const placeholderJpeg = createMockJpegBuffer(120, 90);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(placeholderJpeg, {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' }
      })
    );

    const mock = createMockRes();
    await handler(createMockReq('/api/download?id=dQw4w9WgXcQ&quality=maxresdefault', '10.0.1.2'), mock.res);

    expect(mock.getStatusCode()).toBe(404);
  });

  it('returns 404 when upstream returns 404', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));

    const mock = createMockRes();
    await handler(createMockReq('/api/download?id=dQw4w9WgXcQ&quality=maxresdefault', '10.0.1.3'), mock.res);

    expect(mock.getStatusCode()).toBe(404);
  });
});

describe('Security & Abuse Protection (/api/download)', () => {
  it('rejects full URLs in id parameter', async () => {
    const mock = createMockRes();
    await handler(createMockReq('/api/download?id=https://evil.com/img.jpg&quality=maxresdefault'), mock.res);
    expect(mock.getStatusCode()).toBe(400);
  });

  it('rejects directory traversal and path tricks in id parameter', async () => {
    const mock1 = createMockRes();
    await handler(createMockReq('/api/download?id=../../etc/pw&quality=maxresdefault'), mock1.res);
    expect(mock1.getStatusCode()).toBe(400);

    const mock2 = createMockRes();
    await handler(createMockReq('/api/download?id=..%2F..%2Fetc&quality=maxresdefault'), mock2.res);
    expect(mock2.getStatusCode()).toBe(400);
  });

  it('rejects unapproved qualities', async () => {
    const mock = createMockRes();
    await handler(createMockReq('/api/download?id=dQw4w9WgXcQ&quality=superhd'), mock.res);
    expect(mock.getStatusCode()).toBe(400);
  });

  it('enforces download rate limits', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      const mockJpeg = createMockJpegBuffer(1280, 720);
      return new Response(mockJpeg, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
    });

    const ip = '172.16.0.44';
    for (let i = 0; i < 20; i++) {
      const mock = createMockRes();
      await handler(createMockReq('/api/download?id=dQw4w9WgXcQ&quality=maxresdefault', ip), mock.res);
      expect(mock.getStatusCode()).toBe(200);
    }

    const rateLimitedMock = createMockRes();
    await handler(createMockReq('/api/download?id=dQw4w9WgXcQ&quality=maxresdefault', ip), rateLimitedMock.res);
    expect(rateLimitedMock.getStatusCode()).toBe(429);
  });
});
