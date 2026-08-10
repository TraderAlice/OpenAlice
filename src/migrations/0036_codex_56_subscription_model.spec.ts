import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { migrateCodex56SubscriptionModel } from './0036_codex_56_subscription_model/index.js'

const roots: string[] = []

async function fixture(recentLaunch: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'openalice-codex-56-model-'))
  roots.push(root)
  const preferencesPath = join(root, 'preferences.json')
  await writeFile(preferencesPath, JSON.stringify({ quickChat: { recentLaunch } }))
  return { preferencesPath }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('0036_codex_56_subscription_model', () => {
  it('repairs a native Quick Start preference', async () => {
    const paths = await fixture({
      agent: 'codex',
      accessMode: 'auto',
      credentialSlug: null,
      model: 'gpt-5.6',
      reasoningEffort: null,
    })

    expect(await migrateCodex56SubscriptionModel(paths)).toEqual({
      preferencesUpdated: true,
    })
    expect(JSON.parse(await readFile(paths.preferencesPath, 'utf8')).quickChat.recentLaunch.model)
      .toBe('gpt-5.6-sol')
    expect(await migrateCodex56SubscriptionModel(paths)).toEqual({
      preferencesUpdated: false,
    })
  })

  it('preserves the valid API alias for vault and Workspace-owned launches', async () => {
    const paths = await fixture({
      agent: 'codex',
      accessMode: 'vault',
      credentialSlug: 'openai-primary',
      model: 'gpt-5.6',
      reasoningEffort: 'medium',
    })

    expect(await migrateCodex56SubscriptionModel(paths)).toEqual({
      preferencesUpdated: false,
    })
    expect(JSON.parse(await readFile(paths.preferencesPath, 'utf8')).quickChat.recentLaunch.model)
      .toBe('gpt-5.6')
  })
})
