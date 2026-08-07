import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { migrateCodex56SubscriptionModel } from './0036_codex_56_subscription_model/index.js'

const roots: string[] = []

async function fixture(input: { recentLaunch: unknown; records: unknown[] }) {
  const root = await mkdtemp(join(tmpdir(), 'openalice-codex-56-model-'))
  roots.push(root)
  const preferencesPath = join(root, 'preferences.json')
  const resumeIdentitiesPath = join(root, 'resume-identities.json')
  await writeFile(preferencesPath, JSON.stringify({ quickChat: { recentLaunch: input.recentLaunch } }))
  await writeFile(resumeIdentitiesPath, JSON.stringify({ version: 2, records: input.records }))
  return { preferencesPath, resumeIdentitiesPath }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('0036_codex_56_subscription_model', () => {
  it('repairs native Quick Start and native Codex Session bindings', async () => {
    const paths = await fixture({
      recentLaunch: {
        agent: 'codex',
        accessMode: 'auto',
        credentialSlug: null,
        model: 'gpt-5.6',
        reasoningEffort: null,
      },
      records: [{
        resumeId: 'resume-test',
        agent: 'codex',
        runtimeBinding: {
          version: 1,
          credential: { source: 'native' },
          model: 'gpt-5.6',
        },
      }],
    })

    expect(await migrateCodex56SubscriptionModel(paths)).toEqual({
      preferencesUpdated: true,
      sessionsUpdated: true,
    })
    expect(JSON.parse(await readFile(paths.preferencesPath, 'utf8')).quickChat.recentLaunch.model)
      .toBe('gpt-5.6-sol')
    expect(JSON.parse(await readFile(paths.resumeIdentitiesPath, 'utf8')).records[0].runtimeBinding.model)
      .toBe('gpt-5.6-sol')
    expect(await migrateCodex56SubscriptionModel(paths)).toEqual({
      preferencesUpdated: false,
      sessionsUpdated: false,
    })
  })

  it('preserves the valid API alias for vault and Workspace-owned launches', async () => {
    const paths = await fixture({
      recentLaunch: {
        agent: 'codex',
        accessMode: 'vault',
        credentialSlug: 'openai-primary',
        model: 'gpt-5.6',
        reasoningEffort: 'medium',
      },
      records: [
        {
          resumeId: 'resume-vault',
          agent: 'codex',
          runtimeBinding: {
            version: 1,
            credential: {
              source: 'vault',
              credentialSlug: 'openai-primary',
              wireShape: 'openai-responses',
            },
            model: 'gpt-5.6',
          },
        },
        {
          resumeId: 'resume-workspace',
          agent: 'codex',
          runtimeBinding: {
            version: 1,
            credential: { source: 'workspace', fingerprint: 'fingerprint' },
            model: 'gpt-5.6',
          },
        },
      ],
    })

    expect(await migrateCodex56SubscriptionModel(paths)).toEqual({
      preferencesUpdated: false,
      sessionsUpdated: false,
    })
    expect(JSON.parse(await readFile(paths.preferencesPath, 'utf8')).quickChat.recentLaunch.model)
      .toBe('gpt-5.6')
    expect(JSON.parse(await readFile(paths.resumeIdentitiesPath, 'utf8')).records)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ runtimeBinding: expect.objectContaining({ model: 'gpt-5.6' }) }),
      ]))
  })
})
