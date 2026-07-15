import type { BrowserWindow } from 'electron'

export interface DataHomeSmokeResult {
  readonly currentHome: string
  readonly source: string
  readonly selectionLock: string | null
  readonly rendered: boolean
}
export async function runRendererDataHomeSmoke(
  win: BrowserWindow,
): Promise<DataHomeSmokeResult> {
  return win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const waitFor = async (label, predicate, timeoutMs = 15000) => {
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

    await waitFor('data-home preload bridge', () => window.openAlice?.dataHome)
    const [runtime, status] = await Promise.all([
      window.openAlice.runtime.info(),
      window.openAlice.dataHome.getStatus(),
    ])
    if (runtime.userDataHome !== status.currentHome) {
      throw new Error('runtime and data-home status disagree')
    }

    window.history.pushState({}, '', '/settings')
    window.dispatchEvent(new PopStateEvent('popstate'))
    const current = await waitFor(
      'Settings data-location card',
      () => document.querySelector('[data-testid="data-home-current"]'),
    )
    if (current.textContent?.trim() !== status.currentHome) {
      throw new Error('Settings rendered a different data-home path')
    }
    const choose = document.querySelector('[data-testid="data-home-choose"]')
    if (!(choose instanceof HTMLButtonElement)) throw new Error('data-home choose button missing')
    if (status.selectionLocked && !choose.disabled) {
      throw new Error('environment-locked data-home chooser remained enabled')
    }

    return {
      currentHome: status.currentHome,
      source: status.source,
      selectionLock: status.selectionLock,
      rendered: true,
    }
  })()`, true) as Promise<DataHomeSmokeResult>
}
