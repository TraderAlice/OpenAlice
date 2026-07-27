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
})
