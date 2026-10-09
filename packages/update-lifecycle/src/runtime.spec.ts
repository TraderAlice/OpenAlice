import { describe, expect, it } from 'vitest'
import { beginRuntimeOperation, planRuntimeUpdate, transitionRuntimeOperation, type RuntimeUpdateInput } from './runtime.js'

const stable = { version: '0.94.1', channel: 'stable' as const, contentIdentity: 'aaaaaaaaaaaaaaaa' }
const beta = { version: '0.94.1-beta.2', channel: 'beta' as const, contentIdentity: 'bbbbbbbbbbbbbbbb' }
const pending: RuntimeUpdateInput = { installed: stable, candidate: beta, active: beta, running: true, canActivate: true }

describe('shared Runtime upgrade planning and receipts', () => {
  it('activates an already installed stable release without reinstalling an older beta client', () => {
    expect(planRuntimeUpdate(pending)).toEqual({ target: stable, selection: 'installed',
      stages: ['activate', 'verify', 'reconnect'], blocker: null })
  })
  it('keeps machine channel policy independent from the client', () => {
    const candidate = { ...beta, version: '0.95.0-beta.1' }
    expect(planRuntimeUpdate({ ...pending, active: stable, candidate }).target).toEqual(stable)
    expect(planRuntimeUpdate({ ...pending, active: stable, candidate, channel: 'beta' }).target).toEqual(candidate)
  })
  it('reuses a verified dev archive when only its manifest carries the commit', () => {
    const installed = { ...stable, channel: 'dev' as const, artifactSha256: 'a'.repeat(64) }
    const candidate = { ...installed, commit: 'b'.repeat(40) }
    const plan = planRuntimeUpdate({ ...pending, installed, candidate, active: stable })
    expect(plan.selection).toBe('installed')
    expect(plan.stages).toEqual(['verify', 'reconnect'])
    expect(plan.target?.commit).toBe(candidate.commit)
  })
  it('never activates an older installed version over a newer running version', () => {
    expect(planRuntimeUpdate({ ...pending, installed: beta, candidate: beta, active: stable }).blocker).toContain('downgrade')
  })
  it('requires safe activation capability only when the running owner must change', () => {
    expect(planRuntimeUpdate({ ...pending, canActivate: false }).blocker).toContain('recorded owner')
    expect(planRuntimeUpdate({ ...pending, active: stable, canActivate: false }).blocker).toBeNull()
    expect(planRuntimeUpdate({ ...pending, active: null, running: false, canActivate: false }).stages).toEqual(['activate', 'verify', 'reconnect'])
  })
  it('retains completed activation across failed verification and rejects unapproved active bytes', () => {
    let receipt = beginRuntimeOperation(planRuntimeUpdate(pending))
    receipt = transitionRuntimeOperation(receipt, { type: 'complete', stage: 'activate' })
    expect(() => transitionRuntimeOperation(receipt, { type: 'complete', stage: 'verify', observed: beta })).toThrow('approved release')
    receipt = transitionRuntimeOperation(receipt, { type: 'fail', error: 'lost transport' })
    receipt = transitionRuntimeOperation(receipt, { type: 'retry' })
    expect(receipt.completed).toEqual(['activate'])
    receipt = transitionRuntimeOperation(receipt, { type: 'complete', stage: 'verify', observed: stable })
    expect(receipt.phase).toBe('running')
    receipt = transitionRuntimeOperation(receipt, { type: 'complete', stage: 'reconnect' })
    expect(receipt.phase).toBe('succeeded')
  })
  it('does not allow stages to be reordered or installation to complete without evidence', () => {
    const receipt = beginRuntimeOperation(planRuntimeUpdate({ ...pending, installed: null, active: null, running: false }))
    expect(() => transitionRuntimeOperation(receipt, { type: 'complete', stage: 'activate' })).toThrow('next approved stage')
    expect(() => transitionRuntimeOperation(receipt, { type: 'complete', stage: 'install' })).toThrow('approved release')
  })
})
