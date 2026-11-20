import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceToolContext } from '../core/workspace-tool-center.js'
import {
  workspaceRuntimeGetFactory,
  workspaceRuntimeSetFactory,
} from './workspace-runtime-tools.js'

const executeOpts = { toolCallId: 't1', messages: [] }

function makeCtx(overrides: Partial<WorkspaceToolContext> = {}): WorkspaceToolContext {
  return {
    workspaceId: 'ws-current',
    workspaceLabel: 'Current',
    inboxStore: {} as never,
    entityStore: {} as never,
    workspaceRuntimeControl: {
      get: vi.fn(async (input) => ({ workspace: { id: input.wsId ?? 'ws-harness', tag: 'Desk' }, runtime: {} })),
      set: vi.fn(async (input) => ({ workspace: { id: input.wsId ?? 'ws-harness', tag: 'Desk' }, runtime: {} })),
    },
    ...overrides,
  }
}

describe('workspace_runtime_get', () => {
  it('defaults to the caller workspace when neither wsId nor harness is passed', async () => {
    const ctx = makeCtx()
    const tool = workspaceRuntimeGetFactory.build(ctx)
    const result = await tool.execute!({}, executeOpts)
    expect(result).toMatchObject({ ok: true, workspace: { id: 'ws-current' } })
    expect(ctx.workspaceRuntimeControl!.get).toHaveBeenCalledWith({ wsId: 'ws-current' })
  })

  it('forwards harness, mode, and agent when specified', async () => {
    const ctx = makeCtx()
    const tool = workspaceRuntimeGetFactory.build(ctx)
    const result = await tool.execute!({ harness: 'autoquant', mode: 'headless', agent: 'codex' }, executeOpts)
    expect(result).toMatchObject({ ok: true })
    expect(ctx.workspaceRuntimeControl!.get).toHaveBeenCalledWith({
      harness: 'autoquant',
      mode: 'headless',
      agent: 'codex',
    })
  })

  it('rejects mutually exclusive wsId and harness', async () => {
    const ctx = makeCtx()
    const tool = workspaceRuntimeGetFactory.build(ctx)
    const result = await tool.execute!({ wsId: 'ws-1', harness: 'autoquant' }, executeOpts)
    expect(result).toEqual({ ok: false, error: 'wsId and harness are mutually exclusive' })
  })

  it('returns an error when workspaceRuntimeControl is unavailable', async () => {
    const tool = workspaceRuntimeGetFactory.build(makeCtx({ workspaceRuntimeControl: undefined }))
    const result = await tool.execute!({}, executeOpts)
    expect(result).toEqual({ ok: false, error: 'Workspace runtime control is unavailable in this context' })
  })
})

describe('workspace_runtime_set', () => {
  it('rejects empty updates and conflicting flags', async () => {
    const ctx = makeCtx()
    const tool = workspaceRuntimeSetFactory.build(ctx)

    expect(await tool.execute!({}, executeOpts)).toEqual({
      ok: false,
      error: 'nothing to update: pass agent, credential, credentialSource, model, clearModel, effort, or clearEffort',
    })
    expect(await tool.execute!({ wsId: 'ws-1', harness: 'chat', model: 'default' }, executeOpts)).toEqual({
      ok: false,
      error: 'wsId and harness are mutually exclusive',
    })
    expect(await tool.execute!({ credential: 'openai-1', credentialSource: 'native' }, executeOpts)).toEqual({
      ok: false,
      error: 'credential and credentialSource are mutually exclusive',
    })
    expect(await tool.execute!({ model: 'gpt-5.6-terra', clearModel: true }, executeOpts)).toEqual({
      ok: false,
      error: 'model and clearModel are mutually exclusive',
    })
    expect(await tool.execute!({ effort: 'high', clearEffort: true }, executeOpts)).toEqual({
      ok: false,
      error: 'effort and clearEffort are mutually exclusive',
    })
  })

  it('accepts --model default together with --clear-model and forwards cleanly', async () => {
    const ctx = makeCtx()
    const tool = workspaceRuntimeSetFactory.build(ctx)
    const result = await tool.execute!({
      harness: 'autoquant',
      model: 'default',
      clearModel: true,
      effort: 'high',
    }, executeOpts)
    expect(result).toMatchObject({ ok: true })
    expect(ctx.workspaceRuntimeControl!.set).toHaveBeenCalledWith({
      harness: 'autoquant',
      model: 'default',
      clearModel: true,
      effort: 'high',
    })
  })

  it('surfaces control errors as { ok: false, error }', async () => {
    const ctx = makeCtx({
      workspaceRuntimeControl: {
        get: vi.fn(),
        set: vi.fn(async () => { throw new Error('credential not found: missing-1') }),
      },
    })
    const tool = workspaceRuntimeSetFactory.build(ctx)
    const result = await tool.execute!({ credential: 'missing-1' }, executeOpts)
    expect(result).toEqual({ ok: false, error: 'credential not found: missing-1' })
  })
})
