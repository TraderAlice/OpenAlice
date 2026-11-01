export interface MediaAsset {
  contentType: string;
  bytes: number;
  sha256: string;
  width?: number;
  height?: number;
}

export interface MediaIndex {
  schemaVersion: number;
  assets: Record<string, MediaAsset>;
}

export function normalizeMediaBaseUrl(value?: string): string;
export function mediaRemotePatterns(baseUrl?: string): {
  protocol: "http" | "https";
  hostname: string;
  port: string;
  pathname: string;
}[];
export function createMediaResolver(index: MediaIndex, baseUrl?: string): {
  mediaUrl(src: string): string;
  mediaMetadata(src: string): MediaAsset;
  mediaImage(src: string): { src: string; width: number; height: number };
};
