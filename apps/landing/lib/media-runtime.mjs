const MEDIA_EXTENSION = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp|mp4|m4v|mov|webm|ogg|mp3|wav)$/i;
const EXTERNAL_URL = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

/** Keep URL construction shared between Next configuration and browser rendering. */
export function normalizeMediaBaseUrl(value = "") {
  const base = value.trim().replace(/\/+$/, "");
  if (!base) return "";
  const url = new URL(base);
  if (
    !["https:", "http:"].includes(url.protocol)
    || url.username || url.password || url.search || url.hash
    || /[*\\]/.test(base)
  ) {
    throw new Error("NEXT_PUBLIC_MEDIA_BASE_URL must be an HTTP(S) URL without credentials, query, fragment, or wildcards");
  }
  return url.href.replace(/\/+$/, "");
}

export function mediaRemotePatterns(baseUrl = "") {
  const base = normalizeMediaBaseUrl(baseUrl);
  if (!base) return [];
  const url = new URL(base);
  return [{
    protocol: url.protocol.slice(0, -1),
    hostname: url.hostname,
    port: url.port,
    pathname: `${url.pathname.replace(/\/+$/, "")}/**`,
  }];
}

export function createMediaResolver(index, baseUrl = "") {
  if (index?.schemaVersion !== 1 || !index.assets) {
    throw new Error("Unsupported public media index: expected schemaVersion 1 and assets");
  }
  const base = normalizeMediaBaseUrl(baseUrl);

  function lookup(src) {
    if (typeof src !== "string" || EXTERNAL_URL.test(src)) return undefined;
    const path = src.split(/[?#]/, 1)[0];
    const asset = Object.hasOwn(index.assets, path) ? index.assets[path] : undefined;
    if (!asset && !MEDIA_EXTENSION.test(path)) return undefined;
    if (!asset) {
      throw new Error(`Unindexed site media "${path}": publish it from the media repository before referencing it`);
    }
    if (!path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === "." || part === "..")) {
      throw new Error(`Invalid public media path "${path}" in the public media index`);
    }
    if (!/^[a-f0-9]{64}$/.test(asset.sha256) || !asset.contentType || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0) {
      throw new Error(`Invalid media metadata for "${path}" in the public media index`);
    }
    return { path, asset };
  }

  function mediaUrl(src) {
    const entry = lookup(src);
    if (!entry || !base) return src;
    const url = new URL(`${base}${src}`);
    url.searchParams.set("v", entry.asset.sha256.slice(0, 12));
    return url.href;
  }

  function mediaMetadata(src) {
    const entry = lookup(src);
    if (!entry) throw new Error(`Expected an indexed public media path, received "${src}"`);
    return entry.asset;
  }

  function mediaImage(src) {
    const asset = mediaMetadata(src);
    if (
      !asset.contentType.startsWith("image/")
      || !Number.isSafeInteger(asset.width) || asset.width <= 0
      || !Number.isSafeInteger(asset.height) || asset.height <= 0
    ) {
      throw new Error(`Missing image dimensions for "${src}" in the public media index`);
    }
    return { src: mediaUrl(src), width: asset.width, height: asset.height };
  }

  return { mediaUrl, mediaMetadata, mediaImage };
}
