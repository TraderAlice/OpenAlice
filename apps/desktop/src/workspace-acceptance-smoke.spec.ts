import { describe, expect, it, vi } from 'vitest'

import { runRendererWorkspaceAcceptanceSmoke } from './workspace-acceptance-smoke.js'

describe('Workspace acceptance renderer source', () => {
  it('preserves literal newline escapes and waits for the shell readiness marker', async () => {
    const executeJavaScript = vi.fn(async () => ({}))
    const win = { webContents: { executeJavaScript } }

    await runRendererWorkspaceAcceptanceSmoke(win as never, 'http://127.0.0.1:1234/v1')
    const source = executeJavaScript.mock.calls[0]?.[0] ?? ''

    for (const marker of ['CLI_ENV', 'CLI_MANIFESTS', 'GIT', 'WORKSPACE_CLI_CONTRACT']) {
      expect(source).toContain(`"printf '__OPENALICE_%s_OK__\\\\n' '${marker}'"`)
    }
    expect(source).toContain('__OPENALICE_WORKSPACE_%s_FAILED__ %s %s\\\\n%s\\\\n')
    expect(source).toContain('managedPiStructuredOutput')
    expect(source).toContain('managedPiDiagnosticCompaction')
    expect(source).toContain('scheduledIssueDispatched')
    expect(source).toContain('scheduledIssueAutoCompleted')
    expect(source).toContain('waitForScheduledRun')
    expect(source).toContain('--assignee @new-each-run')
    expect(source).not.toContain('--assignee @workspace')
    expect(source).toContain('preserve these literal characters & | < > ^ % !')
    expect(source).toContain("block?.type === 'tool' && block?.status === 'completed'")
    expect(source).toContain("diagnosticText.includes('\"type\":\"message_update\"')")
    const attached = source.indexOf('await attached')
    const shellProbe = source.indexOf("'SHELL'\\r")
    const shellProbeLoop = source.indexOf("while (!output.includes('__OPENALICE_SHELL_READY__'))")
    const shellProbeSend = source.indexOf('bridge.send(connectionId, shellProbe)', shellProbeLoop)
    const shellReady = source.indexOf('await shellReady')
    const helperProbe = source.indexOf("'STEP_HELPER'\\r")
    const helperReady = source.indexOf('await helperReady')
    const contract = source.indexOf("command + '\\r'")
    expect([
      attached,
      shellProbe,
      shellProbeLoop,
      shellProbeSend,
      shellReady,
      helperProbe,
      helperReady,
      contract,
    ]).not.toContain(-1)
    expect(attached).toBeLessThan(shellProbe)
    expect(shellProbe).toBeLessThan(shellProbeLoop)
    expect(shellProbeLoop).toBeLessThan(shellProbeSend)
    expect(shellProbeSend).toBeLessThan(shellReady)
    expect(shellReady).toBeLessThan(helperProbe)
    expect(helperProbe).toBeLessThan(helperReady)
    expect(helperReady).toBeLessThan(contract)
    expect(source).toContain('Workspace shell-ready timeout: ')
    expect(source).toContain('Workspace CLI helper-ready timeout: ')
    expect(source).not.toContain('waitForShellPrompt')
    expect(source).toContain('new Promise((resolve) => setTimeout(resolve, 500))')
    expect(() => new Function(`return ${source}`)).not.toThrow()
  })
})
