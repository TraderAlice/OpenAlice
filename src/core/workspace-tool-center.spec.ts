import { describe, it, expect } from 'vitest'
import type { InboxEntry } from './inbox-store.js'
import {
  makeInboxEntryOriginResolver,
  makeWorkspaceResolver,
  toSafeInboxOrigin,
} from './workspace-tool-center.js'

type Meta = { id: string; dir: string; tag: string }

function svc(map: Record<string, Meta>) {
  return { registry: { get: (id: string): Meta | undefined => map[id] } }
}

describe('makeWorkspaceResolver', () => {
  it('resolves a known id to {id, dir, tag}', () => {
    const resolve = makeWorkspaceResolver(() =>
      svc({ ws2: { id: 'ws2', dir: '/wsroot/ws2', tag: 'Quant Lab' } }),
    )
    expect(resolve('ws2')).toEqual({ id: 'ws2', dir: '/wsroot/ws2', tag: 'Quant Lab' })
  })

  it('returns null for an unknown id', () => {
    const resolve = makeWorkspaceResolver(() => svc({}))
    expect(resolve('ghost')).toBeNull()
  })

  it('returns null when the service is not up yet', () => {
    const resolve = makeWorkspaceResolver(() => null)
    expect(resolve('ws2')).toBeNull()
  })

  it('is lazy — a peer registered AFTER the resolver is built still resolves', () => {
    const map: Record<string, Meta> = {}
    const resolve = makeWorkspaceResolver(() => svc(map))
    expect(resolve('ws9')).toBeNull()
    map['ws9'] = { id: 'ws9', dir: '/wsroot/ws9', tag: 'Late' }
    expect(resolve('ws9')).toEqual({ id: 'ws9', dir: '/wsroot/ws9', tag: 'Late' })
  })
})

describe('makeInboxEntryOriginResolver', () => {
  const entry = (origin: InboxEntry['origin']): InboxEntry => ({
    id: 'inbox-1',
    ts: 1,
    workspaceId: 'ws2',
    comments: 'hello',
    ...(origin ? { origin } : {}),
  })

  it('backfills a headless resumeId from the durable run registry', () => {
    const resolve = makeInboxEntryOriginResolver(() => ({
      headlessTasks: {
        get: (id) => id === 'run-1' ? { resumeId: 'resume-run-1' } : null,
      },
      sessionRegistry: { get: () => undefined },
    }))

    expect(resolve(entry({ kind: 'headless', runId: 'run-1', agent: 'pi' })))
      .toEqual({
        kind: 'headless',
        runId: 'run-1',
        resumeId: 'resume-run-1',
        agent: 'pi',
      })
  })

  it('backfills an interactive resumeId from the workspace session registry', () => {
    const resolve = makeInboxEntryOriginResolver(() => ({
      headlessTasks: { get: () => null },
      sessionRegistry: {
        get: (wsId, id) => wsId === 'ws2' && id === 'session-1'
          ? { resumeId: 'resume-session-1' }
          : undefined,
      },
    }))

    expect(resolve(entry({ kind: 'interactive', sessionId: 'session-1' })))
      .toEqual({
        kind: 'interactive',
        sessionId: 'session-1',
        resumeId: 'resume-session-1',
      })
  })

  it('preserves stored provenance when it is already complete or unresolvable', () => {
    const resolve = makeInboxEntryOriginResolver(() => null)
    const complete = { kind: 'headless' as const, runId: 'run-1', resumeId: 'resume-1' }

    expect(resolve(entry(complete))).toEqual(complete)
    expect(resolve(entry({ kind: 'manual' }))).toEqual({ kind: 'manual' })
    expect(resolve(entry(undefined))).toBeUndefined()
  })

  it('whitelists public fields from legacy append-only origin objects', () => {
    const dirty = {
      kind: 'headless' as const,
      runId: 'run-1',
      resumeId: 'resume-1',
      agent: 'pi',
      agentSessionId: 'native-secret',
      arbitrary: true,
    } as InboxEntry['origin']

    expect(toSafeInboxOrigin(dirty)).toEqual({
      kind: 'headless',
      runId: 'run-1',
      resumeId: 'resume-1',
      agent: 'pi',
    })
  })
})
