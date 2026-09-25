import { readUpdatePreferences, type UpdatePreferences } from '../core/update-preferences.js'
import { readHarnessSource } from './harness-source.js'
import type { WorkspaceService } from './service.js'

const CHECK_INTERVAL_MS = 60 * 60_000
const SOURCE_TEMPLATES = {
  'auto-quant-v2': 'autoUpdateAutoQuant',
  'auto-prediction': 'autoUpdateAutoPrediction',
} as const satisfies Record<string, keyof UpdatePreferences>

type Phase = 'checking' | 'current' | 'updated' | 'blocked' | 'failed' | 'disabled'
export interface WorkspaceUpdateState {
  readonly workspaceId: string
  readonly template: keyof typeof SOURCE_TEMPLATES
  readonly phase: Phase
  readonly checkedAt: string | null
  readonly fromVersion?: string
  readonly toVersion?: string
  readonly verified?: boolean
  readonly reason?: string
}

/**
 * Background discovery and safe source merging. Never holds up Runtime start.
 * The source-upgrade manager remains the only authority for Git, activity,
 * manifest compatibility, and transaction recovery.
 */
export class WorkspaceAutoUpdates {
  private readonly states = new Map<string, WorkspaceUpdateState>()
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight: Promise<void> | null = null
  private stopped = false

  constructor(private readonly service: Pick<WorkspaceService, 'registry' | 'sourceUpgrades'>) {}

  list(): readonly WorkspaceUpdateState[] { return [...this.states.values()] }

  start(): void {
    if (this.timer) return
    this.stopped = false
    void this.check()
    this.timer = setInterval(() => { void this.check() }, CHECK_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  check(): Promise<void> {
    if (this.inFlight) return this.inFlight
    const run = this.scan().finally(() => { if (this.inFlight === run) this.inFlight = null })
    this.inFlight = run
    return run
  }

  private async scan(): Promise<void> {
    const preferences = await readUpdatePreferences()
    for (const workspace of this.service.registry.list()) {
      if (this.stopped) return
      if (!(workspace.template && workspace.template in SOURCE_TEMPLATES)) continue
      const template = workspace.template as keyof typeof SOURCE_TEMPLATES
      const prior = this.states.get(workspace.id)
      if (!preferences[SOURCE_TEMPLATES[template]]) {
        this.states.set(workspace.id, { workspaceId: workspace.id, template, phase: 'disabled', checkedAt: new Date().toISOString() })
        continue
      }
      this.states.set(workspace.id, { workspaceId: workspace.id, template, phase: 'checking', checkedAt: prior?.checkedAt ?? null })
      try {
        const receipt = await readHarnessSource(workspace.dir)
        if (!receipt) throw new Error('Workspace has no Harness source receipt')
        // The maintainer chose stable upstream tags as the default automatic
        // target. The returned release still records verified=false when it is
        // outside OpenAlice's built-in catalog.
        const latest = await this.service.sourceUpgrades.latest(template, receipt.version, true)
        if (!latest) {
          this.states.set(workspace.id, { workspaceId: workspace.id, template, phase: 'current', checkedAt: new Date().toISOString(), fromVersion: receipt.version })
          continue
        }
        const details = { workspaceId: workspace.id, template, checkedAt: new Date().toISOString(), fromVersion: receipt.version, toVersion: latest.version, verified: latest.verified }
        const plan = await this.service.sourceUpgrades.plan(workspace.id, true, latest.version)
        if (plan.blocked) {
          this.states.set(workspace.id, { ...details, phase: 'blocked', reason: plan.blockers.join(', ') })
          continue
        }
        if (this.stopped) return
        await this.service.sourceUpgrades.apply(workspace.id, true, { planDigest: plan.planDigest, targetVersion: latest.version })
        this.states.set(workspace.id, { ...details, phase: 'updated' })
      } catch (error) {
        this.states.set(workspace.id, {
          workspaceId: workspace.id, template, phase: 'failed', checkedAt: new Date().toISOString(),
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
}
