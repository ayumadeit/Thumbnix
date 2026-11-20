export const QUALITY_WHITELIST = [
  'maxresdefault',
  'sddefault',
  'hqdefault',
  'mqdefault',
  'default'
] as const;

export type Quality = (typeof QUALITY_WHITELIST)[number];

export interface QualityMeta {
  quality: Quality;
  label: string;
  expectedWidth: number;
  expectedHeight: number;
}

export const QUALITY_INFO: Record<Quality, QualityMeta> = {
  maxresdefault: { quality: 'maxresdefault', label: 'Maximum (HD)', expectedWidth: 1280, expectedHeight: 720 },
  sddefault: { quality: 'sddefault', label: 'Standard', expectedWidth: 640, expectedHeight: 480 },
  hqdefault: { quality: 'hqdefault', label: 'High', expectedWidth: 480, expectedHeight: 360 },
  mqdefault: { quality: 'mqdefault', label: 'Medium', expectedWidth: 320, expectedHeight: 180 },
  default: { quality: 'default', label: 'Default', expectedWidth: 120, expectedHeight: 90 }
};

export function isValidQuality(q: unknown): q is Quality {
  return typeof q === 'string' && (QUALITY_WHITELIST as readonly string[]).includes(q);
}
