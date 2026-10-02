import { join } from 'node:path'
import { createUpdatePlan, verifyReleaseEvidence, type UpdateOwner, type UpdateOperation } from '@traderalice/update-lifecycle'
import { FileUpdateJournal } from '@traderalice/update-lifecycle/node'

/** Lives in userData, independently of the backend being replaced. Native
 * signature/checksum validation remains electron-updater's responsibility. */
export class DesktopUpdateLifecycle {
  readonly journal: FileUpdateJournal
  constructor(root: string, private readonly currentVersion: () => string) {
    this.journal = new FileUpdateJournal(join(root, 'update-operations'), 'desktop')
  }
  snapshot(): Promise<UpdateOperation | null> { return this.journal.read() }
  async install(version: string, prepare: () => Promise<void>, handoff: () => Promise<void>, parentOperationId?: string): Promise<UpdateOperation> {
    const plan = createUpdatePlan('desktop', [{
      unit: { id: 'desktop', installationId: 'desktop', roles: ['renderer', 'relay', 'bundled-runtime'], owner: 'electron-updater', location: 'local',
        installed: { version: this.currentVersion() }, active: { version: this.currentVersion() }, desired: { version }, source: 'native-feed', policyScope: 'client', capabilities: null, operations: ['update'] },
      reference: parentOperationId ? { parentOperationId } : undefined,
      fingerprint: `native:${version}`, stages: ['prepare', 'activate', 'verify', 'reconnect'],
    }])
    const existing = await this.journal.read()
    if (!existing || existing.phase === 'succeeded') await this.journal.approve(plan, plan.fingerprint)
    else if (existing.plan.proposals[0]?.unit.desired?.version !== version
      || existing.plan.proposals[0]?.reference?.parentOperationId !== parentOperationId) throw new Error('Resume the approved desktop release before selecting another target')
    return this.journal.run(this.owner({ prepare, handoff }))
  }
  async resume(ready: () => Promise<boolean>): Promise<UpdateOperation | null> {
    if (!await this.journal.read()) return null
    return this.journal.run(this.owner({ ready }))
  }
  private owner(effects: { prepare?: () => Promise<void>; handoff?: () => Promise<void>; ready?: () => Promise<boolean> }): UpdateOwner {
    const matched = (version: string) => verifyReleaseEvidence({ version }, { version: this.currentVersion() }).status === 'matched'
    return {
      reconcile: async (step, proposal, operation) => {
        const version = proposal.unit.desired!.version
        if (matched(version) && ['prepare', 'activate', 'verify'].includes(step.stage)) return { status: 'complete', receipt: `native-active:${version}` }
        if (step.stage === 'reconnect' && !matched(version)) return { status: 'unknown', reason: 'The desktop changed after verification; recover the approved native release' }
        if (step.stage === 'reconnect') return await effects.ready?.() ? { status: 'complete', receipt: `desktop-ready:${version}` } : { status: 'waiting', reason: 'Waiting for the updated desktop and required local services to become ready' }
        if (step.stage === 'verify') return { status: 'unknown', reason: `Desktop is running ${this.currentVersion()}, not the approved ${version}` }
        if (effects.prepare && effects.handoff) return { status: 'ready' }
        return { status: operation.inFlight ? 'unknown' : 'waiting', reason: 'Native handoff has not activated the approved release; retry from the downloaded release or repair the native installation' }
      },
      execute: async (step, proposal) => {
        if (step.stage === 'prepare') { await effects.prepare!(); return { status: 'complete', receipt: `services-stopped:${proposal.fingerprint}` } }
        await effects.handoff!()
        return { status: 'waiting', reason: 'Native installer owns activation; resume after desktop restart' }
      },
    }
  }
}
