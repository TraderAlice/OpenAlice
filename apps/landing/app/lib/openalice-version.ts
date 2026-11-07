const RELEASE_MANIFEST_URL = "https://download.openalice.ai/manifest.json";
const FALLBACK_VERSION = "v0.94.1";

type ReleaseManifest = {
  version?: unknown;
};

export async function getOpenAliceVersionLabel() {
  try {
    const response = await fetch(RELEASE_MANIFEST_URL, {
      next: { revalidate: 60 * 60 },
    });

    if (!response.ok) {
      return FALLBACK_VERSION;
    }

    const manifest = (await response.json()) as ReleaseManifest;

    if (typeof manifest.version !== "string") {
      return FALLBACK_VERSION;
    }

    return formatVersionLabel(manifest.version);
  } catch {
    return FALLBACK_VERSION;
  }
}

function formatVersionLabel(version: string) {
  const normalized = version.trim().replace(/^v/i, "");

  if (!normalized) {
    return FALLBACK_VERSION;
  }

  return `v${normalized.replace(/-/g, " ")}`;
}
