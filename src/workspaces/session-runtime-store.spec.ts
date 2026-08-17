import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { WorkspaceSessionRuntimeStore } from './session-runtime-store.js'

const binding = {
  version: 1 as const,
  credential: { source: 'native' as const },
  model: 'gpt-5.6-sol',
}

let dir: string
let store: WorkspaceSessionRuntimeStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'session-dossier-'))
  store = new WorkspaceSessionRuntimeStore((wsId) => [join(dir, wsId, '.alice', 'sessions')])
})

afterEach(async () => rm(dir, { recursive: true, force: true }))

describe('WorkspaceSessionRuntimeStore displayName', () => {
  it('stores displayName beside the frozen AI binding', async () => {
    await store.ensure({
      wsId: 'ws-1',
      resumeId: 'resume-kind-owl-abc123',
      agent: 'pi',
      binding,
    })
    await store.setDisplayName({
      wsId: 'ws-1',
      resumeId: 'resume-kind-owl-abc123',
      agent: 'pi',
      displayName: '  AAPL desk  ',
    })

    const dossier = await store.readDossier({
      wsId: 'ws-1',
      resumeId: 'resume-kind-owl-abc123',
      agent: 'pi',
    })
    expect(dossier).toMatchObject({
      displayName: 'AAPL desk',
      ai: binding,
    })
    const raw = await readFile(
      join(dir, 'ws-1', '.alice', 'sessions', 'resume-kind-owl-abc123.json'),
      'utf8',
    )
    expect(JSON.parse(raw)).toEqual({
      version: 1,
      resumeId: 'resume-kind-owl-abc123',
      agent: 'pi',
      ai: binding,
      displayName: 'AAPL desk',
    })
  })

  it('keeps displayName when a later launch writes the same AI binding', async () => {
    await store.setDisplayName({
      wsId: 'ws-1',
      resumeId: 'resume-kind-owl-abc123',
      agent: 'pi',
      displayName: 'AAPL desk',
    })
    await store.ensure({
      wsId: 'ws-1',
      resumeId: 'resume-kind-owl-abc123',
      agent: 'pi',
      binding,
    })

    expect(await store.readDossier({
      wsId: 'ws-1',
      resumeId: 'resume-kind-owl-abc123',
      agent: 'pi',
    })).toMatchObject({ displayName: 'AAPL desk', ai: binding })
  })

  it('keeps the AI binding when replacing a paused Session binding', async () => {
    await store.ensure({
      wsId: 'ws-1',
      resumeId: 'resume-kind-owl-abc123',
      agent: 'pi',
      binding,
    })
    await store.setDisplayName({
      wsId: 'ws-1',
      resumeId: 'resume-kind-owl-abc123',
      agent: 'pi',
      displayName: 'AAPL desk',
    })
    const next = { version: 1 as const, credential: { source: 'native' as const }, model: 'other' }
    await store.replace({
      wsId: 'ws-1',
      resumeId: 'resume-kind-owl-abc123',
      agent: 'pi',
      binding: next,
    })

    expect(await store.readDossier({
      wsId: 'ws-1',
      resumeId: 'resume-kind-owl-abc123',
      agent: 'pi',
    })).toMatchObject({ displayName: 'AAPL desk', ai: next })
  })

  it('clears displayName without deleting the AI binding', async () => {
    await store.ensure({
      wsId: 'ws-1',
      resumeId: 'resume-kind-owl-abc123',
      agent: 'pi',
      binding,
    })
    await store.setDisplayName({
      wsId: 'ws-1',
      resumeId: 'resume-kind-owl-abc123',
      agent: 'pi',
      displayName: 'AAPL desk',
    })
    expect(await store.setDisplayName({
      wsId: 'ws-1',
      resumeId: 'resume-kind-owl-abc123',
      agent: 'pi',
      displayName: '',
    })).toBeUndefined()

    const raw = JSON.parse(await readFile(
      join(dir, 'ws-1', '.alice', 'sessions', 'resume-kind-owl-abc123.json'),
      'utf8',
    )) as Record<string, unknown>
    expect(raw['displayName']).toBeUndefined()
    expect(raw['ai']).toEqual(binding)
  })

  it('reads a displayName-only dossier that predates the AI binding', async () => {
    const path = join(dir, 'ws-1', '.alice', 'sessions', 'resume-kind-owl-abc123.json')
    await mkdir(join(dir, 'ws-1', '.alice', 'sessions'), { recursive: true })
    await writeFile(path, JSON.stringify({
      version: 1,
      resumeId: 'resume-kind-owl-abc123',
      agent: 'pi',
      displayName: 'Unbound coworker',
    }, null, 2))

    expect(await store.read({
      wsId: 'ws-1',
      resumeId: 'resume-kind-owl-abc123',
      agent: 'pi',
    })).toBeNull()
    expect(await store.readDossier({
      wsId: 'ws-1',
      resumeId: 'resume-kind-owl-abc123',
      agent: 'pi',
    })).toMatchObject({ displayName: 'Unbound coworker' })
  })

  it('rejects an overlong displayName on write', async () => {
    await expect(store.setDisplayName({
      wsId: 'ws-1',
      resumeId: 'resume-kind-owl-abc123',
      agent: 'pi',
      displayName: 'x'.repeat(121),
    })).rejects.toThrow(/at most 120/)
  })
})
