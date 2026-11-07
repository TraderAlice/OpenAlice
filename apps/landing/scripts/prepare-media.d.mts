import type { MediaIndex } from "../lib/media-runtime.mjs";
export const DEFAULT_MEDIA_BASE_URL: string;
export function prepareMedia(options?: {
  baseUrl?: string;
  outputPath?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<MediaIndex & { baseUrl: string }>;
