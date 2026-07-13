import type { BrowserWindow } from 'electron'

export interface TradingModeSmokeResult {
  readonly initialMode: string
  readonly activeMode: string
  readonly activeStartedAt: string
  readonly finalMode: string
}

export async function runRendererTradingModeSmoke(
  win: BrowserWindow,
): Promise<TradingModeSmokeResult> {
  return win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const json = async (res) => {
      const text = await res.text()
      let body = null
      try { body = text ? JSON.parse(text) : null } catch { body = text }
      if (!res.ok) throw new Error(res.status + ' ' + text)
      return body
    }
    const waitFor = async (label, predicate, timeoutMs = 30000) => {
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
    const putMode = async (base, mode) => json(await fetch('/api/config/trading', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...base, mode }),
    }))

    await waitFor('Electron preload bridge', () => Boolean(window.openAlice?.runtime))
    const initial = await json(await fetch('/api/trading/status'))
    if (initial.mode !== 'lite' || initial.available !== false) {
      throw new Error('expected fresh lite mode without UTA, got ' + JSON.stringify(initial))
    }

    const tradingConfig = await json(await fetch('/api/config/trading'))
    await putMode(tradingConfig, 'readonly')
    const active = await waitFor('readonly UTA startup', async () => {
      const status = await json(await fetch('/api/trading/status'))
      return status.mode === 'readonly' && status.available === true && status.startedAt
        ? status
        : null
    })

    await putMode(tradingConfig, 'lite')
    const final = await waitFor('lite mode restore', async () => {
      const status = await json(await fetch('/api/trading/status'))
      return status.mode === 'lite' && status.available === false ? status : null
    })
    await sleep(500)

    return {
      initialMode: initial.mode,
      activeMode: active.mode,
      activeStartedAt: active.startedAt,
      finalMode: final.mode,
    }
  })()`, true) as Promise<TradingModeSmokeResult>
}
