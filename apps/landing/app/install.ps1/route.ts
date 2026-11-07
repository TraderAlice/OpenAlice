export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const upstream = await fetch("https://download.openalice.ai/install.ps1", {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const script = await upstream.text();
    if (!upstream.ok || !script.startsWith("# OpenAlice Windows CLI installer")) {
      throw new Error("Invalid installer response");
    }
    return new Response(script, { headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'inline; filename="install.ps1"',
      "Cache-Control": "public, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return new Response("OpenAlice Windows installer unavailable.\n", {
      status: 502, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
    });
  }
}
