import type { BrowserWindow } from 'electron'

export interface WorkspaceAcceptanceReceipt {
  readonly schemaVersion: 1
  readonly mode: 'packaged-electron'
  readonly workspaceType: 'chat'
  readonly runtime: 'pi'
  readonly transport: 'electron-pty+tool-socket'
  readonly workspaceId: string
  readonly durationMs: number
  readonly error?: string
  readonly checks: {
    readonly workspaceCreated: boolean
    readonly gitReady: boolean
    readonly cliEnvironmentInjected: boolean
    readonly allCliManifestsLoaded: boolean
    readonly shellCliRoundTrip: boolean
    readonly managedPiAssistantReply: boolean
    readonly managedPiCliSideEffect: boolean
    readonly cleanupComplete: boolean
  }
}

const ACCEPTANCE_MARKER = 'OPENALICE_PACKAGED_WORKSPACE_CLI_ACCEPTANCE'
const SHELL_ISSUE_ID = 'openalice-shell-cli-contract'
const AGENT_ISSUE_ID = 'openalice-agent-cli-acceptance'
const ASSISTANT_TEXT = 'OpenAlice Workspace CLI acceptance completed.'

/**
 * Execute the release acceptance path through the same sandboxed renderer,
 * preload PTY bridge, app:// API transport, Workspace environment composer,
 * managed Pi adapter, and CLI gateway used by the product.
 */
export async function runRendererWorkspaceAcceptanceSmoke(
  win: BrowserWindow,
  aiBaseUrl: string,
): Promise<WorkspaceAcceptanceReceipt> {
  const serializedBaseUrl = JSON.stringify(aiBaseUrl)
  return win.webContents.executeJavaScript(`(async () => {
    const startedAt = Date.now()
    const bridge = window.openAlice?.pty
    if (!bridge) throw new Error('window.openAlice.pty missing')
    const aiBaseUrl = ${serializedBaseUrl}
    const shellIssueId = '${SHELL_ISSUE_ID}'
    const agentIssueId = '${AGENT_ISSUE_ID}'
    const shellMarker = '__OPENALICE_WORKSPACE_CLI_CONTRACT_OK__'
    const checks = {
      workspaceCreated: false,
      gitReady: false,
      cliEnvironmentInjected: false,
      allCliManifestsLoaded: false,
      shellCliRoundTrip: false,
      managedPiAssistantReply: false,
      managedPiCliSideEffect: false,
      cleanupComplete: false,
    }
    const json = async (res) => {
      const text = await res.text()
      let body = null
      try { body = text ? JSON.parse(text) : null } catch { body = text }
      if (!res.ok) throw new Error(res.status + ' ' + text)
      return body
    }
    const issueExists = (snapshot, workspaceId, issueId) => {
      const owner = snapshot?.workspaces?.find((row) => row.wsId === workspaceId)
      return Boolean(owner?.issues?.some((issue) => issue.id === issueId))
    }
    const decode = (value) => {
      if (typeof value === 'string') return value
      if (value instanceof Uint8Array) return new TextDecoder().decode(value)
      if (value?.buffer instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(value.buffer))
      return String(value ?? '')
    }
    const runShellContract = async (workspaceId, sessionId) => {
      let connectionId = ''
      let output = ''
      let attachedResolve
      let attachedReject
      let markerResolve
      let markerReject
      const attached = new Promise((resolve, reject) => {
        attachedResolve = resolve
        attachedReject = reject
      })
      const marker = new Promise((resolve, reject) => {
        markerResolve = resolve
        markerReject = reject
      })
      const attachedTimer = setTimeout(() => attachedReject(new Error('PTY attached timeout')), 10000)
      const markerTimer = setTimeout(() => markerReject(new Error('Workspace CLI contract timeout: ' + output.slice(-4000))), 30000)
      connectionId = bridge.connect({ sessionId, cols: 120, rows: 32 })
      const offMessage = bridge.onMessage(connectionId, (msg) => {
        if (msg.type === 'control') {
          try {
            const control = JSON.parse(decode(msg.data))
            if (control.type === 'attached') {
              clearTimeout(attachedTimer)
              attachedResolve(control)
            }
          } catch {
            // Non-JSON terminal control frames are not part of this contract.
          }
          return
        }
        output += decode(msg.data)
        if (output.includes('__OPENALICE_CLI_ENV_OK__')) checks.cliEnvironmentInjected = true
        if (output.includes('__OPENALICE_CLI_MANIFESTS_OK__')) checks.allCliManifestsLoaded = true
        if (output.includes('__OPENALICE_GIT_OK__')) checks.gitReady = true
        if (output.includes(shellMarker)) {
          clearTimeout(markerTimer)
          markerResolve(output)
        }
      })
      const offClose = bridge.onClose(connectionId, (event) => {
        const error = new Error('PTY closed before Workspace CLI contract completed: ' + event.code + ' ' + event.reason)
        attachedReject(error)
        markerReject(error)
      })
      try {
        await attached
        const command = [
          'set -e',
          'test "$AQ_WS_ID" = "' + workspaceId + '"',
          'test -n "$OPENALICE_TOOL_URL"',
          'test -n "$OPENALICE_TOOL_SOCKET"',
          'command -v alice >/dev/null',
          'command -v alice-workspace >/dev/null',
          'command -v traderhub >/dev/null',
          'command -v alice-uta >/dev/null',
          "printf '__OPENALICE_%s_OK__\\\\n' 'CLI_ENV'",
          'alice --help >/dev/null',
          'alice-workspace --help >/dev/null',
          'traderhub --help >/dev/null',
          'alice-uta --help >/dev/null',
          "printf '__OPENALICE_%s_OK__\\\\n' 'CLI_MANIFESTS'",
          'git rev-parse --is-inside-work-tree | grep -qx true',
          "printf '__OPENALICE_%s_OK__\\\\n' 'GIT'",
          'alice-workspace issue create --id ' + shellIssueId + ' --title "OpenAlice shell CLI contract" >/dev/null',
          'alice-workspace issue show --id ' + shellIssueId + ' >/dev/null',
          // Split the sentinel so terminal command echo cannot satisfy it.
          "printf '__OPENALICE_%s_OK__\\\\n' 'WORKSPACE_CLI_CONTRACT'",
        ].join('; ')
        bridge.send(connectionId, new TextEncoder().encode(command + '\\r'))
        await marker
        checks.shellCliRoundTrip = true
      } finally {
        clearTimeout(attachedTimer)
        clearTimeout(markerTimer)
        offMessage()
        offClose()
        if (connectionId) bridge.close(connectionId)
      }
    }

    const tag = 'acceptance-' + Date.now().toString(36)
    let workspaceId = ''
    let shellSessionId = ''
    let failure = null
    try {
      const created = await json(await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tag, template: 'chat', agents: ['shell', 'pi'] }),
      }))
      workspaceId = created.workspace.id
      checks.workspaceCreated = true

      const spawned = await json(await fetch('/api/workspaces/' + encodeURIComponent(workspaceId) + '/sessions/spawn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent: 'shell' }),
      }))
      shellSessionId = spawned.sessionId
      await runShellContract(workspaceId, shellSessionId)

      const shellIssues = await json(await fetch('/api/issues'))
      if (!issueExists(shellIssues, workspaceId, shellIssueId)) {
        throw new Error('shell CLI issue side effect was not visible through /api/issues')
      }

      await json(await fetch('/api/workspaces/' + encodeURIComponent(workspaceId) + '/agent-config/pi', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseUrl: aiBaseUrl,
          apiKey: 'oa_test_ok',
          model: 'openalice-workspace-acceptance',
          wireShape: 'openai-chat',
        }),
      }))

      const headless = await json(await fetch('/api/workspaces/' + encodeURIComponent(workspaceId) + '/headless', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agent: 'pi',
          wait: true,
          timeoutMs: 120000,
          prompt: '${ACCEPTANCE_MARKER}: execute the requested Workspace CLI acceptance action, then report completion.',
        }),
      }))
      if (headless.killed || headless.exitCode !== 0) {
        throw new Error('managed Pi headless run failed: ' + JSON.stringify({
          exitCode: headless.exitCode,
          killed: headless.killed,
          stderrTail: headless.stderrTail,
        }))
      }
      if (headless.assistantText?.trim() !== '${ASSISTANT_TEXT}') {
        throw new Error('managed Pi assistant reply was not decoded: ' + JSON.stringify(headless.assistantText))
      }
      checks.managedPiAssistantReply = true

      const agentIssues = await json(await fetch('/api/issues'))
      if (!issueExists(agentIssues, workspaceId, agentIssueId)) {
        throw new Error('managed Pi CLI issue side effect was not visible through /api/issues')
      }
      checks.managedPiCliSideEffect = true
    } catch (err) {
      failure = err
    } finally {
      if (workspaceId && shellSessionId) {
        await fetch('/api/workspaces/' + encodeURIComponent(workspaceId) + '/sessions/' + encodeURIComponent(shellSessionId) + '/pause', {
          method: 'POST',
        }).catch(() => {})
      }
      if (workspaceId) {
        const deleted = await fetch('/api/workspaces/' + encodeURIComponent(workspaceId), { method: 'DELETE' }).catch(() => null)
        checks.cleanupComplete = Boolean(deleted?.ok)
      }
    }
    return {
      schemaVersion: 1,
      mode: 'packaged-electron',
      workspaceType: 'chat',
      runtime: 'pi',
      transport: 'electron-pty+tool-socket',
      workspaceId,
      durationMs: Date.now() - startedAt,
      ...(failure ? { error: failure.message || String(failure) } : {}),
      checks,
    }
  })()`, true) as Promise<WorkspaceAcceptanceReceipt>
}
