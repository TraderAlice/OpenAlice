import { once } from 'node:events'
import { createServer } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { demoThemeImportFixtures } from '../../ui/src/demo/fixtures/themes.js'

const uiRoot = new URL('../../ui', import.meta.url).pathname
const viteCli = new URL('../../ui/node_modules/vite/bin/vite.js', import.meta.url).pathname
let vite: ChildProcess | undefined
let browser: Browser | undefined
let page: Page | undefined
let baseUrl = ''

async function availablePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Failed to allocate a browser E2E port')
  server.close()
  await once(server, 'close')
  return address.port
}

async function waitForServer(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Demo Vite exited before becoming ready (${child.exitCode})`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // The child has not bound its socket yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for demo Vite at ${url}`)
}

async function upload(page: Page, fixture: { filename: string; contents: string }): Promise<void> {
  await page.locator('[data-testid="theme-import-panel"] input[type=file]').setInputFiles({
    name: fixture.filename,
    mimeType: 'text/plain',
    buffer: Buffer.from(fixture.contents),
  })
}

describe('Theme Manager real-browser workflow', () => {
  beforeAll(async () => {
    const port = await availablePort()
    baseUrl = `http://127.0.0.1:${port}`
    vite = spawn(process.execPath, [
      viteCli, '--mode', 'demo', '--host', '127.0.0.1', '--port', String(port), '--strictPort',
    ], {
      cwd: uiRoot,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    await waitForServer(`${baseUrl}/settings`, vite)
    // CI and developer machines already carry Chrome; using the installed
    // channel keeps `pnpm test:e2e` self-contained instead of downloading a
    // second ~160 MB browser during every clean dependency install.
    browser = await chromium.launch({ headless: true, channel: 'chrome' })
    const context = await browser.newContext({ locale: 'en-US', colorScheme: 'dark' })
    page = await context.newPage()
  }, 45_000)

  afterAll(async () => {
    await browser?.close()
    if (vite !== undefined && vite.exitCode === null) {
      vite.kill('SIGTERM')
      await Promise.race([once(vite, 'exit'), new Promise((resolve) => setTimeout(resolve, 5_000))])
      if (vite.exitCode === null) vite.kill('SIGKILL')
    }
  }, 10_000)

  it('previews common formats, applies one through Settings, and survives reload', async () => {
    if (page === undefined) throw new Error('Browser setup did not create a page')
    const testPage = page
    await testPage.goto(`${baseUrl}/settings`)
    const manager = testPage.getByTestId('theme-manager')
    await expect.poll(async () => manager.isVisible()).toBe(true)

    const validFixtures = demoThemeImportFixtures.filter((fixture) => fixture.invalid !== true)
    expect(validFixtures.map((fixture) => fixture.format)).toEqual(expect.arrayContaining([
      'tinted-base16', 'legacy-base16', 'tinted-base24', 'flat-base24', 'iterm2',
      'windows-terminal', 'alacritty', 'kitty-ghostty', 'xresources',
    ]))

    // Every supported source shape travels through the actual file chooser and
    // production-format importer exposed by the demo API, not a DOM fixture.
    for (const fixture of validFixtures) {
      await upload(testPage, fixture)
      const preview = testPage.getByTestId('theme-import-preview')
      await expect.poll(async () => preview.isVisible()).toBe(true)
      await expect.poll(async () => preview.textContent()).toContain(fixture.format)
      await preview.locator('button').first().click() // Cancel, then try the next real file.
      await expect.poll(async () => preview.count()).toBe(0)
    }

    const selected = validFixtures.find((fixture) => fixture.format === 'tinted-base24')
    if (selected === undefined) throw new Error('Demo fixture set has no Base24 import')
    await upload(testPage, selected)
    const preview = testPage.getByTestId('theme-import-preview')
    await expect.poll(async () => preview.isVisible()).toBe(true)
    await preview.locator('button').last().click() // Save import.
    await expect.poll(async () => preview.count()).toBe(0)

    // The demo backend deliberately derives the imported display name from
    // the source filename, matching the anonymous terminal-format path.
    await manager.getByRole('button', { name: 'demo-base24', exact: false }).click()
    await manager.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect.poll(async () => manager.getByText('Theme applied.', { exact: true }).isVisible()).toBe(true)
    await expect.poll(async () => testPage.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim())).toBe('#101216')
    await expect.poll(async () => testPage.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim())).toBe('#75a7f0')

    const ansi = testPage.getByTestId('ansi-grid').locator('[data-ansi-index]')
    const extended = testPage.getByTestId('extended-ansi-grid').locator('[data-ansi-index]')
    await expect.poll(async () => ansi.count()).toBe(16)
    await expect.poll(async () => extended.count()).toBe(6)
    expect(await ansi.nth(0).getAttribute('data-color')).toBe('#101216')
    expect(await ansi.nth(15).getAttribute('data-color')).toBe('#ffffff')
    expect(await extended.nth(0).getAttribute('data-color')).toBe('#e89b58')
    expect(await extended.nth(5).getAttribute('data-color')).toBe('#edf0f5')

    const xterm = testPage.getByTestId('xterm-theme-preview')
    await expect.poll(async () => xterm.locator('.xterm-screen').count()).toBe(1)
    await expect.poll(async () => xterm.locator('.xterm-rows').textContent()).toContain('ANSI 0-7')

    await testPage.reload()
    await expect.poll(async () => testPage.getByTestId('theme-manager').isVisible()).toBe(true)
    await expect.poll(async () => testPage.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim())).toBe('#101216')
    await expect.poll(async () => testPage.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim())).toBe('#75a7f0')
    await expect.poll(async () => testPage.getByRole('button', { name: /demo-base24.*Active/i }).count()).toBe(1)
  }, 60_000)
})
