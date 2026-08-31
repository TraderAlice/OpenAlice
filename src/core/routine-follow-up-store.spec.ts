import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  RoutineFollowUpCreateDisallowedError,
  RoutineFollowUpConflictError,
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
  it('treats a missing file as an empty queue', async () => {
    const { path } = await fixture()
    const store = await RoutineFollowUpStore.load(path)

    expect(store.list()).toEqual([])
    expect(store.get('missing')).toBeNull()
  })

  it.each([
    ['invalid JSON', '{'],
    ['wrong version', JSON.stringify({ version: 2, active: [] })],
    ['unknown file field', JSON.stringify({ version: 1, active: [], extra: true })],
    ['unknown record field', JSON.stringify({
      version: 1,
      active: [{ ...input('report-1'), createdAt: 100, extra: true }],
    })],
    ['duplicate record', JSON.stringify({
      version: 1,
      active: [
        { ...input('report-1'), createdAt: 100 },
        { ...input('report-1'), createdAt: 200 },
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
    expect(() => store.get('report-1')).toThrow(RoutineFollowUpUnavailableError)
    await expect(store.put(input('report-1'), {
      allowCreate: true,
      observedRevision: 0,
      createdAt: 100,
    })).rejects.toBeInstanceOf(
      RoutineFollowUpUnavailableError,
    )
    await expect(store.remove('report-1')).rejects.toBeInstanceOf(
      RoutineFollowUpUnavailableError,
    )
    expect(await readFile(path, 'utf8')).toBe('{ malformed')
  })

  it('persists a strict version-1 file through atomic tmp + rename', async () => {
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
      version: 1,
      active: [{ ...input('report-1'), createdAt: 1234 }],
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
    }))
      .rejects.toBeInstanceOf(RoutineFollowUpConflictError)
    expect((await RoutineFollowUpStore.load(path)).list()).toEqual([
      { ...input('report-1'), createdAt: 100 },
    ])
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

  it('removes idempotently and persists the surviving queue', async () => {
    const { path } = await fixture()
    const store = await RoutineFollowUpStore.load(path)
    await store.put(input('report-1'), { allowCreate: true, observedRevision: 0, createdAt: 100 })
    await store.put(input('report-2'), { allowCreate: true, observedRevision: 0, createdAt: 200 })

    await expect(store.remove('report-1')).resolves.toBe(true)
    await expect(store.remove('report-1')).resolves.toBe(false)
    expect((await RoutineFollowUpStore.load(path)).list()).toEqual([
      { ...input('report-2'), createdAt: 200 },
    ])
  })

  it('rejects a disallowed create inside the mutation lock after a prior record is removed', async () => {
    const { path } = await fixture()
    const store = await RoutineFollowUpStore.load(path)
    await store.put(input('report-1'), { allowCreate: true, observedRevision: 0, createdAt: 100 })
    const observation = store.observe('report-1')

    const removed = store.remove('report-1')
    const staleReplay = store.put(input('report-1'), {
      allowCreate: false,
      observedRevision: observation.revision,
      createdAt: 200,
    })

    await expect(removed).resolves.toBe(true)
    await expect(staleReplay).rejects.toBeInstanceOf(RoutineFollowUpStaleObservationError)
    expect(store.list()).toEqual([])
    expect((await RoutineFollowUpStore.load(path)).list()).toEqual([])
  })

  it('treats an idempotent resolve as a newer intent for a previously absent key', async () => {
    const { path } = await fixture()
    const store = await RoutineFollowUpStore.load(path)
    const observation = store.observe('report-1')

    await expect(store.remove('report-1')).resolves.toBe(false)
    await expect(store.put(input('report-1'), {
      allowCreate: true,
      observedRevision: observation.revision,
      createdAt: 100,
    })).rejects.toBeInstanceOf(RoutineFollowUpStaleObservationError)
    expect(store.list()).toEqual([])
  })
})
