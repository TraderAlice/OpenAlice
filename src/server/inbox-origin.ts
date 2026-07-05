/**
 * Shared header → {@link InboxOrigin} resolver for the two workspace-scoped
 * route mounts (`/mcp/:wsId` and `/cli/:wsId/:export/invoke`).
 *
 * Both routes read the SAME out-of-band headers and resolve them the SAME way,
 * so the resolution lives here once — they can't drift. There are two carriers,
 * mutually exclusive per spawn:
 *
 *   - `x-openalice-run`     — HEADLESS run identity. Injected as `AQ_RUN_ID`
 *                             (the run's taskId) into the headless spawn env;
 *                             resolved against the {@link HeadlessTaskRegistry}.
 *   - `x-openalice-session` — INTERACTIVE session identity. Injected as
 *                             `AQ_SESSION_ID` (the pre-allocated SessionRegistry
 *                             record id) into the interactive PTY spawn env;
 *                             resolved against the SessionRegistry, scoped by the
 *                             route's wsId.
 *
 * Both are forwarded by OpenAlice-owned transport (the `alice` CLI shim / a
 * native-MCP static header) and NEVER supplied by the agent in a tool call — the
 * agent never traffics its own identity (symmetric for both kinds).
 *
 * Authority is the registry, not the request: we look the id up and read the
 * provenance off the STORED record. A header that doesn't match a known record
 * resolves to `undefined` (no origin) — so a forged or stale value can't
 * fabricate a link, for either kind.
 *
 * Precedence: a resolvable run header wins (headless is the authoritative
 * automation path); only when there's no headless run do we consider the
 * session header.
 */

import type { InboxOrigin } from '../core/inbox-store.js'

/** Minimal structural views of the bits this resolver needs — kept structural so
 *  the server layer doesn't hard-depend on the workspaces/ module shapes. */
interface HeadlessRecordLike {
  readonly taskId: string
  readonly issueId?: string
  readonly agent: string
}
interface SessionRecordLike {
  readonly id: string
  readonly wsId: string
  readonly agent: string
}
interface WorkspaceServiceLike {
  headlessTasks: { get(taskId: string): HeadlessRecordLike | null }
  /** Synchronous in-memory lookup of a live session record (already loaded —
   *  the session is running because its agent is the one calling inbox_push). */
  sessionRegistry: { get(wsId: string, id: string): SessionRecordLike | undefined }
}

/** The out-of-band header trio a workspace-scoped route reads off the request. */
export interface InboxOriginHeaders {
  /** `x-openalice-run` — headless run identity (taskId). */
  run?: string
  /** `x-openalice-session` — interactive session identity (record id). */
  session?: string
  /** The workspace id from the route path — scopes the session lookup. */
  wsId?: string
}

/**
 * Resolve the request's origin headers to an {@link InboxOrigin}.
 *
 * Returns `undefined` when there is no resolvable header, the workspace service
 * isn't up, or no id matches a record — in all those cases the push simply
 * carries no origin (the manual case).
 */
export function resolveInboxOrigin(
  headers: InboxOriginHeaders,
  getWorkspaceService: () => WorkspaceServiceLike | null,
): InboxOrigin | undefined {
  const svc = getWorkspaceService()

  // 1) HEADLESS — a resolvable run header always wins (the automation path).
  const runId = headers.run?.trim()
  if (runId) {
    const rec = svc?.headlessTasks.get(runId) ?? null
    if (rec) {
      return {
        kind: 'headless',
        runId: rec.taskId,
        ...(rec.issueId ? { issueId: rec.issueId } : {}),
        ...(rec.agent ? { agent: rec.agent } : {}),
      }
    }
    // A present-but-unknown run id falls through to the session header rather
    // than fabricating a link — symmetric with the unknown-session case below.
  }

  // 2) INTERACTIVE — validate the session id against the SessionRegistry
  //    (authority, scoped by the route's wsId). A forged/unknown id → undefined.
  const sessionId = headers.session?.trim()
  const wsId = headers.wsId?.trim()
  if (sessionId && wsId && svc) {
    const rec = svc.sessionRegistry.get(wsId, sessionId)
    if (rec) {
      return {
        kind: 'interactive',
        sessionId: rec.id,
        ...(rec.agent ? { agent: rec.agent } : {}),
      }
    }
  }

  return undefined
}
