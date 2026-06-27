import { describe, it, expect } from 'vitest'
import { resolveInboxOrigin } from './inbox-origin.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

function svc(records: Record<string, { taskId: string; issueId?: string; agent: string }>) {
  return { headlessTasks: { get: (id: string) => records[id] ?? null } }
}

describe('resolveInboxOrigin', () => {
  it('builds a headless origin from the authoritative record', () => {
    const origin = resolveInboxOrigin('run-7', () =>
      svc({ 'run-7': { taskId: 'run-7', issueId: 'macro', agent: 'claude' } }) as any,
    )
    expect(origin).toEqual({ kind: 'headless', runId: 'run-7', issueId: 'macro', agent: 'claude' })
  })

  it('omits issueId when the run had none (manual/external dispatch)', () => {
    const origin = resolveInboxOrigin('run-8', () =>
      svc({ 'run-8': { taskId: 'run-8', agent: 'opencode' } }) as any,
    )
    expect(origin).toEqual({ kind: 'headless', runId: 'run-8', agent: 'opencode' })
  })

  it('undefined for a missing/blank header (interactive case)', () => {
    expect(resolveInboxOrigin(undefined, () => svc({}) as any)).toBeUndefined()
    expect(resolveInboxOrigin('   ', () => svc({}) as any)).toBeUndefined()
  })

  it('undefined for an unknown run id (no fabricated link)', () => {
    expect(resolveInboxOrigin('ghost', () => svc({}) as any)).toBeUndefined()
  })

  it('undefined when the workspace service is not up yet', () => {
    expect(resolveInboxOrigin('run-7', () => null)).toBeUndefined()
  })
})
