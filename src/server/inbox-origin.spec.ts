import { describe, it, expect } from 'vitest'
import { resolveInboxOrigin } from './inbox-origin.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Build a structural fake service with both authorities. */
function svc(opts: {
  headless?: Record<string, { taskId: string; issueId?: string; agent: string }>
  sessions?: Record<string, Record<string, { id: string; wsId: string; agent: string }>>
} = {}) {
  return {
    headlessTasks: { get: (id: string) => opts.headless?.[id] ?? null },
    sessionRegistry: {
      get: (wsId: string, id: string) => opts.sessions?.[wsId]?.[id],
    },
  }
}

describe('resolveInboxOrigin — headless (Phase 1)', () => {
  it('builds a headless origin from the authoritative record', () => {
    const origin = resolveInboxOrigin({ run: 'run-7' }, () =>
      svc({ headless: { 'run-7': { taskId: 'run-7', issueId: 'macro', agent: 'claude' } } }) as any,
    )
    expect(origin).toEqual({ kind: 'headless', runId: 'run-7', issueId: 'macro', agent: 'claude' })
  })

  it('omits issueId when the run had none (manual/external dispatch)', () => {
    const origin = resolveInboxOrigin({ run: 'run-8' }, () =>
      svc({ headless: { 'run-8': { taskId: 'run-8', agent: 'opencode' } } }) as any,
    )
    expect(origin).toEqual({ kind: 'headless', runId: 'run-8', agent: 'opencode' })
  })

  it('undefined for a missing/blank run header (no session either)', () => {
    expect(resolveInboxOrigin({}, () => svc() as any)).toBeUndefined()
    expect(resolveInboxOrigin({ run: '   ' }, () => svc() as any)).toBeUndefined()
  })

  it('undefined for an unknown run id (no fabricated link)', () => {
    expect(resolveInboxOrigin({ run: 'ghost' }, () => svc() as any)).toBeUndefined()
  })

  it('undefined when the workspace service is not up yet', () => {
    expect(resolveInboxOrigin({ run: 'run-7' }, () => null)).toBeUndefined()
  })
})

describe('resolveInboxOrigin — interactive (Phase 2)', () => {
  it('builds an interactive origin from a valid session header (validated against the registry)', () => {
    const origin = resolveInboxOrigin({ session: 'sess-1', wsId: 'ws1' }, () =>
      svc({ sessions: { ws1: { 'sess-1': { id: 'sess-1', wsId: 'ws1', agent: 'codex' } } } }) as any,
    )
    expect(origin).toEqual({ kind: 'interactive', sessionId: 'sess-1', agent: 'codex' })
  })

  it('undefined for an unknown/forged session id (no fabricated link)', () => {
    expect(
      resolveInboxOrigin({ session: 'forged', wsId: 'ws1' }, () =>
        svc({ sessions: { ws1: { 'sess-1': { id: 'sess-1', wsId: 'ws1', agent: 'codex' } } } }) as any,
      ),
    ).toBeUndefined()
  })

  it('undefined when the session belongs to a different workspace (wsId-scoped lookup)', () => {
    // The id exists, but not under the route's wsId — the authority is scoped.
    expect(
      resolveInboxOrigin({ session: 'sess-1', wsId: 'ws2' }, () =>
        svc({ sessions: { ws1: { 'sess-1': { id: 'sess-1', wsId: 'ws1', agent: 'codex' } } } }) as any,
      ),
    ).toBeUndefined()
  })

  it('undefined when the session header is present but wsId is missing', () => {
    expect(
      resolveInboxOrigin({ session: 'sess-1' }, () =>
        svc({ sessions: { ws1: { 'sess-1': { id: 'sess-1', wsId: 'ws1', agent: 'codex' } } } }) as any,
      ),
    ).toBeUndefined()
  })

  it('undefined when the workspace service is not up yet', () => {
    expect(resolveInboxOrigin({ session: 'sess-1', wsId: 'ws1' }, () => null)).toBeUndefined()
  })
})

describe('resolveInboxOrigin — precedence + both-absent', () => {
  it('a resolvable run header wins over a present session header', () => {
    const origin = resolveInboxOrigin({ run: 'run-7', session: 'sess-1', wsId: 'ws1' }, () =>
      svc({
        headless: { 'run-7': { taskId: 'run-7', issueId: 'macro', agent: 'claude' } },
        sessions: { ws1: { 'sess-1': { id: 'sess-1', wsId: 'ws1', agent: 'codex' } } },
      }) as any,
    )
    expect(origin).toEqual({ kind: 'headless', runId: 'run-7', issueId: 'macro', agent: 'claude' })
  })

  it('falls through to the session header when the run id is unknown', () => {
    const origin = resolveInboxOrigin({ run: 'ghost', session: 'sess-1', wsId: 'ws1' }, () =>
      svc({ sessions: { ws1: { 'sess-1': { id: 'sess-1', wsId: 'ws1', agent: 'codex' } } } }) as any,
    )
    expect(origin).toEqual({ kind: 'interactive', sessionId: 'sess-1', agent: 'codex' })
  })

  it('undefined when both headers are absent (manual case)', () => {
    expect(resolveInboxOrigin({ wsId: 'ws1' }, () => svc() as any)).toBeUndefined()
  })
})
