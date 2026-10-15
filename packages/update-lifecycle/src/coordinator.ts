import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

/** Update-only planning and receipts. Effects, trust and file-level approvals
 * belong to the installation/project owners, never the renderer. */
export type UpdateStage = 'prepare' | 'apply' | 'activate' | 'verify' | 'reconnect'
export interface UpdateIdentity {
  version: string
  revision?: string
  channel?: string | null
  commit?: string
  artifactSha256?: string
  contentIdentity?: string
  platform?: string
  arch?: string
}
export interface UpdateUnit {
  id: string
  installationId: string
  projectId?: string
  roles: string[]
  owner: string
  location: string
  installed: UpdateIdentity | null
  active: UpdateIdentity | null
  desired: UpdateIdentity | null
  source: string
  policyScope: 'client' | 'machine' | 'project' | 'pack'
  capabilities: Record<string, number> | null
  operations: string[]
}
export interface UpdateProposal {
  unit: UpdateUnit
  /** Owner-issued exact artifact / managed-file preview digest. */
  fingerprint: string
  reference?: Record<string, string>
  stages: UpdateStage[]
  after?: string[]
  requires?: { unit: string; capability: string; version: number }[]
  provides?: Record<string, number>
  blockers?: string[]
}
export interface UpdateStep {
  id: string
  unit: string
  stage: UpdateStage
  after: string[]
}
export interface UpdatePlan {
  schemaVersion: 1
  scope: string
  proposals: UpdateProposal[]
  steps: UpdateStep[]
  blockers: string[]
  fingerprint: string
}
/** Canonical representation for a fixed-size SHA-256 review digest.
 * It deliberately includes evidence and scope, not publication timestamps. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
export function updateFingerprint(value: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonical(value))))
}
export function createUpdatePlan(scope: string, input: readonly UpdateProposal[]): UpdatePlan {
  const proposals = structuredClone([...input])
  const byId = new Map(proposals.map(p => [p.unit.id, p]))
  if (!scope || byId.size !== proposals.length) throw new Error('Update scopes and unit identities must be unique')
  const blockers: string[] = []
  const dependencies = new Map<string, Set<string>>()
  for (const p of proposals) {
    if (!p.fingerprint || !p.unit.desired || new Set(p.stages).size !== p.stages.length) throw new Error('An update requires an exact target and distinct stages')
    blockers.push(...(p.blockers ?? []))
    const deps = new Set(p.after ?? [])
    for (const r of p.requires ?? []) {
      const provider = byId.get(r.unit)
      const current = provider?.unit.capabilities?.[r.capability]
      if (current === r.version) continue
      if (provider?.provides?.[r.capability] === r.version && provider.stages.length) deps.add(r.unit)
      else blockers.push(`${p.unit.id}: ${r.unit} capability ${r.capability}@${r.version} is ${current === undefined ? 'unknown' : 'incompatible'}`)
    }
    for (const d of deps) if (!byId.has(d)) blockers.push(`${p.unit.id}: missing prerequisite ${d}`)
    dependencies.set(p.unit.id, deps)
  }
  const ordered: UpdateProposal[] = []
  const visiting = new Set<string>(), visited = new Set<string>()
  function visit(p: UpdateProposal) {
    if (visited.has(p.unit.id)) return
    if (visiting.has(p.unit.id)) throw new Error('Update dependencies contain a cycle')
    visiting.add(p.unit.id)
    for (const id of dependencies.get(p.unit.id)!) { const dep = byId.get(id); if (dep) visit(dep) }
    visiting.delete(p.unit.id); visited.add(p.unit.id); ordered.push(p)
  }
  for (const p of proposals) visit(p)
  const steps: UpdateStep[] = []
  const last = new Map<string, string>()
  for (const p of ordered) {
    let after = [...dependencies.get(p.unit.id)!].map(id => last.get(id)).filter((id): id is string => Boolean(id))
    for (const stage of p.stages) {
      const id = `${p.unit.id}:${stage}`
      steps.push({ id, unit: p.unit.id, stage, after }); after = [id]; last.set(p.unit.id, id)
    }
  }
  const body = { schemaVersion: 1 as const, scope, proposals, steps, blockers }
  return { ...body, fingerprint: updateFingerprint(body) }
}
export type UpdatePhase = 'approved' | 'running' | 'waiting' | 'blocked' | 'failed' | 'recovery' | 'succeeded'
export interface UpdateOperation {
  schemaVersion: 1
  id: string
  plan: UpdatePlan
  phase: UpdatePhase
  completed: Record<string, { receipt: string; at: string }>
  inFlight: string | null
  error: string | null
  events: { step: string | null; phase: UpdatePhase; at: string; message?: string }[]
}
export function approveUpdate(plan: UpdatePlan, currentFingerprint: string, id: string, at: string): UpdateOperation {
  if (plan.fingerprint !== currentFingerprint) throw new Error('Update evidence changed; review a new plan')
  if (plan.blockers.length) throw new Error(plan.blockers.join('; '))
  return { schemaVersion: 1, id, plan: structuredClone(plan), phase: plan.steps.length ? 'approved' : 'succeeded', completed: {}, inFlight: null, error: null,
    events: [{ step: null, phase: 'approved', at }] }
}
export function nextUpdateStep(op: UpdateOperation): UpdateStep | null {
  return op.plan.steps.find(s => !op.completed[s.id] && s.after.every(id => op.completed[id])) ?? null
}
export type UpdateEvent =
  | { type: 'start'; step: string }
  | { type: 'complete'; step: string; receipt: string; fingerprint: string }
  | { type: 'wait' | 'block' | 'fail' | 'recover'; message: string }
  | { type: 'resume' }
export function transitionUpdate(op: UpdateOperation, event: UpdateEvent, at: string): UpdateOperation {
  if (op.phase === 'succeeded') throw new Error('The update is already complete')
  let next = { ...op, completed: { ...op.completed } }
  if (event.type === 'start') {
    if (!['approved', 'running'].includes(op.phase) || nextUpdateStep(op)?.id !== event.step || (op.inFlight && op.inFlight !== event.step)) throw new Error('Update stage is not ready')
    next = { ...next, phase: 'running', inFlight: event.step, error: null }
  } else if (event.type === 'complete') {
    const step = op.plan.steps.find(s => s.id === event.step)
    const proposal = op.plan.proposals.find(p => p.unit.id === step?.unit)
    if (op.phase !== 'running' || op.inFlight !== event.step || !event.receipt || proposal?.fingerprint !== event.fingerprint) throw new Error('Owner receipt does not match the approved stage')
    next.completed[event.step] = { receipt: event.receipt, at }
    next = { ...next, inFlight: null, phase: Object.keys(next.completed).length === op.plan.steps.length ? 'succeeded' : 'running', error: null }
  } else if (event.type === 'resume') {
    if (op.phase === 'recovery') throw new Error('Unknown outcome requires owner reconciliation before retry')
    next = { ...next, phase: 'running', error: null }
  } else {
    const phase = { wait: 'waiting', block: 'blocked', fail: 'failed', recover: 'recovery' }[event.type] as UpdatePhase
    next = { ...next, phase, error: event.message }
  }
  return { ...next, events: [...op.events, { step: next.inFlight ?? ('step' in event ? event.step : null), phase: next.phase, at, ...('message' in event ? { message: event.message } : {}) }] }
}
export interface UpdateJournal {
  read(): Promise<UpdateOperation | null>
  write(operation: UpdateOperation): Promise<void>
}
export type OwnerEvidence = { status: 'complete'; receipt: string } | { status: 'ready' } | { status: 'blocked' | 'unknown' | 'waiting'; reason: string }
export interface UpdateOwner {
  /** Reconcile native/project receipts before replaying an interrupted effect. */
  reconcile(step: UpdateStep, proposal: UpdateProposal, operation: UpdateOperation): Promise<OwnerEvidence>
  execute(step: UpdateStep, proposal: UpdateProposal, operation: UpdateOperation): Promise<OwnerEvidence>
}
/** A host owns this runner and supplies durable storage/serialization. Rehearsal
 * uses the very same runner with a memory journal and fake owner effects. */
export class UpdateCoordinator {
  constructor(private readonly journal: UpdateJournal, private readonly owner: UpdateOwner, private readonly now = () => new Date().toISOString()) {}
  async run(maxSteps = Infinity): Promise<UpdateOperation> {
    let op = await this.journal.read()
    if (!op) throw new Error('No approved update')
    if (op.phase === 'succeeded') return op
    const save = async (value: UpdateOperation) => { await this.journal.write(value); op = value }
    // A crashed owner may have completed its last effect without returning.
    if (op.phase !== 'recovery') await save(transitionUpdate(op, { type: 'resume' }, this.now()))
    let count = 0
    while (count++ < maxSteps && (op as UpdateOperation).phase !== 'succeeded') {
      const step = nextUpdateStep(op)
      if (!step) throw new Error('Update dependency receipts are incomplete')
      const proposal = op.plan.proposals.find(p => p.unit.id === step.unit)!
      try {
        let evidence = await this.owner.reconcile(step, proposal, op)
        if (evidence.status === 'ready' && op.phase === 'recovery') break
        if (evidence.status === 'complete' && op.phase === 'recovery') await save({ ...op, phase: 'running', error: null })
        if (evidence.status === 'ready' || evidence.status === 'complete') {
          await save(transitionUpdate(op, { type: 'start', step: step.id }, this.now()))
          if (evidence.status === 'ready') evidence = await this.owner.execute(step, proposal, op)
        }
        if (evidence.status === 'complete') await save(transitionUpdate(op, { type: 'complete', step: step.id, receipt: evidence.receipt, fingerprint: proposal.fingerprint }, this.now()))
        else {
          const type = evidence.status === 'blocked' ? 'block' : evidence.status === 'waiting' ? 'wait' : 'recover'
          await save(transitionUpdate(op, { type, message: 'reason' in evidence ? evidence.reason : 'Owner returned no completion evidence' }, this.now()))
          break
        }
      } catch (error) {
        await save(transitionUpdate(op, { type: 'fail', message: error instanceof Error ? error.message : String(error) }, this.now()))
        break
      }
    }
    return op
  }
}
