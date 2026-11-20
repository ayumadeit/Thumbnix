import { describe, it, expect } from 'vitest';
import { readJpegDimensions, isPlaceholder } from '../lib/probeThumbnail.js';

// Helper to construct a minimal valid JPEG with given dimensions
function createMockJpegBuffer(width: number, height: number): Buffer {
  // SOI: 0xFF, 0xD8
  // SOF0 marker: 0xFF, 0xC0
  // Segment length (2 bytes): 2 (len) + 1 (precision) + 2 (height) + 2 (width) + 3 (components) = 10
  // Precision: 8 (1 byte)
  // Height: height (2 bytes)
  // Width: width (2 bytes)
  // Components: 3 (1 byte) + dummy component data
  // EOI: 0xFF, 0xD9
  const buf = Buffer.alloc(17);
  buf[0] = 0xff;
  buf[1] = 0xd8; // SOI

  buf[2] = 0xff;
  buf[3] = 0xc0; // SOF0
  buf.writeUInt16BE(11, 4); // Segment length
  buf[6] = 8; // Precision
  buf.writeUInt16BE(height, 7);
  buf.writeUInt16BE(width, 9);
  buf[11] = 3; // 3 components (YCbCr)
  buf[12] = 1;
  buf[13] = 0x11;
  buf[14] = 0;

  buf[15] = 0xff;
  buf[16] = 0xd9; // EOI

  return buf;
}

describe('readJpegDimensions', () => {
  it('reads dimensions correctly from synthetic JPEG buffer', () => {
    const buf1280 = createMockJpegBuffer(1280, 720);
    expect(readJpegDimensions(buf1280)).toEqual({ width: 1280, height: 720 });

    const buf640 = createMockJpegBuffer(640, 480);
    expect(readJpegDimensions(buf640)).toEqual({ width: 640, height: 480 });

    const buf120 = createMockJpegBuffer(120, 90);
    expect(readJpegDimensions(buf120)).toEqual({ width: 120, height: 90 });
  });

  it('returns null for non-JPEG buffers', () => {
    expect(readJpegDimensions(Buffer.from('not an image'))).toBeNull();
    expect(readJpegDimensions(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull(); // PNG header
    expect(readJpegDimensions(Buffer.alloc(0))).toBeNull();
  });

  it('returns null for corrupted or truncated JPEG buffer', () => {
    const truncated = Buffer.from([0xff, 0xd8, 0xff, 0xc0]);
    expect(readJpegDimensions(truncated)).toBeNull();
  });
});

describe('isPlaceholder', () => {
  it('identifies 120x90 as placeholder for non-default sizes', () => {
    expect(isPlaceholder('maxresdefault', 120, 90)).toBe(true);
    expect(isPlaceholder('sddefault', 120, 90)).toBe(true);
    expect(isPlaceholder('hqdefault', 120, 90)).toBe(true);
    expect(isPlaceholder('mqdefault', 120, 90)).toBe(true);
  });

  it('allows 120x90 for default quality', () => {
    expect(isPlaceholder('default', 120, 90)).toBe(false);
  });

  it('returns false for actual high-resolution dimensions', () => {
    expect(isPlaceholder('maxresdefault', 1280, 720)).toBe(false);
    expect(isPlaceholder('maxresdefault', 1920, 1080)).toBe(false);
    expect(isPlaceholder('sddefault', 640, 480)).toBe(false);
    expect(isPlaceholder('hqdefault', 480, 360)).toBe(false);
    expect(isPlaceholder('mqdefault', 320, 180)).toBe(false);
  });
});
