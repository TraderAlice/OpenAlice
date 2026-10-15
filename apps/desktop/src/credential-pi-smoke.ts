import type { BrowserWindow } from 'electron'

export async function runRendererCredentialPiSmoke(win: BrowserWindow): Promise<void> {
  const aiBaseUrl = process.env.OPENALICE_ONBOARDING_AI_BASE_URL
  if (!aiBaseUrl || !/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(aiBaseUrl)) throw new Error('credential-pi acceptance requires a local deterministic AI mock')
  const result = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const json = async (res) => {
      const text = await res.text()
      let body = null
      try { body = text ? JSON.parse(text) : null } catch { body = text }
      if (!res.ok) throw new Error(res.status + ' ' + text)
      return body
    }
    const waitFor = async (label, predicate, timeoutMs = 12000) => {
      const deadline = Date.now() + timeoutMs
      let last = null
      while (Date.now() < deadline) {
        try {
          const value = await predicate()
          if (value) return value
        } catch (err) {
          last = err
        }
        await sleep(100)
      }
      throw new Error('Timed out waiting for ' + label + (last ? ': ' + (last.message || String(last)) : ''))
    }

    await waitFor('Electron preload bridge', () => Boolean(
      window.openAlice?.runtime && window.openAlice?.pty && window.openAlice?.dataHome && window.openAlice?.updater
    ))

    const runtimeInfo = await window.openAlice.runtime.info()
    const dataHomeStatus = await window.openAlice.dataHome.getStatus()
    if (dataHomeStatus.currentHome !== runtimeInfo.userDataHome) {
      throw new Error('data-home bridge disagrees with runtime info')
    }
    if (dataHomeStatus.source !== 'environment' || dataHomeStatus.selectionLock !== 'openalice-home-env') {
      throw new Error('isolated packaged smoke should be locked by OPENALICE_HOME')
    }

    // This acceptance starts inside a selected project, bypassing the launcher. Workspace setup
    // happens after the renderer opens; no retired wizard controls are involved.
    await waitFor('product navigation', () => document.querySelector('[data-testid="activity-bar"]'))
    await waitFor('asynchronous Chat preparation', async () => {
      const setup = await json(await fetch('/api/workspaces/project-setup'))
      if (setup.errors?.chat) throw new Error(setup.errors.chat)
      const workspaceList = await json(await fetch('/api/workspaces'))
      return !setup.pending?.includes('chat') && workspaceList.workspaces?.some(ws => ws.template === 'chat')
    }, 60000)

    const agents = await json(await fetch('/api/workspaces/agents'))
    const pi = agents.agents?.find((agent) => agent.id === 'pi')
    if (!pi?.installed) throw new Error('managed Pi was not detected by packaged /agents')

    const tradingStatus = await json(await fetch('/api/trading/status'))
    if (tradingStatus.mode !== 'lite') {
      throw new Error('expected credential-pi acceptance trading mode to be lite, got ' + tradingStatus.mode)
    }

    const request = async (url, body, method = 'POST') => json(await fetch(url, {
      method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }))
    const workspaceList = await json(await fetch('/api/workspaces'))
    const chat = workspaceList.workspaces.find(ws => ws.template === 'chat')
    const workspaceUrl = '/api/workspaces/' + encodeURIComponent(chat.id)
    const vault = await json(await fetch('/api/config/credentials'))
    if (vault.credentials.length !== 0) throw new Error('credential-pi acceptance unexpectedly has credentials')
    await request('/api/agent-runtimes/readiness/probe', { agent: 'pi' })
    const missing = await waitFor('fresh Pi missing native login', async () => {
      const snapshot = await json(await fetch('/api/agent-runtimes/readiness'))
      const row = snapshot.agents?.pi
      return row && row.status !== 'unknown' && row.status !== 'checking' ? row : null
    }, 60000)
    if (missing.ready !== false || !['failed', 'auth_required', 'provider_required'].includes(missing.status)) {
      throw new Error('unexpected fresh Pi readiness: ' + JSON.stringify(missing))
    }

    // Drive the actual Add/Test/Save form. Read the vault back only to verify
    // persistence and select the saved binding for the native headless turn.
    const credential = { baseUrl: ${JSON.stringify(aiBaseUrl)}, apiKey: 'oa_test_ok', model: 'openalice-onboarding-test' }
    history.pushState({}, '', '/settings/ai-provider')
    window.dispatchEvent(new PopStateEvent('popstate'))
    const find = selector => document.querySelector(selector)
    const click = async selector => {
      const button = await waitFor(selector, () => {
        const node = find(selector)
        return node && !node.disabled ? node : null
      })
      button.click()
      await sleep(0)
    }
    const fill = async (selector, value) => {
      const input = await waitFor(selector, () => find(selector))
      const prototype = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
      await sleep(0)
    }
    await click('[data-testid="credential-add"]')
    await click('[data-credential-preset="custom"]')
    const modal = '[data-testid="credential-modal-scroll"] '
    await fill(modal + 'input[maxlength="80"]', 'Credential + Pi acceptance')
    await fill(modal + 'select', 'openai-chat')
    await fill(modal + 'input[placeholder="https://provider.example/v1"]', credential.baseUrl)
    await fill(modal + 'input[type="password"]', 'oa_test_invalid')
    await fill(modal + 'input[role="combobox"]', credential.model)
    await click('[data-testid="credential-modal-primary"]')
    await waitFor('rejected test key', () => find('[data-testid="credential-test-result"][data-ok="false"]'))
    if ((await json(await fetch('/api/config/credentials'))).credentials.length !== 0) {
      throw new Error('failed credential test persisted a credential')
    }
    await fill(modal + 'input[type="password"]', credential.apiKey)
    await click('[data-testid="credential-modal-primary"]')
    await waitFor('successful credential test', () => find('[data-testid="credential-test-result"][data-ok="true"]'))
    await click('[data-testid="credential-modal-primary"]')
    await waitFor('credential modal saved and closed', () => !find('[data-testid="credential-modal-scroll"]'))
    const persisted = await json(await fetch('/api/config/credentials'))
    const saved = persisted.credentials.find(row => row.label === 'Credential + Pi acceptance')
    if (!saved?.slug || saved.lastModel !== credential.model || saved.wires?.['openai-chat'] !== credential.baseUrl) {
      throw new Error('credential-pi credential was not saved')
    }
    // Bind the executor through the test API, not the runtime-selection UI.
    const preference = { defaultAgent: 'pi', agents: { pi: {
      accessMode: 'vault', credentialSlug: saved.slug, model: credential.model,
    } } }
    await request(workspaceUrl + '/runtime-settings', { interactive: preference, headless: preference }, 'PUT')
    await request('/api/agent-runtimes/readiness/probe', { agent: 'pi' })
    const readiness = await waitFor('configured Pi runtime readiness result', async () => {
      const snapshot = await json(await fetch('/api/agent-runtimes/readiness'))
      const row = snapshot.agents?.pi
      return row && row.status !== 'unknown' && row.status !== 'checking' ? row : null
    }, 60000)
    if (readiness.status !== 'ready' || readiness.ready !== true || readiness.source !== 'launcher-vault') {
      throw new Error('configured native Pi readiness failed: ' + JSON.stringify(readiness))
    }
    // Exercise native Pi execution, not the browser Chat composer.
    const reply = await request(workspaceUrl + '/headless', {
      agent: 'pi', prompt: 'Reply with a short greeting. Do not use tools.', wait: true, timeoutMs: 45000,
    })
    if (reply.exitCode !== 0 || reply.killed || reply.assistantText?.trim() !== 'OpenAlice packaged runtime is ready.') {
      throw new Error('credential-pi native headless reply failed: ' + JSON.stringify({ exitCode: reply.exitCode, killed: reply.killed, assistantReply: Boolean(reply.assistantText) }))
    }

    return {
      ok: true,
      assistantReply: true,
      piPath: pi.binPath || null,
      runtimeStatus: readiness.status,
      runtimeSource: readiness.source,
      tradingMode: tradingStatus.mode,
      dataHome: dataHomeStatus.currentHome,
    }
  })()`, true) as {
    ok?: boolean
    assistantReply?: boolean
    piPath?: string | null
    runtimeStatus?: string
    runtimeSource?: string
    tradingMode?: string
    dataHome?: string
  }
  if (result.ok !== true || result.assistantReply !== true) throw new Error('incomplete credential-pi acceptance')
  console.log(
    `[guardian] electron smoke credential-pi → ok binding=api reply=headless mode=${result.tradingMode ?? ''} pi=${result.piPath ?? 'managed'} runtime=${result.runtimeStatus ?? ''}/${result.runtimeSource ?? ''} data=${result.dataHome ?? ''}`,
  )
}
