import { describe, it, expect } from 'vitest';
import { parseVideoId } from '../lib/parseVideoId.js';

describe('parseVideoId', () => {
  it('handles bare 11-character video ID', () => {
    expect(parseVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('12345678901')).toBe('12345678901');
    expect(parseVideoId('_ab-CD1234_')).toBe('_ab-CD1234_');
  });

  it('handles standard youtube.com watch URLs', () => {
    expect(parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('http://youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('handles query parameters and noise (&t=, &list=, &feature=)', () => {
    expect(parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PLrAXtmErZgOdP_8GztsuKi9nv85ofdU4E&index=1')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('https://youtu.be/dQw4w9WgXcQ?si=abcdef&t=100')).toBe('dQw4w9WgXcQ');
  });

  it('handles youtu.be short URLs', () => {
    expect(parseVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('handles mobile and music subdomains (m., music.)', () => {
    expect(parseVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('handles shorts, embed, live and v path formats', () => {
    expect(parseVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('https://www.youtube.com/live/dQw4w9WgXcQ?feature=share')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('https://www.youtube.com/v/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('handles youtube-nocookie.com domain', () => {
    expect(parseVideoId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('rejects invalid inputs, empty strings, and foreign domains', () => {
    expect(parseVideoId('')).toBeNull();
    expect(parseVideoId('   ')).toBeNull();
    expect(parseVideoId(null)).toBeNull();
    expect(parseVideoId(undefined)).toBeNull();
    expect(parseVideoId('https://vimeo.com/12345678901')).toBeNull();
    expect(parseVideoId('https://evil.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseVideoId('dQw4w9WgXc')).toBeNull(); // 10 chars
    expect(parseVideoId('dQw4w9WgXcQQ')).toBeNull(); // 12 chars
    expect(parseVideoId('a'.repeat(301))).toBeNull(); // Too long (> 300)
    expect(parseVideoId('dQw4w9WgXc$')).toBeNull(); // Invalid char
  });
});
