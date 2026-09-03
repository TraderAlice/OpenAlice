import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  RoutineFollowUpCreateDisallowedError,
  RoutineFollowUpConflictError,
  RoutineFollowUpDecisionConflictError,
  RoutineFollowUpDecisionMissingError,
  RoutineFollowUpStaleObservationError,
  RoutineFollowUpStore,
  RoutineFollowUpUnavailableError,
  type RoutineFollowUpInput,
} from './routine-follow-up-store.js'

const input = (inboxEntryId: string, overrides: Partial<RoutineFollowUpInput> = {}): RoutineFollowUpInput => ({
  inboxEntryId,
  reportTs: 1_700_000_000_000,
  issueWorkspaceId: 'research-desk',
  issueId: 'weekly-review',
  ...overrides,
})

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'openalice-routine-follow-up-'))
  const path = join(dir, 'nested', 'routine-follow-ups.json')
  return { dir, path }
}

describe('RoutineFollowUpStore', () => {
  it('treats a missing file as an empty queue and receipt ledger', async () => {
    const { path } = await fixture()
    const store = await RoutineFollowUpStore.load(path)

    expect(store.list()).toEqual([])
    expect(store.listDecisions()).toEqual([])
    expect(store.get('missing')).toBeNull()
  })

  it.each([
    ['invalid JSON', '{'],
    ['old version', JSON.stringify({ version: 1, active: [] })],
    ['missing decisions', JSON.stringify({ version: 2, active: [] })],
    ['unknown file field', JSON.stringify({ version: 2, active: [], decisions: [], extra: true })],
    ['unknown active field', JSON.stringify({
      version: 2,
      active: [{ ...input('report-1'), createdAt: 100, extra: true }],
      decisions: [],
    })],
    ['duplicate active record', JSON.stringify({
      version: 2,
      active: [
        { ...input('report-1'), createdAt: 100 },
        { ...input('report-1'), createdAt: 200 },
      ],
      decisions: [],
    })],
    ['duplicate decision receipt', JSON.stringify({
      version: 2,
      active: [],
      decisions: [
        { ...input('report-1'), createdAt: 100, outcome: 'maintain-plan', decidedAt: 200 },
        { ...input('report-1'), createdAt: 100, outcome: 'maintain-plan', decidedAt: 200 },
      ],
    })],
    ['active receipt overlap', JSON.stringify({
      version: 2,
      active: [{ ...input('report-1'), createdAt: 100 }],
      decisions: [{
        ...input('report-1'),
        createdAt: 100,
        outcome: 'maintain-plan',
        decidedAt: 200,
      }],
    })],
    ['untrimmed stored note', JSON.stringify({
      version: 2,
      active: [],
      decisions: [{
        ...input('report-1'),
        createdAt: 100,
        outcome: 'revise-plan',
        note: ' trim me ',
        decidedAt: 200,
      }],
    })],
    ['unordered decisions', JSON.stringify({
      version: 2,
      active: [],
      decisions: [
        { ...input('report-2'), createdAt: 100, outcome: 'maintain-plan', decidedAt: 300 },
        { ...input('report-1'), createdAt: 100, outcome: 'maintain-plan', decidedAt: 200 },
      ],
    })],
  ])('throws instead of silently replacing malformed state: %s', async (_label, body) => {
    const { dir, path } = await fixture()
    await mkdir(join(dir, 'nested'), { recursive: true })
    await writeFile(path, body, 'utf8')

    await expect(RoutineFollowUpStore.load(path)).rejects.toThrow()
  })

  it('contains malformed state as an unavailable Office queue without overwriting it', async () => {
    const { dir, path } = await fixture()
    await mkdir(join(dir, 'nested'), { recursive: true })
    await writeFile(path, '{ malformed', 'utf8')

    const store = await RoutineFollowUpStore.loadOrUnavailable(path)

    expect(store.available).toBe(false)
    expect(store.loadError).toBeInstanceOf(Error)
    expect(() => store.list()).toThrow(RoutineFollowUpUnavailableError)
    expect(() => store.listDecisions()).toThrow(RoutineFollowUpUnavailableError)
    expect(() => store.get('report-1')).toThrow(RoutineFollowUpUnavailableError)
    await expect(store.put(input('report-1'), {
      allowCreate: true,
      observedRevision: 0,
      createdAt: 100,
    })).rejects.toBeInstanceOf(RoutineFollowUpUnavailableError)
    await expect(store.decide('report-1', {
      outcome: 'maintain-plan',
    }, { observedRevision: 0 })).rejects.toBeInstanceOf(RoutineFollowUpUnavailableError)
    expect(await readFile(path, 'utf8')).toBe('{ malformed')
  })

  it('persists a strict version-2 file through atomic tmp + rename', async () => {
    const { dir, path } = await fixture()
    const store = await RoutineFollowUpStore.load(path)

    await expect(store.put(input('report-1'), {
      allowCreate: true,
      observedRevision: 0,
      createdAt: 1234,
    })).resolves.toEqual({
      created: true,
      followUp: { ...input('report-1'), createdAt: 1234 },
    })

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      version: 2,
      active: [{ ...input('report-1'), createdAt: 1234 }],
      decisions: [],
    })
    expect(await readdir(join(dir, 'nested'))).toEqual(['routine-follow-ups.json'])
  })

  it('makes identical puts idempotent and preserves the first createdAt', async () => {
    const { path } = await fixture()
    const store = await RoutineFollowUpStore.load(path)
    await store.put(input('report-1'), { allowCreate: true, observedRevision: 0, createdAt: 100 })

    await expect(store.put(input('report-1'), {
      allowCreate: false,
      observedRevision: store.observe('report-1').revision,
      createdAt: 999,
    })).resolves.toEqual({
      created: false,
      followUp: { ...input('report-1'), createdAt: 100 },
    })
    expect((await RoutineFollowUpStore.load(path)).list()).toEqual([
      { ...input('report-1'), createdAt: 100 },
    ])
  })

  it('rejects a fresh record when authoritative state disallows creation', async () => {
    const { path } = await fixture()
    const store = await RoutineFollowUpStore.load(path)
    const observation = store.observe('report-1')

    await expect(store.put(input('report-1'), {
      allowCreate: false,
      observedRevision: observation.revision,
      createdAt: 100,
    })).rejects.toBeInstanceOf(RoutineFollowUpCreateDisallowedError)
    expect(store.list()).toEqual([])
  })

  it('rejects a conflicting authority without replacing the durable record', async () => {
    const { path } = await fixture()
    const store = await RoutineFollowUpStore.load(path)
    await store.put(input('report-1'), { allowCreate: true, observedRevision: 0, createdAt: 100 })

    await expect(store.put(input('report-1', { issueId: 'daily-review' }), {
      allowCreate: false,
      observedRevision: store.observe('report-1').revision,
      createdAt: 200,
    })).rejects.toBeInstanceOf(RoutineFollowUpConflictError)
    expect((await RoutineFollowUpStore.load(path)).list()).toEqual([
      { ...input('report-1'), createdAt: 100 },
    ])
  })

  it('atomically moves exact authority into a canonical revise-plan receipt', async () => {
    const { path } = await fixture()
    const store = await RoutineFollowUpStore.load(path)
    await store.put(input('report-1'), { allowCreate: true, observedRevision: 0, createdAt: 100 })
    await store.put(input('report-2'), { allowCreate: true, observedRevision: 0, createdAt: 110 })

    await expect(store.decide('report-1', {
      outcome: 'revise-plan',
      note: '  Raise the review threshold.  ',
    }, { observedRevision: store.observe('report-1').revision, decidedAt: 200 })).resolves.toEqual({
      created: true,
      decision: {
        ...input('report-1'),
        createdAt: 100,
        outcome: 'revise-plan',
        note: 'Raise the review threshold.',
        decidedAt: 200,
      },
    })

    expect(store.list()).toEqual([{ ...input('report-2'), createdAt: 110 }])
    expect(store.listDecisions()).toEqual([{
      ...input('report-1'),
      createdAt: 100,
      outcome: 'revise-plan',
      note: 'Raise the review threshold.',
      decidedAt: 200,
    }])
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      version: 2,
      active: [{ ...input('report-2'), createdAt: 110 }],
      decisions: [{
        ...input('report-1'),
        createdAt: 100,
        outcome: 'revise-plan',
        note: 'Raise the review threshold.',
        decidedAt: 200,
      }],
    })
  })

  it.each([
    ['maintain-plan note', { outcome: 'maintain-plan', note: 'not allowed' }],
    ['evidence-unavailable note', { outcome: 'evidence-unavailable', note: 'not allowed' }],
    ['blank revise-plan note', { outcome: 'revise-plan', note: '   ' }],
    ['oversized revise-plan note', { outcome: 'revise-plan', note: 'x'.repeat(281) }],
    ['unknown outcome', { outcome: 'trade-now' }],
  ])('strictly rejects an invalid decision input: %s', async (_label, decision) => {
    const { path } = await fixture()
    const store = await RoutineFollowUpStore.load(path)
    await store.put(input('report-1'), { allowCreate: true, observedRevision: 0, createdAt: 100 })

    await expect(store.decide('report-1', decision as never, {
      observedRevision: store.observe('report-1').revision,
      decidedAt: 200,
    })).rejects.toThrow()
    expect(store.list()).toEqual([{ ...input('report-1'), createdAt: 100 }])
    expect(store.listDecisions()).toEqual([])
  })

  it('makes an identical decision idempotent and preserves the first decidedAt', async () => {
    const { path } = await fixture()
    const store = await RoutineFollowUpStore.load(path)
    await store.put(input('report-1'), { allowCreate: true, observedRevision: 0, createdAt: 100 })

    const first = await store.decide('report-1', { outcome: 'maintain-plan' }, {
      observedRevision: store.observe('report-1').revision,
      decidedAt: 200,
    })
    await expect(store.decide(
      'report-1',
      { outcome: 'maintain-plan' },
      { observedRevision: store.observe('report-1').revision, decidedAt: 999 },
    )).resolves.toEqual({ decision: first.decision, created: false })
    expect(store.listDecisions()).toEqual([first.decision])
    expect((await RoutineFollowUpStore.load(path)).listDecisions()).toEqual([first.decision])
  })

  it.each([
    { outcome: 'maintain-plan' } as const,
    { outcome: 'revise-plan', note: 'A different plan.' } as const,
    { outcome: 'evidence-unavailable' } as const,
  ])('rejects a conflicting decision without replacing its receipt: $outcome', async (next) => {
    const { path } = await fixture()
    const store = await RoutineFollowUpStore.load(path)
    await store.put(input('report-1'), { allowCreate: true, observedRevision: 0, createdAt: 100 })
    const first = await store.decide('report-1', {
      outcome: 'revise-plan',
      note: 'Initial plan.',
    }, { observedRevision: store.observe('report-1').revision, decidedAt: 200 })

    await expect(store.decide('report-1', next, {
      observedRevision: store.observe('report-1').revision,
      decidedAt: 300,
    }))
      .rejects.toBeInstanceOf(RoutineFollowUpDecisionConflictError)
    expect(store.listDecisions()).toEqual([first.decision])
  })

  it('returns an explicit error when neither active carry nor receipt exists', async () => {
    const { path } = await fixture()
    const store = await RoutineFollowUpStore.load(path)

    await expect(store.decide('report-1', { outcome: 'maintain-plan' }, {
      observedRevision: store.observe('report-1').revision,
      decidedAt: 200,
    }))
      .rejects.toBeInstanceOf(RoutineFollowUpDecisionMissingError)
  })

  it('does not let an absent observation consume a carry that appears later', async () => {
    const { path } = await fixture()
    const store = await RoutineFollowUpStore.load(path)
    const absentObservation = store.observe('report-1')

    await store.put(input('report-1'), {
      allowCreate: true,
      observedRevision: absentObservation.revision,
      createdAt: 100,
    })

    await expect(store.decide('report-1', { outcome: 'maintain-plan' }, {
      observedRevision: absentObservation.revision,
      decidedAt: 200,
    })).rejects.toBeInstanceOf(RoutineFollowUpStaleObservationError)
    expect(store.list()).toEqual([{ ...input('report-1'), createdAt: 100 }])
    expect(store.listDecisions()).toEqual([])
  })

  it('serializes concurrent writes so every distinct report survives', async () => {
    const { path } = await fixture()
    const store = await RoutineFollowUpStore.load(path)

    await Promise.all(Array.from({ length: 20 }, (_, index) => (
      store.put(input(`report-${index}`), {
        allowCreate: true,
        observedRevision: 0,
        createdAt: 100 + index,
      })
    )))

    const reloaded = await RoutineFollowUpStore.load(path)
    expect(reloaded.list()).toHaveLength(20)
    expect(new Set(reloaded.list().map((record) => record.inboxEntryId)).size).toBe(20)
  })

  it('serializes concurrent decisions so only the first outcome wins', async () => {
    const { path } = await fixture()
    const store = await RoutineFollowUpStore.load(path)
    await store.put(input('report-1'), { allowCreate: true, observedRevision: 0, createdAt: 100 })

    const observedRevision = store.observe('report-1').revision
    const first = store.decide('report-1', { outcome: 'maintain-plan' }, {
      observedRevision,
      decidedAt: 200,
    })
    const conflicting = store.decide('report-1', {
      outcome: 'revise-plan',
      note: 'Change it.',
    }, { observedRevision, decidedAt: 201 })

    await expect(first).resolves.toMatchObject({ created: true })
    await expect(conflicting).rejects.toBeInstanceOf(RoutineFollowUpDecisionConflictError)
    expect(store.list()).toEqual([])
    expect(store.listDecisions()).toHaveLength(1)
  })

  it('invalidates a stale carry after a decision and prevents restart resurrection', async () => {
    const { path } = await fixture()
    const store = await RoutineFollowUpStore.load(path)
    await store.put(input('report-1'), { allowCreate: true, observedRevision: 0, createdAt: 100 })
    const observation = store.observe('report-1')

    const decided = store.decide('report-1', { outcome: 'maintain-plan' }, {
      observedRevision: observation.revision,
      decidedAt: 200,
    })
    const staleReplay = store.put(input('report-1'), {
      allowCreate: false,
      observedRevision: observation.revision,
      createdAt: 300,
    })

    await expect(decided).resolves.toMatchObject({ created: true })
    await expect(staleReplay).rejects.toBeInstanceOf(RoutineFollowUpStaleObservationError)
    expect(store.list()).toEqual([])

    const reloaded = await RoutineFollowUpStore.load(path)
    const afterRestart = reloaded.observe('report-1')
    await expect(reloaded.put(input('report-1'), {
      allowCreate: true,
      observedRevision: afterRestart.revision,
      createdAt: 400,
    })).rejects.toBeInstanceOf(RoutineFollowUpCreateDisallowedError)
    expect(reloaded.list()).toEqual([])
    expect(reloaded.listDecisions()).toHaveLength(1)
  })

  it('retains decisions beyond 1024 so the oldest receipt stays idempotent and blocks revival', async () => {
    const { dir, path } = await fixture()
    await mkdir(join(dir, 'nested'), { recursive: true })
    await writeFile(path, JSON.stringify({
      version: 2,
      active: [{ ...input('report-1024'), createdAt: 1024 }],
      decisions: Array.from({ length: 1_024 }, (_, index) => ({
        ...input(`report-${index}`),
        createdAt: index,
        outcome: 'maintain-plan',
        decidedAt: index,
      })),
    }), 'utf8')
    const store = await RoutineFollowUpStore.load(path)

    await store.decide('report-1024', { outcome: 'evidence-unavailable' }, {
      observedRevision: store.observe('report-1024').revision,
      decidedAt: 1024,
    })

    const decisions = store.listDecisions()
    expect(decisions).toHaveLength(1_025)
    expect(decisions.at(0)).toMatchObject({
      inboxEntryId: 'report-0',
      outcome: 'maintain-plan',
      decidedAt: 0,
    })
    expect(decisions.at(-1)).toMatchObject({
      inboxEntryId: 'report-1024',
      outcome: 'evidence-unavailable',
      decidedAt: 1024,
    })

    const reloaded = await RoutineFollowUpStore.load(path)
    expect(reloaded.listDecisions()).toEqual(decisions)
    await expect(reloaded.decide(
      'report-0',
      { outcome: 'maintain-plan' },
      { observedRevision: reloaded.observe('report-0').revision, decidedAt: 9_999 },
    )).resolves.toEqual({ decision: decisions[0], created: false })

    const observation = reloaded.observe('report-0')
    await expect(reloaded.put(input('report-0'), {
      allowCreate: true,
      observedRevision: observation.revision,
      createdAt: 10_000,
    })).rejects.toMatchObject({
      name: 'RoutineFollowUpCreateDisallowedError',
      reason: 'already-decided',
    })
  })
})
