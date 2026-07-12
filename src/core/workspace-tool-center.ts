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
import type { IInboxStore, InboxEntry, InboxOrigin } from './inbox-store.js'
import type { IEntityStore } from './entity-store.js'
import type { IProvenanceStore } from './provenance-store.js'
import type { ArtifactRef, SessionOrigin } from './provenance-store.js'
// TYPE-ONLY: the global-issue-board shapes. Importing them as types keeps
// core/ free of any runtime dependency on the workspaces/ module (no
// core→workspaces coupling), while letting the board reader below be typed.
import type { IssuesSnapshot, IssueDetail, WikilinkIssueRef } from '../workspaces/issues/board.js'
import type { WorkspaceSessionDirectory } from '../workspaces/session-directory.js'
import type { HeadlessStructuredOutput } from '../workspaces/headless-output.js'
import type { HeadlessInquirySubject, HeadlessTaskStatus } from '../workspaces/headless-task-registry.js'

export type WorkspaceConversationTarget =
  | { kind: 'resume'; resumeId: string }
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'inbox'; inboxEntryId: string; workspaceId?: string }
  | {
      kind: 'issue'
      workspaceId: string
      issueId: string
      action?: 'created' | 'updated' | 'commented'
    }
  | {
      kind: 'report'
      workspaceId: string
      path: string
      revision?: string
      action?: 'created' | 'updated' | 'sent'
    }
  | {
      kind: 'trade-decision'
      accountId: string
      decisionId: string
      workspaceId?: string
    }

export type WorkspaceConversationResolution =
  | {
      mode: 'exact'
      origin: SessionOrigin
      artifact?: ArtifactRef
    }
  | {
      mode: 'reconstructed'
      workspaceId: string
      reason: 'explicit-workspace' | 'missing-origin' | 'non-session-origin' | 'prior-reconstruction' | 'unavailable-reconstruction'
      /** Present when continuing a previously recruited reconstruction worker. */
      origin?: SessionOrigin
      artifact?: ArtifactRef
    }
  | {
      mode: 'unavailable'
      reason:
        | 'missing-session'
        | 'missing-native-session'
        | 'retired-session'
        | 'departed-workspace'
        | 'purged-workspace'
        | 'deleted-workspace'
        | 'missing-workspace'
      attributedOrigin?: SessionOrigin
      artifact?: ArtifactRef
    }

export interface WorkspaceConversationTask {
  readonly taskId: string
  readonly resumeId: string
  readonly parentTaskId?: string
  readonly workspaceId: string
  readonly issueId?: string
  readonly agent: string
  readonly status: HeadlessTaskStatus
  readonly startedAt: number
  readonly finishedAt?: number
  readonly durationMs?: number
  readonly error?: string
  readonly structured: HeadlessStructuredOutput | null
}

export type WorkspaceConversationAskResult =
  | {
      readonly status: 'dispatched'
      readonly taskId: string
      readonly resumeId: string
      readonly workspaceId: string
      readonly workspace: string
      readonly agent: string
      readonly resolution: Exclude<WorkspaceConversationResolution, { mode: 'unavailable' }>
    }
  | {
      readonly status: 'unavailable'
      readonly resolution: Extract<WorkspaceConversationResolution, { mode: 'unavailable' }>
    }

export interface WorkspaceConversationControl {
  ask(input: {
    readonly prompt: string
    readonly timeoutMs: number
    readonly target: WorkspaceConversationTarget
    readonly agent?: string
    /** Optional business reverse link persisted with the dispatched task. */
    readonly subject?: HeadlessInquirySubject
  }): Promise<WorkspaceConversationAskResult>
  read(taskId: string): Promise<WorkspaceConversationTask | null>
}

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
  /** Durable Session -> artifact occurrence trail. Optional for older/tests. */
  provenanceStore?: IProvenanceStore
  /** Resolve ANY workspace's location by id (not just this one) — the backing
   *  for cross-workspace collaboration: an inbox entry from a peer carries its
   *  workspaceId, and `workspace_path` turns that into the peer's absolute dir
   *  so the agent can read/edit its files with native tools. Optional because
   *  it needs the live WorkspaceService (created after this center); the two
   *  build sites (cli.ts, mcp.ts) inject a lazy closure, tests may omit it. */
  resolveWorkspace?: (id: string) => { id: string; dir: string; tag: string } | null
  /**
   * Return safe provenance an agent may use to follow up on an Inbox entry.
   * Older append-only entries can be enriched from live run/session registries
   * without rewriting their stored history.
   */
  resolveInboxOrigin?: (entry: InboxEntry) => InboxOrigin | undefined
  /** Safe per-workspace conversation directory. It exposes product resumeIds,
   * never adapter-native session ids or launcher record ids. */
  sessionDirectory?: (workspaceId: string, limit?: number) => Promise<WorkspaceSessionDirectory | null>
  /** Safe point lookup used to validate declared Issue ownership. */
  resolveSessionIdentity?: (resumeId: string) => {
    workspaceId: string
    agent: string
    resumable: boolean
  } | null
  /** Embedded provenance-aware headless conversation control; never routes
   * through the public HTTP API. */
  conversation?: WorkspaceConversationControl
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

interface InboxOriginRegistryLike {
  headlessTasks: { get(id: string): { resumeId: string } | null }
  sessionRegistry: {
    get(wsId: string, id: string): { resumeId: string } | undefined
  }
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

/**
 * Resolve agent-visible Inbox provenance without exposing native runtime ids.
 * New entries already carry resumeId; older ones are joined at read time.
 */
export function makeInboxEntryOriginResolver(
  getService: () => InboxOriginRegistryLike | null,
): NonNullable<WorkspaceToolContext['resolveInboxOrigin']> {
  return (entry) => {
    const origin = toSafeInboxOrigin(entry.origin)
    if (!origin || origin.resumeId) return origin

    if (origin.kind === 'headless' && origin.runId) {
      const resumeId = getService()?.headlessTasks.get(origin.runId)?.resumeId
      return resumeId ? { ...origin, resumeId } : origin
    }

    if (origin.kind === 'interactive' && origin.sessionId) {
      const resumeId = getService()?.sessionRegistry.get(
        entry.workspaceId,
        origin.sessionId,
      )?.resumeId
      return resumeId ? { ...origin, resumeId } : origin
    }

    return origin
  }
}

/** Runtime whitelist for append-only entries that may contain legacy fields. */
export function toSafeInboxOrigin(origin: InboxOrigin | undefined): InboxOrigin | undefined {
  if (!origin || !['headless', 'interactive', 'manual'].includes(origin.kind)) return undefined
  return {
    kind: origin.kind,
    ...(typeof origin.runId === 'string' ? { runId: origin.runId } : {}),
    ...(typeof origin.issueId === 'string' ? { issueId: origin.issueId } : {}),
    ...(typeof origin.sessionId === 'string' ? { sessionId: origin.sessionId } : {}),
    ...(typeof origin.resumeId === 'string' ? { resumeId: origin.resumeId } : {}),
    ...(typeof origin.agent === 'string' ? { agent: origin.agent } : {}),
  }
}
