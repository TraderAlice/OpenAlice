import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { runInNewContext } from 'node:vm'
import { runRendererCredentialPiSmoke } from './credential-pi-smoke.js'

afterEach(() => vi.unstubAllEnvs())

async function run(overrides: { status?: string; source?: string; reply?: string | null } = {}) {
  vi.stubEnv('OPENALICE_ONBOARDING_AI_BASE_URL', 'http://127.0.0.1:1234/v1')
  let probes = 0
  let saved = false
  let chatRuns = 0
  const fetch = async (url: string, init?: { body?: string }) => {
    const input = init?.body ? JSON.parse(init.body) : null
    let body: unknown
    if (url.endsWith('/project-setup')) body = { pending: [] }
    else if (url === '/api/workspaces') body = { workspaces: [{ id: 'chat', template: 'chat' }] }
    else if (url.endsWith('/agents')) body = { agents: [{ id: 'pi', installed: true }] }
    else if (url.endsWith('/trading/status')) body = { mode: 'lite' }
    else if (url.endsWith('/credentials')) {
      if (input) { saved = true; body = { slug: 'smoke' } }
      else body = { credentials: saved ? [{ slug: 'smoke', label: 'Credential + Pi acceptance', lastModel: 'openalice-onboarding-test', wires: { 'openai-chat': 'http://127.0.0.1:1234/v1' } }] : [] }
    } else if (url.endsWith('/readiness/probe')) { probes++; body = {} }
    else if (url.endsWith('/readiness')) body = { agents: { pi: probes === 1
      ? { status: 'failed', ready: false, source: 'global-login' }
      : { status: overrides.status ?? 'ready', ready: (overrides.status ?? 'ready') === 'ready', source: overrides.source ?? 'launcher-vault' } } }
    else if (url.endsWith('/runtime-settings')) body = {}
    else if (url.endsWith('/headless')) { chatRuns++; body = { exitCode: 0, killed: false, assistantText: overrides.reply === undefined ? 'OpenAlice packaged runtime is ready.' : overrides.reply } }
    else throw new Error('Unexpected request ' + url)
    return { ok: true, text: async () => JSON.stringify(body) }
  }
  const bridge = { runtime: { info: async () => ({ userDataHome: '/isolated' }) }, pty: {}, updater: {},
    dataHome: { getStatus: async () => ({ currentHome: '/isolated', source: 'environment', selectionLock: 'openalice-home-env' }) } }
  const dom = new JSDOM(`<div data-testid="activity-bar"></div><button data-testid="credential-add"></button>
    <button data-credential-preset="custom"></button><div data-testid="credential-modal-scroll">
    <input maxlength="80"><select><option value="openai-chat">Chat</option></select>
    <input placeholder="https://provider.example/v1"><input type="password"><input role="combobox">
    </div><button data-testid="credential-modal-primary"></button>`, { url: 'http://localhost' })
  const document = dom.window.document
  let tested = false
  document.querySelector('[data-testid="credential-modal-primary"]')!.addEventListener('click', () => {
    if (tested) {
      saved = true
      document.querySelector('[data-testid="credential-modal-scroll"]')!.remove()
      return
    }
    const key = (document.querySelector('input[type="password"]') as HTMLInputElement).value
    const ok = key === 'oa_test_ok'
    document.querySelector('[data-testid="credential-test-result"]')?.remove()
    const result = document.createElement('div')
    result.dataset.testid = 'credential-test-result'
    result.dataset.ok = String(ok)
    document.body.append(result)
    tested = ok
  })
  const win = { webContents: { executeJavaScript: (source: string) => runInNewContext(source, {
    window: Object.assign(dom.window, { openAlice: bridge }), document, fetch,
    history: dom.window.history, PopStateEvent: dom.window.PopStateEvent,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLSelectElement: dom.window.HTMLSelectElement,
    Event: dom.window.Event, setTimeout,
  }) } }
  try { await runRendererCredentialPiSmoke(win as never) } finally { dom.window.close() }
  return { probes, saved, chatRuns }
}

describe('credential + native Pi execution acceptance verdict', () => {
  it('requires persisted credentials, configured readiness and a separate native headless reply', async () => {
    expect(await run()).toEqual({ probes: 2, saved: true, chatRuns: 1 })
  })
  it('rejects failed/global-login even when the process could exit zero', async () => {
    await expect(run({ status: 'failed', source: 'global-login' })).rejects.toThrow('readiness failed')
  })
  it('rejects a successful process without an assistant reply', async () => {
    await expect(run({ reply: null })).rejects.toThrow('native headless reply failed')
  })
})
