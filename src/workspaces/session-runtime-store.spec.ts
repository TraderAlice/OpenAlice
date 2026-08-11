import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SessionRuntimeBinding } from './cli-adapter.js'
import { WorkspaceSessionRuntimeStore } from './session-runtime-store.js'

let root: string
let workspaceDir: string
let store: WorkspaceSessionRuntimeStore

const binding: SessionRuntimeBinding = {
  version: 1,
  credential: {
    source: 'vault',
    credentialSlug: 'openai-1',
    wireShape: 'openai-responses',
  },
  model: 'gpt-5.6-terra',
  reasoningEffort: 'high',
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workspace-session-runtime-'))
  workspaceDir = join(root, 'workspace')
  store = new WorkspaceSessionRuntimeStore(() => [join(workspaceDir, '.alice', 'sessions')])
})

afterEach(async () => rm(root, { recursive: true, force: true }))

describe('WorkspaceSessionRuntimeStore', () => {
  it('stores a secret-free Session AI config inside the owning Workspace', async () => {
    await store.ensure({ wsId: 'ws-1', resumeId: 'resume-test', agent: 'codex', binding })

    expect(await store.read({ wsId: 'ws-1', resumeId: 'resume-test', agent: 'codex' }))
      .toEqual(binding)
    const raw = await readFile(
      join(workspaceDir, '.alice', 'sessions', 'resume-test.json'),
      'utf8',
    )
    expect(JSON.parse(raw)).toEqual({
      version: 1,
      resumeId: 'resume-test',
      agent: 'codex',
      ai: binding,
    })
    expect(raw).not.toContain('sk-secret')
  })

  it('keeps the first Session binding immutable', async () => {
    await store.ensure({ wsId: 'ws-1', resumeId: 'resume-test', agent: 'codex', binding })
    await expect(store.ensure({
      wsId: 'ws-1',
      resumeId: 'resume-test',
      agent: 'codex',
      binding: { ...binding, model: 'gpt-other' },
    })).rejects.toThrow(/different runtime binding/)
  })

  it('atomically replaces a binding only through the explicit edit boundary', async () => {
    await store.ensure({ wsId: 'ws-1', resumeId: 'resume-test', agent: 'codex', binding })
    const replacement: SessionRuntimeBinding = {
      version: 1,
      credential: { source: 'native' },
      model: 'gpt-5.6-sol',
      reasoningEffort: 'low',
    }

    await store.replace({
      wsId: 'ws-1', resumeId: 'resume-test', agent: 'codex', binding: replacement,
    })

    expect(await store.read({ wsId: 'ws-1', resumeId: 'resume-test', agent: 'codex' }))
      .toEqual(replacement)
  })

  it('serializes competing first writes so only one binding wins', async () => {
    const results = await Promise.allSettled([
      store.ensure({ wsId: 'ws-1', resumeId: 'resume-race', agent: 'codex', binding }),
      store.ensure({
        wsId: 'ws-1',
        resumeId: 'resume-race',
        agent: 'codex',
        binding: { ...binding, model: 'gpt-other' },
      }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

  it('reads a departed Workspace fallback and rejects corrupt identity metadata', async () => {
    const departed = join(root, 'departed')
    const directory = join(departed, '.alice', 'sessions')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'resume-test.json'), JSON.stringify({
      version: 1,
      resumeId: 'another-resume',
      agent: 'codex',
      ai: binding,
    }))
    const fallbackStore = new WorkspaceSessionRuntimeStore(() => [
      join(root, 'missing', '.alice', 'sessions'),
      join(departed, '.alice', 'sessions'),
    ])

    await expect(fallbackStore.read({
      wsId: 'ws-1', resumeId: 'resume-test', agent: 'codex',
    })).rejects.toThrow(/unsupported shape/)
  })

  it('rejects path-like resume ids', async () => {
    await expect(store.read({ wsId: 'ws-1', resumeId: '../escape', agent: 'codex' }))
      .rejects.toThrow(/invalid Session resumeId/)
  })
})
