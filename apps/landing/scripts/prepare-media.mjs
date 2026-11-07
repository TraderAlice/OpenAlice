import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMediaResolver, normalizeMediaBaseUrl } from "../lib/media-runtime.mjs";

export const DEFAULT_MEDIA_BASE_URL = "https://download.openalice.ai/website";
const DEFAULT_OUTPUT = fileURLToPath(new URL("../.cache/media-index.json", import.meta.url));
const MAX_INDEX_BYTES = 1024 * 1024;

// Only the public JSON index is fetched. Images/videos remain remote, and this
// generated cache is never a second version-controlled source of media truth.
export async function prepareMedia({
  baseUrl = process.env.NEXT_PUBLIC_MEDIA_BASE_URL || DEFAULT_MEDIA_BASE_URL,
  outputPath = DEFAULT_OUTPUT,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
} = {}) {
  const base = normalizeMediaBaseUrl(baseUrl);
  if (!base.startsWith("https://")) throw new Error("Landing media requires an HTTPS public base URL.");
  const response = await fetchImpl(`${base}/index.json`, {
    signal: AbortSignal.timeout(timeoutMs), cache: "no-store", redirect: "error",
  });
  if (!response.ok) throw new Error(`Public media index returned HTTP ${response.status}.`);
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_INDEX_BYTES) throw new Error("Public media index is too large.");
  const received = JSON.parse(text);
  if (received.schemaVersion !== 1 || !received.assets || Array.isArray(received.assets) ||
      typeof received.assets !== "object" || normalizeMediaBaseUrl(received.baseUrl) !== base) {
    throw new Error("Invalid public media index schema or base URL.");
  }
  const index = { schemaVersion: 1, baseUrl: base, assets: received.assets };
  const resolver = createMediaResolver(index, base);
  if (!Object.keys(index.assets).length) throw new Error("Public media index is empty.");
  for (const [key, asset] of Object.entries(index.assets)) {
    if (!key.startsWith("/") || key.startsWith("//") || /[?#%\\]/.test(key) || !asset) {
      throw new Error("Invalid media object path or metadata.");
    }
    resolver.mediaUrl(key);
    if (asset.contentType.startsWith("image/")) resolver.mediaImage(key);
  }
  const serialized = `${JSON.stringify(index, null, 2)}\n`;
  // Validate before replacing a prior cache; failures abort the build rather
  // than silently accepting stale metadata or a partial write.
  const existing = await readFile(outputPath, "utf8").catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing !== serialized) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    const temporary = `${outputPath}.${process.pid}.tmp`;
    await writeFile(temporary, serialized);
    await rename(temporary, outputPath);
  }
  return index;
}
