import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from '../api/download-all.js';
import { unzipSync } from 'fflate';
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
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xc0;
  buf.writeUInt16BE(11, 4);
  buf[6] = 8;
  buf.writeUInt16BE(height, 7);
  buf.writeUInt16BE(width, 9);
  buf[11] = 3;
  buf[12] = 1;
  buf[13] = 0x11;
  buf[14] = 0;
  buf[15] = 0xff;
  buf[16] = 0xd9;
  return new Uint8Array(buf);
}

describe('GET /api/download-all', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a valid ZIP archive containing all available resolutions', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      const mockJpeg = createMockJpegBuffer(1280, 720);
      return new Response(mockJpeg, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
    });

    const mock = createMockRes();
    await handler(createMockReq('/api/download-all?id=dQw4w9WgXcQ', '10.0.3.1'), mock.res);

    expect(mock.getStatusCode()).toBe(200);
    expect(mock.getHeaders()['content-type']).toBe('application/zip');
    expect(mock.getHeaders()['content-disposition']).toBe('attachment; filename="thumbnix-dQw4w9WgXcQ.zip"');

    const zipBuffer = mock.getBody();
    expect(zipBuffer.length).toBeGreaterThan(0);

    const unzipped = unzipSync(new Uint8Array(zipBuffer));
    const filenames = Object.keys(unzipped);

    expect(filenames.length).toBe(5);
    expect(filenames.some((fn) => fn.startsWith('dQw4w9WgXcQ-maxresdefault'))).toBe(true);
    expect(filenames.some((fn) => fn.startsWith('dQw4w9WgXcQ-default'))).toBe(true);
  });

  it('returns 404 when no sizes are available', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));

    const mock = createMockRes();
    await handler(createMockReq('/api/download-all?id=dQw4w9WgXcQ', '10.0.3.2'), mock.res);

    expect(mock.getStatusCode()).toBe(404);
  });

  it('rejects invalid video ID', async () => {
    const mock = createMockRes();
    await handler(createMockReq('/api/download-all?id=bad_id', '10.0.3.3'), mock.res);

    expect(mock.getStatusCode()).toBe(400);
  });
});
