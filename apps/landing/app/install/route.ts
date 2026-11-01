// The site is the user-facing entry point; the release-owned download domain
// remains the single stable publication hub behind it.
const INSTALLER_URL = "https://download.openalice.ai/install";

const commonHeaders = {
  "Cache-Control": "public, max-age=0, must-revalidate",
  "Content-Disposition": 'inline; filename="openalice-install"',
  "Content-Type": "text/plain; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const upstream = await fetch(INSTALLER_URL, {
      cache: "no-store",
      headers: { Accept: "text/plain" },
    });

    if (!upstream.ok) {
      return unavailable(`upstream returned HTTP ${upstream.status}`);
    }

    const script = await upstream.text();
    if (!script.startsWith("#!/usr/bin/env bash\n")) {
      return unavailable("upstream did not return an OpenAlice installer");
    }

    return new Response(script, { headers: commonHeaders });
  } catch {
    return unavailable("upstream request failed");
  }
}

function unavailable(reason: string) {
  return new Response(`OpenAlice installer unavailable: ${reason}.\n`, {
    status: 502,
    headers: {
      ...commonHeaders,
      "Cache-Control": "no-store",
    },
  });
}
