/**
 * Single Active Workspace Slot per Template.
 *
 * Each Workspace template category (`chat`, `auto-quant-v2`, `auto-prediction`,
 * or a custom template; legacy untemplated workspaces normalize to `chat`) has
 * at most ONE `active` Workspace at a time. All other non-offboarded Workspaces
 * of the same template are `standby`.
 *
 * Backed directly by the existing preference slots in `preferences.json` so
 * persisted state remains 100% backwards compatible with zero directory moves.
 */

import {
  readActiveWorkspaceSlots,
  rememberTemplateActiveWorkspace,
} from '@/core/preferences.js'

import { CHAT_WORKSPACE_TEMPLATE } from './chat-workspace-resolver.js'
import type { WorkspaceMeta, WorkspaceRegistry } from './workspace-registry.js'

export type WorkspaceActivationState = 'active' | 'standby'

/**
 * Normalize a Workspace's template name to its active-slot category.
 * Legacy untemplated Workspaces share the `chat` slot.
 */
export function workspaceTemplateSlot(template?: string): string {
  const trimmed = template?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : CHAT_WORKSPACE_TEMPLATE
}

export interface ActiveWorkspaceSlotStore {
  readSlots(): Promise<Record<string, string | null>>
  writeSlot(template: string, workspaceId: string | null): Promise<void>
}

export function createPreferenceWorkspaceSlotStore(path?: string): ActiveWorkspaceSlotStore {
  return {
    readSlots: () => readActiveWorkspaceSlots(path),
    writeSlot: (template, workspaceId) => rememberTemplateActiveWorkspace(template, workspaceId, path),
  }
}

export interface ResolvedActiveWorkspaceSlots {
  readonly activeByTemplate: ReadonlyMap<string, WorkspaceMeta>
  readonly activeIds: ReadonlySet<string>
  /** Template slots whose configured pointer was null/invalid/stale and needs persistence. */
  readonly repairs: ReadonlyMap<string, string | null>
}

function compareCreatedAtDesc(a: WorkspaceMeta, b: WorkspaceMeta): number {
  const aMs = Date.parse(a.createdAt)
  const bMs = Date.parse(b.createdAt)
  if (Number.isFinite(aMs) && Number.isFinite(bMs) && aMs !== bMs) {
    return bMs - aMs
  }
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? 1 : -1
  }
  return a.id.localeCompare(b.id)
}

/**
 * Pure canonical resolver for active Workspace slots.
 *
 * For each template present in `workspaces`:
 * - If `configuredSlots[template]` points to a Workspace in that template group,
 *   that Workspace is `active`.
 * - Otherwise, the most recently created Workspace of that template
 *   (`createdAt` descending) is selected as `active` and recorded in `repairs`.
 *
 * For any template in `configuredSlots` with a non-null pointer that has no
 * remaining Workspaces in `workspaces`, `repairs` records `null` so stale
 * pointers are cleared after offboarding the last Workspace of a template.
 */
export function resolveActiveWorkspaceSlots(
  workspaces: readonly WorkspaceMeta[],
  configuredSlots: Readonly<Record<string, string | null | undefined>>,
): ResolvedActiveWorkspaceSlots {
  const byTemplate = new Map<string, WorkspaceMeta[]>()
  for (const ws of workspaces) {
    const slot = workspaceTemplateSlot(ws.template)
    const group = byTemplate.get(slot)
    if (group) group.push(ws)
    else byTemplate.set(slot, [ws])
  }

  const activeByTemplate = new Map<string, WorkspaceMeta>()
  const activeIds = new Set<string>()
  const repairs = new Map<string, string | null>()

  for (const [template, group] of byTemplate.entries()) {
    const sorted = [...group].sort(compareCreatedAtDesc)
    const configuredId = configuredSlots[template] ?? null
    const matched = configuredId ? sorted.find((ws) => ws.id === configuredId) : undefined
    if (matched) {
      activeByTemplate.set(template, matched)
      activeIds.add(matched.id)
    } else {
      const fallback = sorted[0]!
      activeByTemplate.set(template, fallback)
      activeIds.add(fallback.id)
      repairs.set(template, fallback.id)
    }
  }

  for (const [template, configuredId] of Object.entries(configuredSlots)) {
    if (configuredId !== null && configuredId !== undefined && !byTemplate.has(template)) {
      repairs.set(template, null)
    }
  }

  return { activeByTemplate, activeIds, repairs }
}

/**
 * Stateful coordinator over `WorkspaceRegistry` + `ActiveWorkspaceSlotStore`.
 *
 * Reads live slot pointers on async resolution so external preference writes
 * are always observed, while keeping an in-memory snapshot for synchronous
 * callers (e.g., inbound connector polling).
 */
export class ActiveWorkspaceSlotManager {
  private lastConfiguredSlots: Record<string, string | null> = {}
  private mutationChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly registry: Pick<WorkspaceRegistry, 'get' | 'list'>,
    private readonly store: ActiveWorkspaceSlotStore = createPreferenceWorkspaceSlotStore(),
  ) {}

  private serializeMutation<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mutationChain.then(fn)
    this.mutationChain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private async writeSlot(template: string, workspaceId: string | null): Promise<void> {
    const slot = workspaceTemplateSlot(template)
    await this.store.writeSlot(slot, workspaceId)
    this.lastConfiguredSlots[slot] = workspaceId
  }

  async resolve(): Promise<ResolvedActiveWorkspaceSlots> {
    const configured = await this.store.readSlots()
    this.lastConfiguredSlots = { ...configured }
    return resolveActiveWorkspaceSlots(this.registry.list(), configured)
  }

  /**
   * Converge persisted slot pointers against the live registry.
   * Called at startup and after offboarding so missing/offboarded pointers fall
   * back to the most recently created Workspace of the same template (or null
   * when no Workspaces of that template remain).
   */
  async converge(): Promise<ResolvedActiveWorkspaceSlots> {
    return this.serializeMutation(async () => {
      const resolved = await this.resolve()
      for (const [template, workspaceId] of resolved.repairs.entries()) {
        await this.writeSlot(template, workspaceId)
      }
      return resolved
    })
  }

  async setActive(template: string, workspaceId: string | null): Promise<void> {
    return this.serializeMutation(() => this.writeSlot(template, workspaceId))
  }

  async listActiveWorkspaces(): Promise<WorkspaceMeta[]> {
    const resolved = await this.resolve()
    return this.registry.list().filter((ws) => resolved.activeIds.has(ws.id))
  }

  listActiveWorkspacesSync(): WorkspaceMeta[] {
    const all = this.registry.list()
    const resolved = resolveActiveWorkspaceSlots(all, this.lastConfiguredSlots)
    return all.filter((ws) => resolved.activeIds.has(ws.id))
  }

  async activeWorkspaceForTemplate(template?: string): Promise<WorkspaceMeta | undefined> {
    const resolved = await this.resolve()
    return resolved.activeByTemplate.get(workspaceTemplateSlot(template))
  }

  async isActive(workspaceId: string): Promise<boolean> {
    const resolved = await this.resolve()
    return resolved.activeIds.has(workspaceId)
  }

  async activationState(workspaceId: string): Promise<WorkspaceActivationState> {
    return (await this.isActive(workspaceId)) ? 'active' : 'standby'
  }

  /**
   * Creation / restore rule:
   * - If the template ALREADY has a valid active Workspace (other than this
   *   newly created one), do NOT steal active — the new Workspace stays `standby`.
   * - If the template has NO valid active Workspace yet, automatically activate
   *   the newly created Workspace and persist it.
   */
  async handleWorkspaceCreated(workspace: WorkspaceMeta): Promise<WorkspaceActivationState> {
    return this.serializeMutation(async () => {
      const slot = workspaceTemplateSlot(workspace.template)
      const configured = await this.store.readSlots()
      this.lastConfiguredSlots = { ...configured }
      const configuredId = configured[slot] ?? null
      if (configuredId && configuredId !== workspace.id) {
        const existing = this.registry.get(configuredId)
        if (existing && workspaceTemplateSlot(existing.template) === slot) {
          return 'standby'
        }
      }
      await this.writeSlot(slot, workspace.id)
      return 'active'
    })
  }
}
