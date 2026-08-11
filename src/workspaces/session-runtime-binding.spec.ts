import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import type { Credential } from '@/core/config.js'

import {
  emptyAgentSessionRuntime,
  type CliAdapter,
  type ResolvedSessionRuntimeBinding,
  type WorkspaceAiCred,
} from './cli-adapter.js'
import { claudeAdapter } from './adapters/claude.js'
import { codexAdapter } from './adapters/codex.js'
import { opencodeAdapter } from './adapters/opencode.js'
import { piAdapter } from './adapters/pi.js'
import {
  createNativeSessionRuntimeBinding,
  createSessionRuntimeBinding,
  resolveSessionRuntimeBinding,
  SessionRuntimeBindingError,
} from './session-runtime-binding.js'

const openai: Credential = {
  vendor: 'openai',
  authType: 'api-key',
  apiKey: 'sk-session-secret',
  wires: { 'openai-responses': 'https://api.openai.test/v1' },
  lastModel: 'gpt-5.6-terra',
}

function fakeAdapter(readAiConfig: () => Promise<WorkspaceAiCred | null>): CliAdapter {
  return {
    id: 'fake',
    displayName: 'Fake',
    capabilities: {
      parallelPerCwd: true,
      resumeLast: false,
      resumeById: true,
      transcriptDiscovery: 'none',
      aiProvider: {
        credentialSource: 'runtime-or-workspace',
        wirePreference: ['openai-responses'],
      },
    },
    sessionRuntime: emptyAgentSessionRuntime,
    composeCommand: (base) => base,
    readAiConfig,
  }
}

describe('durable Session runtime binding', () => {
  it('represents native credentials as an explicit optional binding with independent model and effort', () => {
    const readAiConfig = vi.fn(async (): Promise<WorkspaceAiCred> => ({
      apiKey: 'workspace-secret-that-must-not-be-read',
      model: 'workspace-model',
      wireShape: 'openai-responses',
    }))
    const adapter = fakeAdapter(readAiConfig)

    expect(createNativeSessionRuntimeBinding({
      adapter,
      selection: { model: 'native-model-override', reasoningEffort: 'low' },
    })).toEqual({
      binding: {
        version: 1,
        credential: { source: 'native' },
        model: 'native-model-override',
        reasoningEffort: 'low',
      },
      ai: {
        model: 'native-model-override',
        reasoningEffort: 'low',
      },
    })
    expect(readAiConfig).not.toHaveBeenCalled()
  })

  it('explicit native access bypasses an existing Workspace provider', async () => {
    const readAiConfig = vi.fn(async (): Promise<WorkspaceAiCred> => ({
      apiKey: 'workspace-secret-that-must-not-be-read',
      model: 'workspace-model',
      wireShape: 'openai-responses',
    }))
    const adapter = fakeAdapter(readAiConfig)

    await expect(createSessionRuntimeBinding({
      adapter,
      cwd: '/workspace',
      selection: {
        credentialSource: 'native',
        model: 'native-model',
        reasoningEffort: 'high',
      },
      credentials: { 'openai-1': openai },
    })).resolves.toEqual({
      binding: {
        version: 1,
        credential: { source: 'native' },
        model: 'native-model',
        reasoningEffort: 'high',
      },
      ai: { model: 'native-model', reasoningEffort: 'high' },
    })
    expect(readAiConfig).not.toHaveBeenCalled()
  })

  it('rejects a conflicting native and vault credential selection', async () => {
    await expect(createSessionRuntimeBinding({
      adapter: fakeAdapter(vi.fn(async () => null)),
      cwd: '/workspace',
      selection: { credentialSource: 'native', credentialSlug: 'openai-1' },
      credentials: { 'openai-1': openai },
    })).rejects.toMatchObject({ code: 'credential_selection_conflict' })
  })

  it('persists a vault reference and resolved model without persisting its key', async () => {
    const resolved = await createSessionRuntimeBinding({
      adapter: codexAdapter,
      cwd: '/workspace',
      selection: { credentialSlug: 'openai-1', reasoningEffort: 'high' },
      credentials: { 'openai-1': openai },
    })

    expect(resolved.binding).toEqual({
      version: 1,
      credential: {
        source: 'vault',
        credentialSlug: 'openai-1',
        wireShape: 'openai-responses',
      },
      model: 'gpt-5.6-terra',
      reasoningEffort: 'high',
    })
    expect(JSON.stringify(resolved.binding)).not.toContain('sk-session-secret')
    expect(resolved.ai?.apiKey).toBe('sk-session-secret')

    const resumed = await resolveSessionRuntimeBinding({
      adapter: codexAdapter,
      cwd: '/workspace',
      binding: resolved.binding,
      credentials: { 'openai-1': { ...openai, apiKey: 'rotated-key' } },
    })
    expect(resumed.binding).toEqual(resolved.binding)
    expect(resumed.ai?.apiKey).toBe('rotated-key')
  })

  it('keeps effort absent when a vault model is resolved without an explicit effort', async () => {
    const resolved = await createSessionRuntimeBinding({
      adapter: codexAdapter,
      cwd: '/workspace',
      selection: { credentialSlug: 'openai-1' },
      credentials: { 'openai-1': openai },
    })

    expect(resolved.binding.model).toBe('gpt-5.6-terra')
    expect(resolved.binding).not.toHaveProperty('reasoningEffort')
    expect(resolved.ai?.model).toBe('gpt-5.6-terra')
    expect(resolved.ai).not.toHaveProperty('reasoningEffort')
  })

  it('treats native login as the fresh default without reading project config', async () => {
    const read = vi.fn(async () => ({ model: 'native-model', reasoningEffort: 'medium' }) as WorkspaceAiCred)
    const adapter = fakeAdapter(read)
    await expect(createSessionRuntimeBinding({ adapter, cwd: '/workspace', credentials: {} }))
      .resolves.toMatchObject({
        binding: {
          credential: { source: 'native' },
        },
      })
    expect(read).not.toHaveBeenCalled()
  })

  it('still refuses to silently resume a persisted legacy Workspace provider after replacement', async () => {
    const original: WorkspaceAiCred = {
      baseUrl: 'https://gateway.test/v1',
      apiKey: 'first-key',
      wireShape: 'openai-responses',
      model: 'private-model',
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({
      baseUrl: original.baseUrl,
      apiKey: original.apiKey,
      wireShape: original.wireShape,
      authMode: null,
    })).digest('hex')
    const read = vi.fn(async (): Promise<WorkspaceAiCred> => original)
    const adapter = fakeAdapter(read)

    read.mockResolvedValue({
      baseUrl: 'https://gateway.test/v1',
      apiKey: 'replacement-key',
      wireShape: 'openai-responses',
      model: 'private-model',
    })
    await expect(resolveSessionRuntimeBinding({
      adapter,
      cwd: '/workspace',
      binding: {
        version: 1,
        credential: { source: 'workspace', fingerprint },
        model: original.model ?? undefined,
      },
      credentials: {},
    })).rejects.toMatchObject({
      code: 'workspace_binding_changed',
    })
  })
})

describe('built-in Agent Session runtime projection', () => {
  const runtime: ResolvedSessionRuntimeBinding = {
    binding: {
      version: 1,
      credential: {
        source: 'vault',
        credentialSlug: 'provider-1',
        wireShape: 'anthropic',
      },
      model: 'session-model',
      reasoningEffort: 'high',
    },
    ai: {
      baseUrl: 'https://provider.test',
      apiKey: 'must-not-enter-argv',
      wireShape: 'anthropic',
      authMode: 'bearer',
      model: 'session-model',
      reasoning: true,
      reasoningEffort: 'high',
    },
  }
  const ctx = {
    cwd: '/workspace',
    env: { AQ_LAUNCHER_REPO_ROOT: '/openalice' },
  }

  it.each([claudeAdapter, codexAdapter, opencodeAdapter, piAdapter])(
    '$id implements a secret-free argv projection',
    (adapter) => {
      const projected = adapter.sessionRuntime!.project(ctx, runtime)
      const interactive = adapter.composeCommand([adapter.id], {
        ...ctx,
        env: { ...ctx.env, ...projected.env },
        sessionRuntime: projected,
      })
      const headless = adapter.composeHeadlessCommand!([adapter.id], {
        ...ctx,
        env: { ...ctx.env, ...projected.env },
        sessionRuntime: projected,
      }, 'work')
      expect([
        ...projected.interactiveArgs,
        ...projected.headlessArgs,
        ...(projected.webArgs ?? []),
        ...interactive,
        ...headless,
      ].join(' ')).not.toContain('must-not-enter-argv')
      expect(interactive.join(' ')).toContain('session-model')
      expect(headless.join(' ')).toContain('session-model')
      expect(Object.values(projected.env).join(' ')).toContain('must-not-enter-argv')
    },
  )

  it.each([claudeAdapter, codexAdapter, opencodeAdapter, piAdapter])(
    '$id accepts a credentialless native binding and still projects model/effort',
    (adapter) => {
      const native = createNativeSessionRuntimeBinding({
        adapter,
        selection: { model: 'native-model-override', reasoningEffort: 'medium' },
      })
      const projected = adapter.sessionRuntime!.project(ctx, native)
      const serializedEnv = Object.values(projected.env).join(' ')
      const serializedArgs = [
        ...projected.interactiveArgs,
        ...projected.headlessArgs,
        ...(projected.webArgs ?? []),
      ].join(' ')

      expect(serializedArgs).toContain('native-model-override')
      expect(serializedEnv).not.toContain('sk-')
      expect(native.ai).not.toHaveProperty('apiKey')
    },
  )

  it('projects the native model and effort flags on every launch surface', () => {
    expect(claudeAdapter.sessionRuntime!.project(ctx, runtime).interactiveArgs)
      .toEqual([
        '--setting-sources=project',
        '--model',
        'session-model',
        '--effort',
        'high',
      ])
    expect(codexAdapter.sessionRuntime!.project(ctx, runtime).headlessArgs)
      .toContain('model_reasoning_effort="high"')
    expect(opencodeAdapter.sessionRuntime!.project(ctx, runtime).headlessArgs)
      .toContain('--variant')
    expect(piAdapter.sessionRuntime!.project(ctx, runtime).webArgs)
      .toContain('--extension')
  })

  it.each([
    [claudeAdapter, '--effort'],
    [codexAdapter, 'model_reasoning_effort'],
    [opencodeAdapter, '--variant'],
    [piAdapter, '--thinking'],
  ] as const)(
    '$id does not synthesize an effort flag when an explicit model omits effort',
    (adapter, effortFlag) => {
      const native = createNativeSessionRuntimeBinding({
        adapter,
        selection: { model: 'native-model-override' },
      })
      const projected = adapter.sessionRuntime!.project(ctx, native)
      const serializedArgs = [
        ...projected.interactiveArgs,
        ...projected.headlessArgs,
        ...(projected.webArgs ?? []),
      ].join(' ')

      expect(serializedArgs).toContain('native-model-override')
      expect(serializedArgs).not.toContain(effortFlag)
    },
  )

  it('keeps only Claude project settings for OpenAlice-managed credentials', () => {
    const managed = claudeAdapter.sessionRuntime!.project(ctx, runtime)
    for (const args of [managed.interactiveArgs, managed.headlessArgs, managed.webArgs]) {
      expect(args).toContain('--setting-sources=project')
      expect(args).not.toContain('--plugin-dir')
    }

    const native = createNativeSessionRuntimeBinding({
      adapter: claudeAdapter,
      selection: { model: 'native-model-override', reasoningEffort: 'medium' },
    })
    const projectedNative = claudeAdapter.sessionRuntime!.project(ctx, native)
    for (const args of [
      projectedNative.interactiveArgs,
      projectedNative.headlessArgs,
      projectedNative.webArgs,
    ]) {
      expect(args).not.toContain('--setting-sources=project')
      expect(args).not.toContain('--plugin-dir')
    }
  })
})
