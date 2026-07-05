import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Per-agent workspace credential defaults (the "inject my usual key on every new
 * workspace" setting) round-trip through ai-provider-manager.json, and deleting
 * the referenced credential prunes any default that pointed at it. config.ts
 * resolves CONFIG_DIR at import, so each test re-imports under a fresh temp
 * OPENALICE_HOME (config-accounts.spec.ts pattern).
 */
let home: string
let savedHome: string | undefined

async function loadConfigModule() {
  vi.resetModules()
  process.env['OPENALICE_HOME'] = home
  return import('./config.js')
}

beforeEach(async () => {
  savedHome = process.env['OPENALICE_HOME']
  home = await mkdtemp(join(tmpdir(), 'oa-wsdef-'))
})

afterEach(async () => {
  if (savedHome === undefined) delete process.env['OPENALICE_HOME']
  else process.env['OPENALICE_HOME'] = savedHome
  vi.resetModules()
  await rm(home, { recursive: true, force: true })
})

describe('workspace credential defaults', () => {
  it('defaults to an empty map when unset', async () => {
    const config = await loadConfigModule()
    expect(await config.readWorkspaceCredentialDefaults()).toEqual({})
  })

  it('round-trips a per-agent map and keeps the optional model', async () => {
    const config = await loadConfigModule()
    await config.writeWorkspaceCredentialDefaults({
      opencode: { credentialSlug: 'openai-1', model: 'gpt-5.5' },
      pi: { credentialSlug: 'anthropic-1' },
    })
    expect(await config.readWorkspaceCredentialDefaults()).toEqual({
      opencode: { credentialSlug: 'openai-1', model: 'gpt-5.5' },
      pi: { credentialSlug: 'anthropic-1' },
    })
  })

  it('drops entries with an empty credentialSlug (the "don\'t seed" choice)', async () => {
    const config = await loadConfigModule()
    await config.writeWorkspaceCredentialDefaults({
      opencode: { credentialSlug: 'openai-1' },
      pi: { credentialSlug: '' },
    })
    expect(await config.readWorkspaceCredentialDefaults()).toEqual({
      opencode: { credentialSlug: 'openai-1' },
    })
  })

  it('coexists with the credential vault in the same file', async () => {
    const config = await loadConfigModule()
    const slug = await config.addCredential({ vendor: 'openai', authType: 'api-key', apiKey: 'sk-oa', wires: { 'openai-chat': '' } })
    await config.writeWorkspaceCredentialDefaults({ opencode: { credentialSlug: slug } })
    expect(await config.readCredentials()).toHaveProperty(slug)
    expect(await config.readWorkspaceCredentialDefaults()).toEqual({ opencode: { credentialSlug: slug } })
  })

  it('deleting a credential prunes a default that referenced it', async () => {
    const config = await loadConfigModule()
    const slug = await config.addCredential({ vendor: 'openai', authType: 'api-key', apiKey: 'sk-oa', wires: { 'openai-chat': '' } })
    await config.writeWorkspaceCredentialDefaults({
      opencode: { credentialSlug: slug },
      pi: { credentialSlug: 'kept-1' },
    })
    await config.deleteCredential(slug)
    expect(await config.readWorkspaceCredentialDefaults()).toEqual({ pi: { credentialSlug: 'kept-1' } })
  })
})
