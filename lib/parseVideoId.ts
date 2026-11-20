export const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

export function parseVideoId(rawInput: unknown): string | null {
  if (typeof rawInput !== 'string') return null;
  const input = rawInput.trim();
  if (!input || input.length > 300) return null;

  // 1. Check if it's already a bare 11-char ID
  if (VIDEO_ID_REGEX.test(input)) {
    return input;
  }

  // 2. Try parsing as a URL
  try {
    const hasProtocol = /^https?:\/\//i.test(input);
    const url = new URL(hasProtocol ? input : `https://${input}`);
    const hostname = url.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');

    let candidateId: string | null = null;

    if (hostname === 'youtu.be') {
      // Path: /<id>
      const seg = url.pathname.split('/').filter(Boolean);
      candidateId = seg[0] || null;
    } else if (hostname === 'youtube.com' || hostname === 'youtube-nocookie.com') {
      const pathname = url.pathname;
      if (pathname === '/watch') {
        candidateId = url.searchParams.get('v');
      } else {
        const match = pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
        if (match) {
          candidateId = match[1];
        }
      }
    }

    if (candidateId && VIDEO_ID_REGEX.test(candidateId)) {
      return candidateId;
    }

    return null;
  } catch {
    return null;
  }
}
