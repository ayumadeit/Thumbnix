import { Quality, QUALITY_INFO } from './qualities.js';

export interface JpegDimensions {
  width: number;
  height: number;
}

export function readJpegDimensions(buffer: Uint8Array | Buffer): JpegDimensions | null {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    return null; // Not a valid JPEG (must start with SOI 0xFFD8)
  }

  let offset = 2;
  const len = buf.length;

  while (offset < len) {
    // Find next 0xFF
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }

    // Skip any padding 0xFF bytes
    while (offset < len && buf[offset] === 0xff) {
      offset++;
    }
    if (offset >= len) break;

    const marker = buf[offset];
    offset++;

    // Ignore standalone markers: SOI (0xD8), EOI (0xD9), TEM (0x01), RST0-7 (0xD0-0xD7)
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    // SOF markers: 0xC0..0xCF except 0xC4 (DHT), 0xC8 (JPG), 0xCC (DAC)
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (offset + 2 > len) break;
    const segmentLength = buf.readUInt16BE(offset);

    if (isSof) {
      // Need at least 2 (length) + 1 (precision) + 2 (height) + 2 (width) = 7 bytes
      if (offset + 7 <= len) {
        const height = buf.readUInt16BE(offset + 3);
        const width = buf.readUInt16BE(offset + 5);
        if (width > 0 && height > 0) {
          return { width, height };
        }
      }
      return null;
    }

    // Advance to next segment
    offset += segmentLength;
  }

  return null;
}

export function isPlaceholder(quality: Quality, width: number, height: number): boolean {
  return quality !== 'default' && width === 120 && height === 90;
}

export interface ProbedThumbnail {
  quality: Quality;
  label: string;
  width: number;
  height: number;
  bytes: number;
  url: string;
  downloadUrl: string;
}

export async function probeThumbnail(
  videoId: string,
  quality: Quality,
  fetchFn: typeof fetch = fetch
): Promise<ProbedThumbnail | null> {
  const url = `https://i.ytimg.com/vi/${videoId}/${quality}.jpg`;
  const info = QUALITY_INFO[quality];

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        // Normal user agent helps ensure standard headers
        'User-Agent': 'Mozilla/5.0 (compatible; Thumbnix/1.0; +https://thumbnix-yt.vercel.app)'
      }
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    const bytes = arrayBuffer.byteLength;
    if (bytes === 0) return null;

    const dims = readJpegDimensions(new Uint8Array(arrayBuffer));
    const width = dims?.width || info.expectedWidth;
    const height = dims?.height || info.expectedHeight;

    if (isPlaceholder(quality, width, height)) {
      return null;
    }

    return {
      quality,
      label: info.label,
      width,
      height,
      bytes,
      url,
      downloadUrl: `/api/download?id=${encodeURIComponent(videoId)}&quality=${encodeURIComponent(quality)}`
    };
  } catch {
    return null;
  }
}
