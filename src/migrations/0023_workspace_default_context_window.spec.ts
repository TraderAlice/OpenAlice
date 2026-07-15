import { describe, expect, it, vi } from 'vitest'

import {
  addWorkspaceDefaultContextWindows,
  migration,
} from './0023_workspace_default_context_window/index.js'
import type { MigrationContext } from './types.js'

describe('0023 Workspace default context migration', () => {
  it('adds 256K to existing Pi/OpenCode defaults without touching other provider state', () => {
    const raw = {
      credentials: { 'openai-1': { vendor: 'openai' } },
      workspaceCredentialDefaults: {
        opencode: { credentialSlug: 'openai-1', model: 'gpt-5.5' },
        pi: { credentialSlug: 'openai-1', contextWindow: 128_000 },
        claude: { credentialSlug: 'anthropic-1' },
      },
    }

    expect(addWorkspaceDefaultContextWindows(raw)).toEqual({
      changed: true,
      value: {
        ...raw,
        workspaceCredentialDefaults: {
          opencode: { credentialSlug: 'openai-1', model: 'gpt-5.5', contextWindow: 256_000 },
          pi: { credentialSlug: 'openai-1', contextWindow: 128_000 },
          claude: { credentialSlug: 'anthropic-1' },
        },
      },
    })
  })

  it('repairs invalid stored limits and is idempotent after the first write', async () => {
    let value: unknown = {
      workspaceCredentialDefaults: {
        pi: { credentialSlug: 'openai-1', contextWindow: -1 },
      },
    }
    const writeJson = vi.fn(async (_filename: string, next: unknown) => { value = next })
    const ctx: MigrationContext = {
      async readJson<T>() { return value as T },
      writeJson,
      removeJson: vi.fn(async () => undefined),
      configDir: () => '/virtual/config',
    }

    await migration.up(ctx)
    await migration.up(ctx)

    expect(writeJson).toHaveBeenCalledOnce()
    expect(value).toEqual({
      workspaceCredentialDefaults: {
        pi: { credentialSlug: 'openai-1', contextWindow: 256_000 },
      },
    })
  })

  it('does not invent defaults when the setting is absent', () => {
    expect(addWorkspaceDefaultContextWindows({ credentials: {} })).toEqual({
      changed: false,
      value: { credentials: {} },
    })
  })
})
