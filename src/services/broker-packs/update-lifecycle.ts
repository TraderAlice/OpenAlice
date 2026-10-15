import { createUpdatePlan, projectUpdateUnit, type UpdatePlan, type UpdateOperation } from '@traderalice/update-lifecycle'
import { FileUpdateJournal } from '@traderalice/update-lifecycle/node'
import { brokerPackEngineRoot, resolveActiveBrokerPack, type InstallableBrokerEngine } from '../../core/broker-packs.js'
import { join } from 'node:path'
import { installBrokerPack, planBrokerPack, getBrokerPackLocalStatus } from './installer.js'
import { isUTADisabled, resolveUTAUrl } from '../uta-supervisor/url.js'
import { triggerUTARestart } from '../uta-supervisor/restart-trigger.js'

export async function planBrokerPackUpdate(engine: InstallableBrokerEngine): Promise<UpdatePlan> {
  const [asset, installed] = await Promise.all([planBrokerPack(engine), getBrokerPackLocalStatus(engine)])
  const unit = projectUpdateUnit(`pack:${engine}`, 'broker-pack', brokerPackEngineRoot(engine), installed.version ? { version: installed.version } : null, { version: asset.version, artifactSha256: asset.sha256 })
  return createUpdatePlan(unit.id, [{ unit, fingerprint: asset.sha256, stages: ['apply', 'activate', 'verify'] }])
}
export function brokerPackUpdateJournal(engine: InstallableBrokerEngine): FileUpdateJournal {
  return new FileUpdateJournal(join(brokerPackEngineRoot(engine), 'lifecycle'), `pack:${engine}`)
}
export async function applyBrokerPackUpdate(engine: InstallableBrokerEngine, approved?: UpdatePlan): Promise<UpdateOperation> {
  const journal = brokerPackUpdateJournal(engine)
  let op = await journal.read()
  if (!op || op.phase === 'succeeded') {
    const plan = approved ?? await planBrokerPackUpdate(engine)
    await journal.approve(plan, plan.fingerprint)
  } else if (approved && op.plan.proposals[0]!.fingerprint !== approved.proposals[0]!.fingerprint) throw new Error('Resume the pending Broker Pack target first')
  const loaded = async (version: string, contentId: string): Promise<boolean> => {
    if (isUTADisabled()) return false
    try {
      const response = await fetch(`${resolveUTAUrl()}/__uta/broker-packs/${engine}`, { signal: AbortSignal.timeout(5000) })
      const body = await response.json() as { identity?: { version: string; contentId: string } }
      return response.ok && body.identity?.version === version && body.identity.contentId === contentId
    } catch { return false }
  }
  return journal.run({
    reconcile: async (step, p, operation) => {
      const target = p.unit.desired!, content = p.fingerprint.slice(0, 16)
      const installed = await resolveActiveBrokerPack(engine).catch(() => null)
      if (step.stage === 'apply') return installed?.manifest.version === target.version && installed.manifest.contentId === content
        ? { status: 'complete', receipt: p.fingerprint } : { status: 'ready' }
      if (await loaded(target.version, content)) return { status: 'complete', receipt: `uta-loaded:${p.fingerprint}` }
      if (isUTADisabled()) return { status: 'waiting', reason: 'Pack installed; UTA is optional and currently disabled. Chat remains available.' }
      if (step.stage === 'verify') return { status: 'unknown', reason: 'UTA has not loaded the approved Pack; inspect its module error before retry' }
      return operation.inFlight === step.id ? { status: 'unknown', reason: 'UTA restart outcome is unknown; check its health before another restart' } : { status: 'ready' }
    },
    execute: async (step, p) => {
      if (step.stage === 'apply') { await installBrokerPack(engine, p.fingerprint); return { status: 'complete', receipt: p.fingerprint } }
      const result = await triggerUTARestart()
      return result.ready ? { status: 'complete', receipt: `uta:${result.newStartedAt}` } : { status: 'waiting', reason: result.error ?? 'Waiting for UTA restart' }
    },
  })
}
