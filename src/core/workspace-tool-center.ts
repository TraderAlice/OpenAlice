/**
 * WorkspaceToolCenter — registry of **workspace-scoped tool factories**.
 *
 * Parallel to {@link ToolCenter} but inverted in a key way: ToolCenter holds
 * concrete tool instances that don't care who is calling. WorkspaceToolCenter
 * holds *factories* — each one takes a workspace identity (wsId, label,
 * shared deps) and returns a concrete Tool whose execute() closes over that
 * identity. This is how OpenAlice exposes the "workspace's reverse channel
 * back to OpenAlice" surface (inbox_push and future workspace-scoped tools)
 * without ever asking the AI agent to traffic its own workspaceId.
 *
 * The MCP server's `/mcp/:wsId` route invokes every factory with the URL's
 * wsId at request time. From the agent's POV, `inbox_push({ docs, comments })`
 * has no identity parameter — workspaceId is invisible, baked into the
 * tool by the server. Forgery surface is zero because the URL is the
 * only identity carrier and `.mcp.json` is per-workspace.
 *
 * Why a separate registry instead of marking ToolCenter tools as
 * "workspace-scoped": the surface areas are genuinely different. ToolCenter
 * is "OpenAlice's services for anyone with an MCP client" — trading, market
 * data, news, brain. WorkspaceToolCenter is "this specific workspace's
 * communication back to OpenAlice." Mixing them under one registry with a
 * scope flag would tangle access control with tool execution, and external
 * MCP consumers would see workspace-shaped tools they can't sensibly use.
 */

import type { Tool } from 'ai'
import type { IInboxStore, InboxOrigin } from './inbox-store.js'
import type { IEntityStore } from './entity-store.js'
// TYPE-ONLY: the global-issue-board shapes. Importing them as types keeps
// core/ free of any runtime dependency on the workspaces/ module (no
// core→workspaces coupling), while letting the board reader below be typed.
import type { IssuesSnapshot, IssueDetail, WikilinkIssueRef } from '../workspaces/issues/board.js'

// ==================== Context handed to factories ====================

export interface WorkspaceToolContext {
  /** The workspace's stable id. Filled by the MCP router from URL path. */
  workspaceId: string
  /** Snapshot of the workspace's display tag at build time. Factories can
   *  pass this through to call sites (e.g. inboxStore.append's
   *  workspaceLabel) so the inbox UI has a human-readable name even if
   *  the workspace tag changes later. */
  workspaceLabel: string
  /** Shared inbox store — passed in so factories don't have to import
   *  global state and tests can swap in a memory store. */
  inboxStore: IInboxStore
  /** Shared entity store — the durable cross-workspace tracked-index that
   *  entity_upsert / entity_search read and write. Same injection rationale
   *  as inboxStore. */
  entityStore: IEntityStore
  /** Resolve ANY workspace's location by id (not just this one) — the backing
   *  for cross-workspace collaboration: an inbox entry from a peer carries its
   *  workspaceId, and `workspace_path` turns that into the peer's absolute dir
   *  so the agent can read/edit its files with native tools. Optional because
   *  it needs the live WorkspaceService (created after this center); the two
   *  build sites (cli.ts, mcp.ts) inject a lazy closure, tests may omit it. */
  resolveWorkspace?: (id: string) => { id: string; dir: string; tag: string } | null
  /** Agent-INVISIBLE run provenance, resolved server-side from the
   *  `x-openalice-run` header by the MCP / CLI route (never supplied by the
   *  agent). Factories pass it through to call sites (e.g. inbox_push →
   *  inboxStore.append) so a pushed entry self-links to its originating run /
   *  issue. Absent (interactive session, or no header) → undefined. */
  origin?: InboxOrigin
  /** GLOBAL issue-board reader — the cross-workspace board the
   *  `alice-workspace` CLI surfaces (issue_list / issue_show read EVERY
   *  workspace's issues, not just the caller's). Backed by the live
   *  WorkspaceService at the two build sites (cli.ts, mcp.ts). OPTIONAL: a
   *  context without a service (older callers, unit tests) omits it, and the
   *  issue tools then fall back to reading THIS workspace's own files — so
   *  nothing breaks when it's absent. Reads only; writes stay caller-local. */
  board?: {
    snapshot(): Promise<IssuesSnapshot>
    detail(wsId: string, id: string): Promise<IssueDetail | null>
    resolveByName(name: string): Promise<WikilinkIssueRef[]>
  }
}

// ==================== Factory shape ====================

export interface WorkspaceToolFactory {
  /** Tool name as the agent will see it (no namespace prefix needed — the
   *  factory lives behind `/mcp/:wsId` which has its own catalog). */
  name: string
  /** Build a concrete Tool with workspaceId baked in. Called per MCP
   *  request, so closure capture is the right pattern (no shared mutable
   *  state between workspace requests). */
  build(ctx: WorkspaceToolContext): Tool
}

// ==================== Center ====================

export class WorkspaceToolCenter {
  private factories: WorkspaceToolFactory[] = []

  register(factory: WorkspaceToolFactory): void {
    // Name collisions overwrite — same pattern as ToolCenter.
    this.factories = this.factories.filter((f) => f.name !== factory.name)
    this.factories.push(factory)
  }

  /** Build one concrete tool catalog for a specific workspace context.
   *  Called from the MCP `/mcp/:wsId` route per request. */
  build(ctx: WorkspaceToolContext): Record<string, Tool> {
    const out: Record<string, Tool> = {}
    for (const f of this.factories) {
      out[f.name] = f.build(ctx)
    }
    return out
  }

  /** Names of registered factories. Useful for introspection / tests. */
  list(): string[] {
    return this.factories.map((f) => f.name)
  }
}

// ==================== Resolver helper ====================

/** Minimal structural view of WorkspaceService that {@link makeWorkspaceResolver}
 *  needs — kept structural so core/ doesn't depend on the workspaces/ module. */
interface WorkspaceRegistryLike {
  registry: { get(id: string): { id: string; dir: string; tag: string } | undefined }
}

/**
 * Build the `resolveWorkspace` closure both tool-context build sites
 * (cli.ts, mcp.ts) inject. Single source so the two never drift. Lazy over
 * `getService` because the WorkspaceService is created after the tool center,
 * and re-reads the live registry per call so a peer created later still
 * resolves. Returns null when the service isn't up yet or the id is unknown —
 * the tool then surfaces a clean error instead of throwing.
 */
export function makeWorkspaceResolver(
  getService: () => WorkspaceRegistryLike | null,
): NonNullable<WorkspaceToolContext['resolveWorkspace']> {
  return (id) => {
    const meta = getService()?.registry.get(id)
    return meta ? { id: meta.id, dir: meta.dir, tag: meta.tag } : null
  }
}
