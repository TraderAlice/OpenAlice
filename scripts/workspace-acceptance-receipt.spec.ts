import { describe, expect, it } from 'vitest'

import {
  formatWorkspaceAcceptanceFailure,
  inspectWorkspaceAcceptanceReceipt,
  requiredWorkspaceChecks,
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

    expect(summary.error).toBe('Workspace shell-ready timeout: terminal tail')
    expect(summary.incompleteChecks).toContain('shellCliRoundTrip')
    expect(summary.incompleteChecks).toContain('managedPiAssistantReply')
    expect(summary.incompleteChecks).toContain('cleanupComplete')
    expect(formatWorkspaceAcceptanceFailure(summary)).toContain('error: Workspace shell-ready timeout: terminal tail; incomplete checks:')
  })

  it('accepts a successful receipt without inventing diagnostics', () => {
    const summary = inspectWorkspaceAcceptanceReceipt({
      checks: Object.fromEntries(requiredWorkspaceChecks.map((name: string) => [name, true])),
    })

    expect(summary).toEqual({ error: null, incompleteChecks: [] })
  })

  it('rejects an empty or truncated receipt and a failed cleanup', () => {
    expect(inspectWorkspaceAcceptanceReceipt({ checks: {} }).incompleteChecks).toEqual(requiredWorkspaceChecks)
    const checks = Object.fromEntries(requiredWorkspaceChecks.map((name: string) => [name, true]))
    delete checks.managedPiCliSideEffect
    expect(inspectWorkspaceAcceptanceReceipt({ checks }).incompleteChecks).toEqual(['managedPiCliSideEffect'])
    checks.managedPiCliSideEffect = true
    checks.cleanupComplete = false
    expect(inspectWorkspaceAcceptanceReceipt({ checks }).incompleteChecks).toEqual(['cleanupComplete'])
    checks.cleanupComplete = 'warning' as unknown as boolean
    expect(inspectWorkspaceAcceptanceReceipt({ checks }).incompleteChecks).toEqual(['cleanupComplete'])
    // Keep the producer's real schema tied to the consumer's required set.
    const source = readFileSync(resolve(import.meta.dirname, '../apps/desktop/src/workspace-acceptance-smoke.ts'), 'utf8')
    const declared = source.match(/readonly checks: \{([\s\S]*?)\n  \}/)![1]
    expect([...declared.matchAll(/readonly (\w+): boolean/g)].map(match => match[1]).sort()).toEqual([...requiredWorkspaceChecks].sort())
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
