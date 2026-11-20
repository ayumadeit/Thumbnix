export interface VideoMetadata {
  title: string;
  channel: string;
}

export async function fetchVideoMetadata(
  videoId: string,
  fetchFn: typeof fetch = fetch
): Promise<VideoMetadata | null> {
  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetchFn(oembedUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Thumbnix/1.0; +https://thumbnix-yt.vercel.app)'
      }
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as { title?: unknown; author_name?: unknown };
    const title = typeof data.title === 'string' ? data.title.trim() : null;
    const channel = typeof data.author_name === 'string' ? data.author_name.trim() : null;

    if (!title && !channel) {
      return null;
    }

    return {
      title: title || 'YouTube Video',
      channel: channel || 'Unknown Channel'
    };
  } catch {
    return null;
  }
}
