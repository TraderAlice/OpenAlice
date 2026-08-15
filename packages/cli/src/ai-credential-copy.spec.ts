import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  AI_PROVIDER_FILE_REL,
  allocateCredentialSlug,
  copyAiCredentials,
  formatAiCredentialCopyResult,
  mergeAiCredentials,
  writeAiProviderVault,
} from './ai-credential-copy.ts'

const temporary: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('mergeAiCredentials', () => {
  it('copies new slugs, skips identical keys, and renames collisions', () => {
    const merged = mergeAiCredentials(
      {
        'openai-1': { vendor: 'openai', authType: 'api-key', apiKey: 'sk-new' },
        'anthropic-1': { vendor: 'anthropic', authType: 'api-key', apiKey: 'sk-same' },
        'openai-2': { vendor: 'openai', authType: 'api-key', apiKey: 'sk-other' },
      },
      {
        'openai-1': { vendor: 'openai', authType: 'api-key', apiKey: 'sk-existing' },
        'anthropic-1': { vendor: 'anthropic', authType: 'api-key', apiKey: 'sk-same' },
      },
    )
    expect(merged.skipped).toEqual(['anthropic-1'])
    expect(merged.renamed).toEqual([
      { from: 'openai-1', to: 'openai-2' },
      { from: 'openai-2', to: 'openai-3' },
    ])
    expect(merged.copied).toEqual(['openai-2', 'openai-3'])
    expect(merged.credentials['openai-1']?.apiKey).toBe('sk-existing')
    expect(merged.credentials['openai-2']?.apiKey).toBe('sk-new')
    expect(merged.credentials['openai-3']?.apiKey).toBe('sk-other')
  })

  it('allocates the next free vendor slug', () => {
    expect(allocateCredentialSlug('openai', new Set(['openai-1', 'openai-2']))).toBe('openai-3')
  })
})

describe('copyAiCredentials', () => {
  it('writes only the destination vault and never mentions secrets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-cred-copy-'))
    temporary.push(root)
    const fromHome = join(root, 'from')
    const toHome = join(root, 'to')
    await writeAiProviderVault(fromHome, {
      credentials: {
        'openai-1': { vendor: 'openai', authType: 'api-key', apiKey: 'sk-secret-source' },
      },
      workspaceCredentialDefaults: {
        pi: { credentialSlug: 'openai-1' },
      },
    })
    await mkdir(join(toHome, 'data', 'config'), { recursive: true })
    await writeFile(
      join(toHome, AI_PROVIDER_FILE_REL),
      `${JSON.stringify({ credentials: {}, workspaceDefaultAgent: 'pi' }, null, 2)}\n`,
    )

    const result = await copyAiCredentials({
      fromKey: 'default',
      toKey: 'office',
      fromHome,
      toHome,
    })
    expect(result.copied).toEqual(['openai-1'])
    const written = JSON.parse(await readFile(join(toHome, AI_PROVIDER_FILE_REL), 'utf8')) as {
      credentials: Record<string, { apiKey?: string }>
      workspaceCredentialDefaults?: Record<string, { credentialSlug: string }>
      workspaceDefaultAgent?: string
    }
    expect(written.credentials['openai-1']?.apiKey).toBe('sk-secret-source')
    expect(written.workspaceCredentialDefaults).toBeUndefined()
    expect(written.workspaceDefaultAgent).toBe('pi')
    expect(formatAiCredentialCopyResult(result)).not.toContain('sk-secret')
  })

  it('refuses the same project or the same home', async () => {
    await expect(copyAiCredentials({
      fromKey: 'office',
      toKey: 'office',
      fromHome: '/tmp/a',
      toHome: '/tmp/b',
    })).rejects.toMatchObject({ code: 'EUSAGE' })
    await expect(copyAiCredentials({
      fromKey: 'default',
      toKey: 'office',
      fromHome: '/tmp/same-home',
      toHome: '/tmp/same-home',
    })).rejects.toMatchObject({ code: 'EUSAGE' })
  })
})
