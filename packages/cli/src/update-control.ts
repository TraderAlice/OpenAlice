import { join } from 'node:path'
import { activeEvidence, verifyReleaseEvidence, createUpdatePlan, projectUpdateUnit, type UpdatePlan, type UpdateOperation, type UpdateProposal, type UpdateOwner } from '@traderalice/update-lifecycle'
import { FileUpdateJournal } from '@traderalice/update-lifecycle/node'
import { resolveSupervisorRootPath } from './launch-context.ts'
import type { MachinePlanPreview } from './machine-management.ts'

export interface UpdateSelection { client: boolean; backend: boolean; projectUnits: string[] }
export interface UpdateControlOptions {
  root?: string
  scope(): string
  project(path: string, body?: unknown): Promise<unknown>
  backend?: {
    plan(): Promise<MachinePlanPreview>
    apply(id: string): Promise<unknown>
  }
  client?: {
    current(): string
    downloaded(): string | null
    install(version: string, parentOperationId: string): Promise<unknown>
    ready(): Promise<boolean>
    recovery?: {
      status(): Promise<UpdateOperation | null>
      resume(): Promise<UpdateOperation | null>
      abandon(): Promise<void>
    }
  }
}
/** Durable local composition of owner commands. Browser reload drops no receipt;
 * child request ids survive relay/desktop restart and are reconciled before retry. */
export class UpdateControlService {
  private readonly journal: FileUpdateJournal
  private flight: Promise<UpdateOperation> | null = null
  private readonly options: UpdateControlOptions
  constructor(options: UpdateControlOptions) {
    this.options = options
    this.journal = new FileUpdateJournal(join(options.root ?? resolveSupervisorRootPath(), 'update-control'), 'local-control')
  }
  private project(path: string, body: unknown, scope: string): Promise<unknown> {
    if (this.options.scope() !== scope) throw new Error('The selected project changed during the update')
    return this.options.project(path, body)
  }
  /** A pending native activation takes precedence over unrelated history.
   * A linked child remains part of its coordinated parent, including recovery. */
  private async recovery() {
    const [control, native] = await Promise.all([this.journal.read(), this.options.client?.recovery?.status()])
    const child = control && native && native.plan.proposals[0]?.reference?.parentOperationId === control.id
      && control.plan.proposals.some(p => p.unit.id === 'client' && p.fingerprint === native.plan.proposals[0]?.unit.desired?.version)
      ? native : null
    if (native && (!control || (native.phase !== 'succeeded' && !(child && control.phase !== 'succeeded')))) {
      return { owner: 'native' as const, operation: native, child: null }
    }
    return { owner: 'control' as const, operation: control ?? native ?? null, child }
  }
  async abandon(): Promise<void> {
    if (this.flight) throw new Error('Wait for the owner command to return before ending this plan')
    const selected = await this.recovery()
    if (selected.owner === 'native') await this.options.client!.recovery!.abandon()
    else {
      if (selected.child && selected.child.phase !== 'succeeded') await this.options.client!.recovery!.abandon()
      await this.journal.abandon()
    }
  }
  async status(): Promise<UpdateOperation | null> { return (await this.recovery()).operation }
  async review(selection: UpdateSelection): Promise<UpdatePlan> {
    if (!selection || !Array.isArray(selection.projectUnits) || selection.projectUnits.length > 100) throw new Error('Invalid update selection')
    const proposals: UpdateProposal[] = []
    const scope = this.options.scope()
    if (selection.backend) {
      if (!this.options.backend) throw new Error('This backend has an external installation owner')
      const plan = await this.options.backend.plan()
      const unit = projectUpdateUnit('backend', 'remote', scope, { version: plan.installedVersion }, plan.releaseIdentity ?? { version: plan.targetVersion })
      unit.policyScope = 'machine'
      unit.active = plan.activeVersion ? { version: plan.activeVersion } : null
      proposals.push({ unit, fingerprint: backendFingerprint(plan), stages: ['apply', 'verify'],
        reference: { scope, target: plan.targetVersion, installed: plan.installedVersion, active: plan.activeVersion ?? '', review: plan.id }, blockers: plan.blocker ? [plan.blocker] : [] })
    }
    if (selection.projectUnits.length) {
      const child = await this.project('/api/updates/plan', { units: selection.projectUnits }, scope) as UpdatePlan
      if (child?.schemaVersion !== 1 || !Array.isArray(child.proposals)) throw new Error('Backend does not declare project update coordination')
      proposals.push({ unit: projectUpdateUnit('project', 'project', scope, null, { version: 'managed-content', revision: child.fingerprint }),
        fingerprint: child.fingerprint, stages: ['apply', 'verify'], after: selection.backend ? ['backend'] : [],
        reference: { scope, plan: JSON.stringify(child) }, blockers: child.blockers })
    }
    if (selection.client) {
      const version = this.options.client?.downloaded()
      if (!version) throw new Error('No verified native download is ready')
      proposals.push({ unit: { ...projectUpdateUnit('client', 'electron-updater', 'local', { version: this.options.client!.current() }, { version }), policyScope: 'client', roles: ['renderer', 'relay', 'bundled-runtime'] },
        fingerprint: version, stages: ['activate', 'verify', 'reconnect'], after: proposals.map(p => p.unit.id), reference: { scope } })
    }
    if (!proposals.length) throw new Error('Select an update owner')
    return createUpdatePlan('local-control', proposals)
  }
  async approve(plan: UpdatePlan, fingerprint: string): Promise<UpdateOperation> {
    const native = await this.options.client?.recovery?.status()
    if (native && native.phase !== 'succeeded') throw new Error('Resume or abandon the unfinished native update before approving another plan')
    // Owner fingerprints are refreshed at approval; generated review ids are
    // references, not evidence. A new publication invalidates this review.
    const refreshed = await this.review({ client: plan.proposals.some(p => p.unit.id === 'client'), backend: plan.proposals.some(p => p.unit.id === 'backend'),
      projectUnits: plan.proposals.find(p => p.unit.id === 'project') ? (JSON.parse(plan.proposals.find(p => p.unit.id === 'project')!.reference!.plan!) as UpdatePlan).proposals.map(p => p.unit.id) : [] })
    const comparable = (p: UpdatePlan) => JSON.stringify(p.proposals.map(({ unit, fingerprint: fp, blockers }) => ({ unit, fp, blockers })))
    if (plan.fingerprint !== fingerprint || comparable(plan) !== comparable(refreshed)) throw new Error('Update review changed; inspect a fresh plan')
    // Persist the refreshed trusted plan, never a caller-supplied effect payload.
    return this.journal.approve(refreshed, refreshed.fingerprint)
  }
  resume(): Promise<UpdateOperation> {
    if (this.flight) return this.flight
    const run = (async () => {
      const selected = await this.recovery()
      if (selected.owner === 'native') {
        const result = await this.options.client!.recovery!.resume()
        if (!result) throw new Error('Native update receipt disappeared during recovery')
        return result
      }
      if (selected.child && selected.child.phase !== 'succeeded') await this.options.client!.recovery!.resume()
      return this.journal.run(this.owner())
    })().finally(() => { if (this.flight === run) this.flight = null })
    this.flight = run
    return run
  }
  private owner(): UpdateOwner {
    return {
      reconcile: async (step, p, op) => {
        if (p.unit.id !== 'client' && p.reference!.scope !== this.options.scope()) return { status: 'blocked', reason: 'Reconnect to the approved Machine and AliceProject before continuing this update' }
        if (p.unit.id === 'client') {
          const native = await this.options.client?.recovery?.status()
          if (native && native.phase !== 'succeeded') {
            if (native.plan.proposals[0]?.reference?.parentOperationId !== op.id
              || native.plan.proposals[0]?.unit.desired?.version !== p.fingerprint) {
              return { status: 'blocked', reason: 'Another native operation owns desktop activation' }
            }
            return { status: native.phase === 'waiting' ? 'waiting' : 'unknown', reason: native.error ?? 'Native activation requires recovery' }
          }
          if (this.options.client?.current() === p.fingerprint) {
            if (step.stage !== 'reconnect' || await this.options.client.ready()) return { status: 'complete', receipt: `native:${p.fingerprint}:${step.stage}` }
            return { status: 'waiting', reason: 'Waiting for desktop readiness' }
          }
          if (step.stage !== 'activate') return { status: 'unknown', reason: 'The running desktop is not the approved release' }
          if (this.options.client?.downloaded() !== p.fingerprint) return { status: 'waiting', reason: 'The exact approved native download is not ready' }
          return op.inFlight === step.id ? { status: 'unknown', reason: 'Inspect the native activation receipt before retrying the installer' } : { status: 'ready' }
        }
        if (p.unit.id === 'project') {
          const child = await this.project(`/api/updates/operations/${op.id}`, undefined, p.reference!.scope!) as UpdateOperation | null
          if (child?.phase === 'succeeded') return { status: 'complete', receipt: child.id }
          if (child?.phase === 'recovery') return { status: 'unknown', reason: child.error ?? 'Project recovery required' }
          return { status: 'ready' }
        }
        const plan = await this.options.backend!.plan()
        const target = p.unit.desired!
        const installed = plan.observed?.installed ?? { version: plan.installedVersion }
        const active = plan.observed?.active ?? (plan.activeVersion ? { version: plan.activeVersion } : null)
        if (!plan.blocker && verifyReleaseEvidence(target, installed).status === 'matched' && verifyReleaseEvidence(activeEvidence({ ...target, channel: null }), active).status === 'matched') return { status: 'complete', receipt: `remote:${JSON.stringify(target)}` }
        if (plan.targetVersion !== p.reference!.target || JSON.stringify(plan.releaseIdentity ?? { version: plan.targetVersion }) !== JSON.stringify(p.unit.desired)) return { status: 'blocked', reason: 'Backend target changed; the approved release cannot be silently replaced' }
        if (step.stage === 'verify') return { status: 'unknown', reason: 'Remote owner did not verify the approved installed and active release' }
        if (!op.inFlight && backendFingerprint(plan) !== p.fingerprint) return { status: 'blocked', reason: 'Remote state changed after approval' }
        return plan.blocker ? { status: 'blocked', reason: plan.blocker } : { status: 'ready' }
      },
      execute: async (_step, p, op) => {
        if (p.unit.id !== 'client' && this.options.scope() !== p.reference!.scope) return { status: 'blocked', reason: 'The selected project changed during the update' }
        if (p.unit.id === 'client') {
          await this.options.client!.install(p.fingerprint, op.id)
          return { status: 'waiting', reason: 'Resume after native desktop activation' }
        }
        if (p.unit.id === 'backend') {
          const plan = await this.options.backend!.plan()
          if (plan.targetVersion !== p.reference!.target || JSON.stringify(plan.releaseIdentity ?? { version: plan.targetVersion }) !== JSON.stringify(p.unit.desired)) return { status: 'blocked', reason: 'Approved remote release is no longer the proposed target' }
          await this.options.backend!.apply(plan.id)
          return { status: 'complete', receipt: `remote:${p.fingerprint}` }
        }
        const prior = await this.project(`/api/updates/operations/${op.id}`, undefined, p.reference!.scope!) as UpdateOperation | null
        if (!prior) await this.project('/api/updates/operations', { id: op.id, plan: JSON.parse(p.reference!.plan!), fingerprint: p.fingerprint }, p.reference!.scope!)
        const result = await this.project(`/api/updates/operations/${op.id}/resume`, {}, p.reference!.scope!) as UpdateOperation
        return result.phase === 'succeeded' ? { status: 'complete', receipt: result.id }
          : { status: result.phase === 'recovery' ? 'unknown' : 'blocked', reason: result.error ?? 'Project update paused' }
      },
    }
  }
}
function backendFingerprint(plan: MachinePlanPreview): string {
  return JSON.stringify({ machine: plan.machine.key, project: plan.project?.key, installed: plan.installedVersion, active: plan.activeVersion, release: plan.releaseIdentity, target: plan.targetVersion, actions: plan.actions, blocker: plan.blocker })
}
