import { once } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir } from 'node:fs/promises'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { AppearancePreferences } from '../../ui/src/api/themes.js'

const uiRoot = new URL('../../ui', import.meta.url).pathname
const viteCli = new URL('../../ui/node_modules/vite/bin/vite.js', import.meta.url).pathname
const screenshotRoot = new URL('../../.artifacts/issue-18-browser', import.meta.url).pathname
let vite: ChildProcess | undefined
let browser: Browser | undefined
let page: Page | undefined
let baseUrl = ''

async function availablePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Failed to allocate browser E2E port')
  server.close()
  await once(server, 'close')
  return address.port
}

async function waitForServer(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Demo Vite exited before ready (${child.exitCode})`)
    try {
      if ((await fetch(url)).ok) return
    } catch { /* not bound yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

type Policy = Pick<AppearancePreferences, 'mode' | 'marketColors' | 'marketDirection' | 'statusColors'>

async function applyPolicy(testPage: Page, policy: Policy): Promise<void> {
  const status = await testPage.evaluate(async (next) => {
    const { useThemeStore } = await (0, eval)('import("/src/theme/store.ts")') as {
      useThemeStore: { getState(): {
        appearance: AppearancePreferences | null
        status: string
        saveAppearance(value: AppearancePreferences): Promise<void>
      } }
    }
    const current = useThemeStore.getState().appearance
    if (current === null) throw new Error('Theme store was not initialized')
    await useThemeStore.getState().saveAppearance({ ...current, ...next })
    return useThemeStore.getState().status
  }, policy)
  expect(status).toBe('ready')
  await expect.poll(() => testPage.evaluate(() => ({
    mode: document.documentElement.dataset.theme,
    marketColors: document.documentElement.dataset.themeMarketColors,
    marketDirection: document.documentElement.dataset.themeMarketDirection,
    statusColors: document.documentElement.dataset.themeStatusColors,
  }))).toEqual({
    mode: policy.mode,
    marketColors: policy.marketColors,
    marketDirection: policy.marketDirection,
    statusColors: policy.statusColors,
  })
}

async function variables(testPage: Page): Promise<Record<string, string>> {
  return testPage.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    const names = [
      '--oa-market-up', '--oa-market-down', '--oa-market-positive', '--oa-market-negative',
      '--oa-market-buy', '--oa-market-sell', '--oa-market-volume-up', '--oa-market-volume-down',
      '--oa-status-success', '--oa-status-warning', '--oa-status-danger', '--oa-status-info',
      '--oa-risk-destructive', '--oa-risk-permission-denied', '--oa-risk-trade-confirm',
      '--oa-risk-broker-write-failed', '--oa-risk-risk-blocked',
    ]
    return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()]))
  })
}

describe('issue #18 color policy in a real browser', () => {
  beforeAll(async () => {
    const port = await availablePort()
    baseUrl = `http://127.0.0.1:${port}`
    vite = spawn(process.execPath, [viteCli, '--mode', 'demo', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: uiRoot,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    await waitForServer(`${baseUrl}/market/equity/AAPL`, vite)
    browser = await chromium.launch({ headless: true, channel: 'chrome' })
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1050 } })
    page = await context.newPage()
    await mkdir(screenshotRoot, { recursive: true })
  }, 45_000)

  afterAll(async () => {
    await browser?.close()
    if (vite !== undefined && vite.exitCode === null) {
      vite.kill('SIGTERM')
      await Promise.race([once(vite, 'exit'), new Promise((resolve) => setTimeout(resolve, 5_000))])
      if (vite.exitCode === null) vite.kill('SIGKILL')
    }
  }, 10_000)

  it('switches protected/theme directions without refetching or remounting K-line, and keeps risk meanings fixed', async () => {
    if (page === undefined) throw new Error('Browser setup failed')
    const testPage = page
    let barsRequests = 0
    testPage.on('request', (request) => { if (new URL(request.url()).pathname === '/api/bars') barsRequests += 1 })
    await testPage.goto(`${baseUrl}/market/equity/AAPL`)
    await expect.poll(() => testPage.getByText(/bars ·/).count()).toBe(1)
    await expect.poll(() => testPage.locator('canvas').count()).toBeGreaterThanOrEqual(2)
    const initialBarsRequests = barsRequests
    const canvasIdentity = await testPage.locator('canvas').evaluateAll((nodes) => nodes.map((node, index) => {
      const identity = `issue18-canvas-${index}`
      ;(node as HTMLCanvasElement & { __issue18Identity?: string }).__issue18Identity = identity
      return identity
    }))

    const combinations: Policy[] = [
      { mode: 'light', marketColors: 'protected', marketDirection: 'green-up-red-down', statusColors: 'protected' },
      { mode: 'light', marketColors: 'protected', marketDirection: 'red-up-green-down', statusColors: 'theme' },
      { mode: 'dark', marketColors: 'theme', marketDirection: 'green-up-red-down', statusColors: 'protected' },
      { mode: 'dark', marketColors: 'theme', marketDirection: 'red-up-green-down', statusColors: 'theme' },
    ]
    const snapshots: Record<string, string>[] = []
    for (const combination of combinations) {
      await applyPolicy(testPage, combination)
      const projected = await variables(testPage)
      snapshots.push(projected)
      expect(projected['--oa-market-positive']).toBe(projected['--oa-market-up'])
      expect(projected['--oa-market-negative']).toBe(projected['--oa-market-down'])
      expect(projected['--oa-market-buy']).toBe(projected['--oa-market-up'])
      expect(projected['--oa-market-sell']).toBe(projected['--oa-market-down'])
      expect(projected['--oa-market-volume-up']).toContain(projected['--oa-market-up'].slice(1))
      expect(projected['--oa-market-volume-down']).toContain(projected['--oa-market-down'].slice(1))
      const negativeQuote = testPage.getByText(/\(-0\.14%\)/)
      await expect.poll(() => negativeQuote.count()).toBe(1)
      expect(await negativeQuote.evaluate((node) => getComputedStyle(node).color)).toBe(
        await testPage.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--oa-market-negative').trim()
          .replace(/^#(.{2})(.{2})(.{2})$/, (_, r, g, b) => `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`)),
      )
    }

    // Direction flips swap every market channel. Source changes pick a new
    // green/red pair. Neither setting can bleed into safety colors.
    expect(snapshots[1]!['--oa-market-up']).toBe(snapshots[0]!['--oa-market-down'])
    expect(snapshots[1]!['--oa-market-down']).toBe(snapshots[0]!['--oa-market-up'])
    expect(snapshots[3]!['--oa-market-up']).toBe(snapshots[2]!['--oa-market-down'])
    expect(snapshots[3]!['--oa-market-down']).toBe(snapshots[2]!['--oa-market-up'])
    for (const name of ['--oa-risk-destructive', '--oa-risk-permission-denied', '--oa-risk-trade-confirm', '--oa-risk-broker-write-failed', '--oa-risk-risk-blocked']) {
      expect(snapshots[0]![name]).toBe(snapshots[1]![name])
      expect(snapshots[2]![name]).toBe(snapshots[3]![name])
    }
    expect(barsRequests).toBe(initialBarsRequests)
    expect(await testPage.locator('canvas').evaluateAll((nodes) => nodes.map((node) =>
      (node as HTMLCanvasElement & { __issue18Identity?: string }).__issue18Identity))).toEqual(canvasIdentity)

    // Exercise a real destructive consumer, not only the projected root var:
    // the tab ContextMenu's Close action must retain the protected risk color.
    await testPage.evaluate(async () => {
      const { useEditorTabsPref } = await (0, eval)('import("/src/live/editor-tabs-pref.ts")') as {
        useEditorTabsPref: { getState(): { setShowEditorTabs(value: boolean): void } }
      }
      useEditorTabsPref.getState().setShowEditorTabs(true)
    })
    const marketTab = testPage.locator('div.h-10').getByText('AAPL', { exact: true })
    await expect.poll(() => marketTab.count()).toBe(1)
    await marketTab.click({ button: 'right' })
    const close = testPage.getByRole('menuitem', { name: 'Close', exact: true })
    await expect.poll(() => close.count()).toBe(1)
    const destructiveColor = await close.evaluate((node) => getComputedStyle(node).color)
    expect(destructiveColor).toBe(await testPage.evaluate(() => {
      const color = getComputedStyle(document.documentElement).getPropertyValue('--oa-risk-destructive').trim()
      return color.replace(/^#(.{2})(.{2})(.{2})$/, (_, r, g, b) => `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`)
    }))
    await testPage.keyboard.press('Escape')
    await applyPolicy(testPage, { mode: 'dark', marketColors: 'protected', marketDirection: 'green-up-red-down', statusColors: 'protected' })
    await marketTab.click({ button: 'right' })
    await expect.poll(() => close.count()).toBe(1)
    expect(await close.evaluate((node) => getComputedStyle(node).color)).toBe(destructiveColor)
    await testPage.keyboard.press('Escape')
    await applyPolicy(testPage, combinations[3]!)

    await testPage.screenshot({ path: `${screenshotRoot}/market-dark-theme-red-up.png`, fullPage: true })
  }, 45_000)

  it('keeps visible PnL, Sparkline, BUY and SELL labels as non-color cues while their policy colors switch', async () => {
    if (page === undefined) throw new Error('Browser setup failed')
    const testPage = page
    await testPage.goto(`${baseUrl}/portfolio`)
    await expect.poll(() => testPage.getByText(/today|unrealized/).count()).toBeGreaterThan(0)
    await expect.poll(() => testPage.locator('svg path[stroke="var(--oa-market-up)"], svg path[stroke="var(--oa-market-down)"]').count()).toBeGreaterThan(0)
    const pnlCue = await testPage.getByText(/▲|▼/).first().textContent()
    expect(pnlCue).toMatch(/▲|▼/)
    await applyPolicy(testPage, { mode: 'light', marketColors: 'protected', marketDirection: 'green-up-red-down', statusColors: 'protected' })
    const first = await variables(testPage)
    await applyPolicy(testPage, { mode: 'light', marketColors: 'theme', marketDirection: 'red-up-green-down', statusColors: 'theme' })
    const second = await variables(testPage)
    expect(second['--oa-market-up']).not.toBe(first['--oa-market-up'])
    expect(second['--oa-status-success']).not.toBe(first['--oa-status-success'])
    expect(second['--oa-risk-destructive']).toBe(first['--oa-risk-destructive'])

    // Reuse the hydrated demo page. A fresh context has no persisted demo
    // appearance identity and would test onboarding rather than this surface.
    await testPage.setExtraHTTPHeaders({ 'x-openalice-theme-audit-fixture': 'trading-approval' })
    await testPage.goto(`${baseUrl}/trading-as-git?themeAuditFixture=trading-approval`)
    const buy = testPage.getByText('BUY NVDA', { exact: true })
    const sell = testPage.getByText('SELL TSLA', { exact: true })
    await expect.poll(() => buy.count(), { timeout: 10_000 }).toBe(1)
    await expect.poll(() => sell.count(), { timeout: 10_000 }).toBe(1)
    expect(await buy.textContent()).toBe('BUY NVDA')
    expect(await sell.textContent()).toBe('SELL TSLA')
    const buyRow = buy.locator('xpath=../../..')
    const sellRow = sell.locator('xpath=../../..')
    const buyMarker = buyRow.locator(':scope > div').first()
    const sellMarker = sellRow.locator(':scope > div').first()
    expect(await buyMarker.textContent()).toContain('+')
    expect(await sellMarker.textContent()).toContain('-')
    expect(await buyMarker.evaluate((node) => getComputedStyle(node).color)).not.toBe(
      await sellMarker.evaluate((node) => getComputedStyle(node).color),
    )
    await testPage.screenshot({ path: `${screenshotRoot}/trading-light-buy-sell-cues.png`, fullPage: true })
    await testPage.setExtraHTTPHeaders({})
  }, 45_000)
})
