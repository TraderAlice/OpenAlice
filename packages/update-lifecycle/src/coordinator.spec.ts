import { describe, expect, it, vi } from 'vitest'
import { approveUpdate, createUpdatePlan, projectUpdateUnit, transitionUpdate, UpdateCoordinator, type UpdateOperation, type UpdateProposal, type UpdateOwner } from './index.js'

function proposal(id = 'backend', after: string[] = []): UpdateProposal {
  return { unit: projectUpdateUnit(id, id, 'fixture', { version: '0.94.1-beta.2' }, { version: '0.94.1' }), fingerprint: `${id}:exact`, stages: ['apply', 'verify'], after }
}
function memory(op: UpdateOperation) {
  let value = structuredClone(op)
  return { read: async () => structuredClone(value), write: vi.fn(async (next: UpdateOperation) => { value = structuredClone(next) }) }
}
describe('authoritative update planning and receipts', () => {
  it('orders declared dependencies and keeps bundled roles in one installation', () => {
    const backend = proposal(); backend.unit.roles = ['runtime', 'templates']
    const plan = createUpdatePlan('project', [proposal('chat', ['backend']), backend])
    expect(plan.steps.map(s => s.id)).toEqual(['backend:apply', 'backend:verify', 'chat:apply', 'chat:verify'])
    expect(plan.proposals[1]?.unit.installationId).toBe('fixture')
    expect(() => createUpdatePlan('x', [proposal('a', ['b']), proposal('b', ['a'])])).toThrow('cycle')
  })
  it('uses capabilities instead of relative product versions and distinguishes unknown legacy evidence', () => {
    const client = proposal('client'), backend = proposal()
    client.unit.capabilities = { control: 1 }; client.provides = { control: 2 }
    backend.requires = [{ unit: 'client', capability: 'control', version: 2 }]
    expect(createUpdatePlan('x', [backend, client]).steps[0]?.unit).toBe('client')
    client.stages = []
    expect(createUpdatePlan('x', [backend, client]).blockers[0]).toContain('incompatible')
    client.unit.capabilities = null
    expect(createUpdatePlan('x', [backend, client]).blockers[0]).toContain('unknown')
    backend.requires = []; client.unit.active = { version: '0.93.0' }
    expect(createUpdatePlan('x', [backend, client]).blockers).toEqual([])
  })
  it('freezes review evidence and rejects changed approvals or counterfeit completion', () => {
    const p = proposal(), plan = createUpdatePlan('x', [p])
    const op = approveUpdate(plan, plan.fingerprint, 'id', 't')
    p.unit.desired!.version = '0.95.0'; plan.proposals[0]!.unit.desired!.version = '0.96.0'
    expect(op.plan.proposals[0]!.unit.desired!.version).toBe('0.94.1')
    expect(() => approveUpdate(plan, 'stale', 'id', 't')).toThrow('changed')
    const started = transitionUpdate(op, { type: 'start', step: 'backend:apply' }, 't')
    expect(() => transitionUpdate(started, { type: 'complete', step: 'backend:apply', receipt: 'ok', fingerprint: 'wrong-target' }, 't')).toThrow('receipt')
  })
  it('journals before mutation and reconciles a lost response without replaying install', async () => {
    const plan = createUpdatePlan('x', [proposal()])
    const journal = memory(approveUpdate(plan, plan.fingerprint, 'id', 't'))
    let installed = false
    const execute = vi.fn(async () => { expect((await journal.read()).inFlight).toBe('backend:apply'); installed = true; throw new Error('lost response') })
    const owner: UpdateOwner = { reconcile: async () => installed ? { status: 'complete', receipt: 'installed:exact' } : { status: 'ready' }, execute }
    expect((await new UpdateCoordinator(journal, owner).run()).phase).toBe('failed')
    expect((await new UpdateCoordinator(journal, owner).run()).phase).toBe('succeeded')
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('preserves backend completion while a busy Workspace waits', async () => {
    const plan = createUpdatePlan('x', [proposal(), proposal('chat', ['backend'])])
    const journal = memory(approveUpdate(plan, plan.fingerprint, 'id', 't'))
    let busy = true
    const execute = vi.fn(async () => ({ status: 'complete' as const, receipt: 'owner-commit' }))
    const owner: UpdateOwner = { reconcile: async step => step.unit === 'chat' && busy ? { status: 'blocked', reason: 'active session' } : { status: 'ready' }, execute }
    const blocked = await new UpdateCoordinator(journal, owner).run()
    expect(blocked.phase).toBe('blocked'); expect(Object.keys(blocked.completed)).toHaveLength(2)
    busy = false
    expect((await new UpdateCoordinator(journal, owner).run()).phase).toBe('succeeded')
    expect(execute.mock.calls).toHaveLength(4)
  })
  it('requires positive owner evidence after an unknown outcome, never blindly retries', async () => {
    const plan = createUpdatePlan('x', [proposal()])
    const journal = memory(approveUpdate(plan, plan.fingerprint, 'id', 't'))
    let status: 'unknown' | 'ready' | 'complete' = 'unknown'
    const execute = vi.fn()
    const owner: UpdateOwner = { reconcile: async () => status === 'unknown' ? { status, reason: 'migration failed' } : status === 'complete' ? { status, receipt: 'recovered' } : { status }, execute }
    expect((await new UpdateCoordinator(journal, owner).run()).phase).toBe('recovery')
    status = 'ready'
    expect((await new UpdateCoordinator(journal, owner).run()).phase).toBe('recovery')
    expect(execute).not.toHaveBeenCalled()
    status = 'complete'
    expect((await new UpdateCoordinator(journal, owner).run()).phase).toBe('succeeded')
  })
})
