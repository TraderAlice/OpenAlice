import { DiscoveryStore } from '@traderalice/update-lifecycle'
import {
  getHarnessSourceUpgradePlan, getTemplateUpgradePlan, TemplateUpgradeApiError, HarnessSourceUpgradeApiError,
  type Workspace, type TemplateUpgradePlan, type HarnessSourceUpgradePlan, type SkillProjectionRequest,
} from '../../components/workspace/api'

export type WorkspacePlanRequest = { workspaceId: string; targetVersion?: string } & (
  | { kind: 'source' }
  | { kind: 'template'; layer?: 'template' | 'alice-harness'; projection?: SkillProjectionRequest }
)
export type WorkspacePlan = TemplateUpgradePlan | HarnessSourceUpgradePlan
interface PlanValue { plan: WorkspacePlan | null; error?: string; unsupported?: boolean }

export function workspacePlanKey(request: WorkspacePlanRequest): string {
  return JSON.stringify(request.kind === 'source'
    ? [request.workspaceId, 'source', request.targetVersion ?? null]
    : [request.workspaceId, request.layer ?? 'template', request.projection?.skill ?? null, request.projection?.action ?? null, request.targetVersion ?? null])
}
export function workspacePlanRequest(workspace: Pick<Workspace, 'id' | 'template' | 'upgradeAvailable'>): WorkspacePlanRequest {
  return workspace.upgradeAvailable?.kind === 'source' || ['auto-quant-v2', 'auto-prediction'].includes(workspace.template ?? '')
    ? { workspaceId: workspace.id, kind: 'source' }
    : { workspaceId: workspace.id, kind: 'template' }
}

export function workspacePlanIsCurrent(plan: WorkspacePlan): boolean {
  return plan.fromVersion === plan.toVersion && (plan.strategy !== 'source-merge' || plan.fromCommit === plan.toCommit)
}

/** One backend generation owns this read-only inventory. Core DiscoveryStore
 * owns flight ordering and last-success retention; panels only own decisions. */
export class WorkspacePlanStore {
  private entries = new Map<string, { request: WorkspacePlanRequest; resource: DiscoveryStore<PlanValue> }>()
  private inventory = new Map<string, string>()
  private listeners = new Set<() => void>()
  private revision = 0
  constructor(private active = true) {}
  getSnapshot = () => this.revision
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish = () => { this.revision++; for (const listener of this.listeners) listener() }
  activate = () => { this.active = true }
  retire = () => { this.active = false; for (const entry of this.entries.values()) entry.resource.clear() }
  isActive = () => this.active
  resource(request: WorkspacePlanRequest): DiscoveryStore<PlanValue> {
    const key = workspacePlanKey(request)
    let entry = this.entries.get(key)
    if (!entry) {
      const resource = new DiscoveryStore<PlanValue>({ successTtlMs: Infinity, errorTtlMs: Infinity })
      entry = { request: { ...request }, resource }; this.entries.set(key, entry)
      resource.subscribe(this.publish)
    }
    return entry.resource
  }
  peek(request: WorkspacePlanRequest) { return this.entries.get(workspacePlanKey(request))?.resource.getSnapshot().value?.plan ?? null }
  private read = async (request: WorkspacePlanRequest): Promise<PlanValue> => {
    try {
      const plan = await (request.kind === 'source' ? getHarnessSourceUpgradePlan(request.workspaceId, request.targetVersion)
        : getTemplateUpgradePlan(request.workspaceId, request.layer ?? 'template', request.projection))
      this.validate(request, plan)
      return { plan }
    } catch (cause) {
      if (cause instanceof TemplateUpgradeApiError || cause instanceof HarnessSourceUpgradeApiError) {
        if (cause.plan) this.validate(request, cause.plan)
        if (cause.plan || cause.code === 'unsupported') return { plan: cause.plan ?? null, error: cause.message, unsupported: cause.code === 'unsupported' }
      }
      throw cause
    }
  }
  private validate(request: WorkspacePlanRequest, plan: WorkspacePlan): void {
    if (request.targetVersion && plan.toVersion !== request.targetVersion) throw new Error('The checked update target changed; check for updates again')
    if (plan.workspaceId !== request.workspaceId || plan.strategy !== (request.kind === 'source' ? 'source-merge' : 'managed-context')) {
      throw new Error('Update preview does not match the requested Workspace and layer')
    }
  }
  ensure = (request: WorkspacePlanRequest) => this.active ? this.resource(request).check(() => this.read(request)) : Promise.resolve(null)
  refresh = (request: WorkspacePlanRequest) => this.active ? this.resource(request).check(() => this.read(request), true) : Promise.resolve(null)
  replace = async (request: WorkspacePlanRequest, plan: WorkspacePlan) => {
    if (!this.active) return
    this.validate(request, plan)
    const resource = this.resource(request); resource.clear(); await resource.check(async () => ({ plan }))
  }
  invalidateWorkspace = (workspaceId: string) => {
    for (const entry of this.entries.values()) if (entry.request.workspaceId === workspaceId) entry.resource.clear()
  }
  reconcile(workspaces: readonly Workspace[], loaded: boolean): void {
    if (!loaded) return
    const ids = new Set(workspaces.map(workspace => workspace.id))
    for (const [id] of this.inventory) if (!ids.has(id)) {
      this.invalidateWorkspace(id); this.inventory.delete(id)
      for (const [key, entry] of this.entries) if (entry.request.workspaceId === id) this.entries.delete(key)
    }
    for (const workspace of workspaces) {
      const signature = JSON.stringify([workspace.template, workspace.currentVersion, workspace.upgradeAvailable, workspace.harnessSource])
      if (this.inventory.has(workspace.id) && this.inventory.get(workspace.id) !== signature) this.invalidateWorkspace(workspace.id)
      this.inventory.set(workspace.id, signature)
    }
  }
  private observations = new Map<string, string>()
  observe(states: readonly { workspaceId: string; fromVersion?: string; toVersion?: string; phase: string }[]): void {
    const present = new Set(states.map(state => state.workspaceId))
    for (const [id] of this.observations) if (!present.has(id)) {
      this.invalidateWorkspace(id); this.observations.delete(id)
    }
    for (const state of states) {
      const signature = JSON.stringify([state.fromVersion, state.toVersion, state.phase])
      if (this.observations.get(state.workspaceId) !== signature) this.invalidateWorkspace(state.workspaceId)
      this.observations.set(state.workspaceId, signature)
    }
  }
  invalidateReviews(): void {
    for (const entry of this.entries.values()) entry.resource.clear()
  }
}
