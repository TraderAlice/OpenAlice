import { describe, expect, it, vi } from 'vitest'

import type { ProvenanceQuery, ProvenanceRecord } from '../core/provenance-store.js'
import type { WorkspaceToolContext } from '../core/workspace-tool-center.js'
import { provenanceShowFactory } from './provenance-show.js'

function run(tool: { execute?: unknown }, args: unknown): Promise<unknown> {
  return (tool.execute as (a: unknown, o: unknown) => Promise<unknown>)(args, {})
}

function context(): WorkspaceToolContext {
  return {
    workspaceId: 'ws-self',
    workspaceLabel: 'self',
    inboxStore: {} as never,
    entityStore: {} as never,
    provenanceStore: {
      append: vi.fn() as never,
      latest: vi.fn() as never,
      list: vi.fn((query: ProvenanceQuery = {}): ProvenanceRecord[] => [{
        id: 'p-1',
        artifact: query.artifact ?? { kind: 'inbox', inboxEntryId: 'i-1' },
        action: query.action ?? 'decided',
        origin: {
          kind: 'session' as const, workspaceId: 'ws-self', resumeId: query.resumeId ?? 'resume-1', agent: 'codex',
        },
        at: 10,
        fingerprint: 'private-dedupe-key',
      }]),
    },
  }
}

describe('provenance_show', () => {
  it('queries a trade decision by UTA commit hash and strips the fingerprint', async () => {
    const result = await run(provenanceShowFactory.build(context()), {
      kind: 'trade-decision', accountId: 'alpaca-paper', decisionId: 'abc123', limit: 10,
    }) as { ok: boolean; records: Array<Record<string, unknown>> }

    expect(result.ok).toBe(true)
    expect(result.records[0]).toMatchObject({
      artifact: { kind: 'trade-decision', accountId: 'alpaca-paper', decisionId: 'abc123' },
      origin: { resumeId: 'resume-1' },
    })
    expect(result.records[0]).not.toHaveProperty('fingerprint')
  })

  it('defaults Issue/report workspace identity to the caller', async () => {
    const result = await run(provenanceShowFactory.build(context()), {
      kind: 'issue', issueId: 'audit', limit: 100,
    }) as { records: Array<{ artifact: unknown }> }
    expect(result.records[0].artifact).toEqual({ kind: 'issue', workspaceId: 'ws-self', issueId: 'audit' })
  })

  it('supports reverse lookup by product Session', async () => {
    const result = await run(provenanceShowFactory.build(context()), {
      resumeId: 'resume-exact', action: 'created', limit: 5,
    }) as { records: Array<{ origin: { resumeId: string }; action: string }> }
    expect(result.records[0]).toMatchObject({ action: 'created', origin: { resumeId: 'resume-exact' } })
  })

  it('rejects incomplete artifact keys without touching the store', async () => {
    const ctx = context()
    const result = await run(provenanceShowFactory.build(ctx), {
      kind: 'trade-decision', accountId: 'alpaca-paper', limit: 100,
    }) as { ok: boolean; error: string }
    expect(result).toEqual({ ok: false, error: 'kind trade-decision requires accountId and decisionId' })
    expect(ctx.provenanceStore?.list).not.toHaveBeenCalled()
  })
})
