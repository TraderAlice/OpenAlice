/**
 * Shared `x-openalice-run` → {@link InboxOrigin} resolver for the two
 * workspace-scoped route mounts (`/mcp/:wsId` and `/cli/:wsId/:export/invoke`).
 *
 * Both routes read the SAME out-of-band header and resolve it the SAME way, so
 * the resolution lives here once — they can't drift. The header is the only
 * carrier of run identity; it's injected at spawn (AQ_RUN_ID, headless only),
 * forwarded by OpenAlice-owned transport (the `alice` CLI shim / a native-MCP
 * static header), and NEVER supplied by the agent in a tool call.
 *
 * Authority is the {@link HeadlessTaskRegistry}, not the request: we look the
 * run up by taskId and read `issueId` / `agent` off the stored record. A header
 * that doesn't match a known run resolves to `undefined` (no origin) — so a
 * forged or stale value can't fabricate a link.
 */

import type { InboxOrigin } from '../core/inbox-store.js'

/** Minimal structural view of the bits this resolver needs — kept structural so
 *  the server layer doesn't hard-depend on the workspaces/ module shapes. */
interface HeadlessRecordLike {
  readonly taskId: string
  readonly issueId?: string
  readonly agent: string
}
interface WorkspaceServiceLike {
  headlessTasks: { get(taskId: string): HeadlessRecordLike | null }
}

/**
 * Resolve the `x-openalice-run` header value to an {@link InboxOrigin}.
 *
 * Returns `undefined` when there is no header, the workspace service isn't up,
 * or the run id matches no record — in all those cases the push simply carries
 * no origin (the interactive / manual case).
 */
export function resolveInboxOrigin(
  runHeader: string | undefined,
  getWorkspaceService: () => WorkspaceServiceLike | null,
): InboxOrigin | undefined {
  const runId = runHeader?.trim()
  if (!runId) return undefined
  const rec = getWorkspaceService()?.headlessTasks.get(runId) ?? null
  if (!rec) return undefined
  return {
    kind: 'headless',
    runId: rec.taskId,
    ...(rec.issueId ? { issueId: rec.issueId } : {}),
    ...(rec.agent ? { agent: rec.agent } : {}),
  }
}
