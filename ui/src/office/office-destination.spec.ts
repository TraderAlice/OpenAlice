import { describe, expect, it } from 'vitest'

import {
  officeWorkspaceDestination,
  officeWorkspaceSource,
} from './office-destination'

describe('office destination', () => {
  it.each([
    ['chat', 'chat'],
    ['auto-quant', 'auto-quant'],
    ['prediction', 'prediction'],
    ['other', undefined],
  ] as const)('maps the %s Harness to its product source', (harness, source) => {
    expect(officeWorkspaceSource(harness)).toBe(source)
  })

  it('opens an exact Session inside its Harness-owned product area', () => {
    expect(officeWorkspaceDestination(
      { id: 'chat-jun15', harness: 'chat' },
      'grok-brisk-maple-path',
    )).toEqual({
      kind: 'workspace',
      params: {
        wsId: 'chat-jun15',
        sessionId: 'grok-brisk-maple-path',
        source: 'chat',
      },
    })
  })

  it('keeps the Harness source when opening a Workspace without a Session', () => {
    expect(officeWorkspaceDestination({ id: 'quant-1', harness: 'auto-quant' })).toEqual({
      kind: 'workspace',
      params: { wsId: 'quant-1', source: 'auto-quant' },
    })
  })

  it('falls back to the global Workspace surface for an unknown Harness', () => {
    expect(officeWorkspaceDestination(
      { id: 'custom-1', harness: 'other' },
      'session-1',
    )).toEqual({
      kind: 'workspace',
      params: { wsId: 'custom-1', sessionId: 'session-1' },
    })
  })
})
