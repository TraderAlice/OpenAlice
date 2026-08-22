import { describe, expect, it } from 'vitest'

import { getView, getViewShell } from './registry'

describe('file-viewer URL projection', () => {
  it('projects Ask Alice artifacts into the chat route with Session context', () => {
    expect(getView('file-viewer').toUrl({
      kind: 'file-viewer',
      params: {
        wsId: 'chat-1',
        path: 'research/note.md',
        source: 'chat',
        returnSessionId: 'pi-crisp-granite-pencil',
      },
    })).toBe(
      '/chat/workspaces/chat-1/view/research%2Fnote.md?sessionId=pi-crisp-granite-pencil',
    )
  })

  it('preserves the existing Workspace file URL', () => {
    expect(getView('file-viewer').toUrl({
      kind: 'file-viewer',
      params: { wsId: 'workspace-1', path: 'README.md' },
    })).toBe('/workspaces/workspace-1/view/README.md')
  })

  it('projects AutoQuant artifacts into its Harness route', () => {
    expect(getView('file-viewer').toUrl({
      kind: 'file-viewer',
      params: {
        wsId: 'aq-1',
        path: 'reports/strategy.md',
        source: 'auto-quant',
      },
    })).toBe('/auto-quant/workspaces/aq-1/view/reports%2Fstrategy.md')
  })

  it('projects Tracked artifacts into a provenance-preserving route', () => {
    expect(getView('file-viewer').toUrl({
      kind: 'file-viewer',
      params: {
        wsId: 'workspace-1',
        path: 'research/power note.md',
        source: 'tracked',
        returnTrackedName: 'stock-vst',
      },
    })).toBe(
      '/tracked/files/workspace-1/research%2Fpower%20note.md?entity=stock-vst',
    )
  })
})

describe('Tracked selection URL projection', () => {
  it('projects an Issue selection into a reload-safe query', () => {
    expect(getView('tracked').toUrl({
      kind: 'tracked',
      params: { workspace: 'workspace-1', issue: 'power-watch' },
    })).toBe('/tracked?workspace=workspace-1&issue=power-watch')
  })
})

describe('Office URL projection', () => {
  it('projects Office onto a single /office route', () => {
    expect(getView('office').toUrl({ kind: 'office', params: {} })).toBe('/office')
  })
})

describe('Market News URL projection', () => {
  it('projects News onto the Market navigator route', () => {
    expect(getView('news').toUrl({ kind: 'news', params: {} })).toBe('/market/news')
  })
})

describe('Settings URL projection', () => {
  it('projects the Beta category onto /settings/beta', () => {
    expect(getView('settings').toUrl({
      kind: 'settings',
      params: { category: 'beta' },
    })).toBe('/settings/beta')
  })

  it('projects the Activity bar category onto /settings/activity-bar', () => {
    expect(getView('settings').toUrl({
      kind: 'settings',
      params: { category: 'activity-bar' },
    })).toBe('/settings/activity-bar')
  })

  it('projects the Agent runtimes category onto /settings/agent-runtimes', () => {
    expect(getView('settings').toUrl({
      kind: 'settings',
      params: { category: 'agent-runtimes' },
    })).toBe('/settings/agent-runtimes')
  })
})

describe('shared product shells', () => {
  it('assigns every Ask Alice surface to the shared chat shell', () => {
    expect(getViewShell({ kind: 'chat-landing', params: {} })).toBe('chat')
    expect(getViewShell({ kind: 'workspace-manager', params: {} })).toBe('chat')
    expect(getViewShell({
      kind: 'workspace',
      params: { wsId: 'chat-1', sessionId: 'pi-1', source: 'chat' },
    })).toBe('chat')
    expect(getViewShell({
      kind: 'file-viewer',
      params: { wsId: 'chat-1', path: 'README.md', source: 'chat' },
    })).toBe('chat')
  })

  it('keeps generic Workspace surfaces outside the Ask Alice shell', () => {
    expect(getViewShell({
      kind: 'workspace',
      params: { wsId: 'workspace-1' },
    })).toBeNull()
    expect(getViewShell({
      kind: 'file-viewer',
      params: { wsId: 'workspace-1', path: 'README.md' },
    })).toBeNull()
  })

  it('assigns every AutoQuant surface to its own shared Harness shell', () => {
    expect(getViewShell({ kind: 'auto-quant-landing', params: {} })).toBe('auto-quant')
    expect(getViewShell({
      kind: 'workspace',
      params: { wsId: 'aq-1', sessionId: 'codex-1', source: 'auto-quant' },
    })).toBe('auto-quant')
    expect(getViewShell({
      kind: 'file-viewer',
      params: { wsId: 'aq-1', path: 'README.md', source: 'auto-quant' },
    })).toBe('auto-quant')
    expect(getViewShell({
      kind: 'harness-surface',
      params: { wsId: 'aq-1', capability: 'studio', source: 'auto-quant' },
    })).toBe('auto-quant')
  })

  it('assigns every Auto Prediction surface to its own shared Harness shell', () => {
    expect(getViewShell({ kind: 'auto-prediction-landing', params: {} })).toBe('prediction')
    expect(getViewShell({
      kind: 'workspace',
      params: { wsId: 'prediction-1', sessionId: 'codex-1', source: 'prediction' },
    })).toBe('prediction')
    expect(getViewShell({
      kind: 'file-viewer',
      params: { wsId: 'prediction-1', path: 'README.md', source: 'prediction' },
    })).toBe('prediction')
    const studio = { kind: 'harness-surface', params: { wsId: 'prediction-1', capability: 'studio', source: 'prediction' } } as const
    expect(getViewShell(studio)).toBe('prediction')
    expect(getView('harness-surface').toUrl(studio)).toBe('/prediction/workspaces/prediction-1/studio')
  })
})
