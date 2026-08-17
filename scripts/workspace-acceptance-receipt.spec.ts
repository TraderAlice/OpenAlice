import { describe, expect, it } from 'vitest'

import {
  formatWorkspaceAcceptanceFailure,
  inspectWorkspaceAcceptanceReceipt,
} from './workspace-acceptance-receipt.mjs'

describe('Workspace acceptance receipt diagnostics', () => {
  it('keeps the renderer error and every incomplete check', () => {
    const summary = inspectWorkspaceAcceptanceReceipt({
      error: 'Workspace shell-ready timeout: terminal tail',
      checks: {
        workspaceCreated: true,
        shellCliRoundTrip: false,
        managedPiAssistantReply: false,
      },
    })

    expect(summary).toEqual({
      error: 'Workspace shell-ready timeout: terminal tail',
      incompleteChecks: ['shellCliRoundTrip', 'managedPiAssistantReply'],
    })
    expect(formatWorkspaceAcceptanceFailure(summary)).toBe(
      'error: Workspace shell-ready timeout: terminal tail; incomplete checks: shellCliRoundTrip, managedPiAssistantReply',
    )
  })

  it('accepts a successful receipt without inventing diagnostics', () => {
    const summary = inspectWorkspaceAcceptanceReceipt({
      checks: {
        workspaceCreated: true,
        shellCliRoundTrip: true,
      },
    })

    expect(summary).toEqual({ error: null, incompleteChecks: [] })
  })
})
