import { once } from 'node:events'
import { createServer } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Browser, type BrowserContext, type ConsoleMessage, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { demoThemeImportFixtures } from '../../ui/src/demo/fixtures/themes.js'
import { demoThemeFamily } from '../../ui/src/demo/fixtures/themes.js'
import type { AppearanceMode, AppearancePreferences, ThemeFamily } from '../../ui/src/api/themes.js'

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

const firstPaintCacheKey = 'openalice.theme.first-paint.v1'

function customPairedFamily(suffix: string): ThemeFamily {
  const family = demoThemeFamily('tinted-base16', `Cold Paint ${suffix}`, ['light', 'dark'])
  family.id = `cold-paint-${suffix}`
  const light = family.variants.light
  const dark = family.variants.dark
  if (light === undefined || dark === undefined) throw new Error('Paired demo fixture omitted a variant')
  light.id = `${family.id}-light`
  light.tokens.pageBackground = '#faf1e8'
  light.tokens.accent = '#8a4b20'
  dark.id = `${family.id}-dark`
  dark.tokens.pageBackground = '#120f1c'
  dark.tokens.accent = '#c5a2ff'
  return family
}

function appearance(familyId: string, mode: AppearanceMode): AppearancePreferences {
  return {
    activeFamilyId: familyId,
    mode,
    terminal: { mode: 'follow' },
    marketColors: 'protected',
    marketDirection: 'green-up-red-down',
    statusColors: 'protected',
  }
}

async function putDemoTheme(page: Page, family: ThemeFamily, mode: AppearanceMode): Promise<void> {
  const result = await page.evaluate(async ({ familyPayload, appearancePayload }) => {
    const familyResponse = await fetch('/api/themes', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(familyPayload),
    })
    const appearanceResponse = await fetch('/api/themes/appearance', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(appearancePayload),
    })
    return { familyStatus: familyResponse.status, appearanceStatus: appearanceResponse.status }
  }, { familyPayload: family, appearancePayload: appearance(family.id, mode) })
  expect(result).toEqual({ familyStatus: 201, appearanceStatus: 200 })
  // Hydrate the production store from the demo API and let it write the exact
  // typed first-paint projection that the blocking HTML reader will replay.
  await page.reload()
  await expect.poll(async () => page.evaluate(() => document.documentElement.dataset.themeFamily)).toBe(family.id)
  await expect.poll(async () => page.evaluate((key) => localStorage.getItem(key) !== null, firstPaintCacheKey)).toBe(true)
}

interface FirstPaintSnapshot {
  theme: string | undefined
  appearance: string | undefined
  family: string | undefined
  variant: string | undefined
  background: string
  accent: string
  cachePresent: boolean
}

async function readWhileMainIsBlocked(page: Page): Promise<FirstPaintSnapshot> {
  let releaseMain!: () => void
  const release = new Promise<void>((resolve) => { releaseMain = resolve })
  let intercepted!: () => void
  const requestSeen = new Promise<void>((resolve) => { intercepted = resolve })
  await page.route('**/src/main.tsx*', async (route) => {
    intercepted()
    await release
    await route.continue()
  }, { times: 1 })

  try {
    await page.goto(`${baseUrl}/settings?cold=${Date.now()}`, { waitUntil: 'commit' })
    await intercepted
    // The route callback observes the module request when the preload scanner
    // reaches it; allow the already-fetched blocking classic script to finish
    // its synchronous cache replay before sampling the still-unhydrated DOM.
    await page.waitForTimeout(100)
    // The parser may already report `interactive` while the deferred module
    // is blocked, but React cannot have mounted: its sole entry module has not
    // received a byte and the app root remains empty. Therefore these values
    // can only have come from index.html's blocking boot script.
    expect(await page.evaluate(() => ({
      readyState: document.readyState,
      appChildren: document.getElementById('root')?.childElementCount,
    }))).toEqual({ readyState: 'interactive', appChildren: 0 })
    return await page.evaluate((key) => {
      const root = document.documentElement
      const style = getComputedStyle(root)
      return {
        theme: root.dataset.theme,
        appearance: root.dataset.themeAppearance,
        family: root.dataset.themeFamily,
        variant: root.dataset.themeVariant,
        background: style.getPropertyValue('--color-bg').trim(),
        accent: style.getPropertyValue('--color-accent').trim(),
        cachePresent: localStorage.getItem(key) !== null,
      }
    }, firstPaintCacheKey)
  } finally {
    releaseMain()
    await page.waitForLoadState('domcontentloaded')
    await page.unroute('**/src/main.tsx*')
  }
}

async function isolatedPage(colorScheme: 'light' | 'dark'): Promise<{ context: BrowserContext; page: Page }> {
  if (browser === undefined) throw new Error('Browser setup did not create a browser')
  const context = await browser.newContext({ locale: 'en-US', colorScheme })
  const testPage = await context.newPage()
  await testPage.goto(`${baseUrl}/settings`)
  await expect.poll(async () => testPage.getByTestId('theme-manager').isVisible()).toBe(true)
  return { context, page: testPage }
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

  it.each([
    { mode: 'light' as const, os: 'dark' as const, expectedBackground: '#faf1e8', expectedAccent: '#8a4b20' },
    { mode: 'dark' as const, os: 'light' as const, expectedBackground: '#120f1c', expectedAccent: '#c5a2ff' },
  ])('replays a custom $mode family before the React module can run', async ({ mode, os, expectedBackground, expectedAccent }) => {
    const { context, page: testPage } = await isolatedPage(os)
    try {
      const family = customPairedFamily(`${mode}-${Date.now()}`)
      await putDemoTheme(testPage, family, mode)
      const snapshot = await readWhileMainIsBlocked(testPage)
      expect(snapshot).toMatchObject({
        theme: mode,
        appearance: mode,
        family: family.id,
        variant: `${family.id}-${mode}`,
        background: expectedBackground,
        accent: expectedAccent,
        cachePresent: true,
      })
    } finally {
      await context.close()
    }
  }, 30_000)

  it.each([
    { os: 'light' as const, expectedBackground: '#faf1e8', expectedVariant: 'light' },
    { os: 'dark' as const, expectedBackground: '#120f1c', expectedVariant: 'dark' },
  ])('resolves system appearance against a cold $os OS before hydration', async ({ os, expectedBackground, expectedVariant }) => {
    const { context, page: testPage } = await isolatedPage(os)
    try {
      const family = customPairedFamily(`system-${os}-${Date.now()}`)
      await putDemoTheme(testPage, family, 'system')
      const snapshot = await readWhileMainIsBlocked(testPage)
      expect(snapshot).toMatchObject({
        theme: expectedVariant,
        appearance: 'system',
        family: family.id,
        variant: `${family.id}-${expectedVariant}`,
        background: expectedBackground,
        cachePresent: true,
      })
    } finally {
      await context.close()
    }
  }, 30_000)

  it('ignores OS changes in an explicit mode, follows them in system mode, and preserves mounted page state', async () => {
    const { context, page: testPage } = await isolatedPage('light')
    try {
      const first = customPairedFamily(`media-a-${Date.now()}`)
      const second = customPairedFamily(`media-b-${Date.now()}`)
      second.variants.light!.tokens.pageBackground = '#e6f7f1'
      expect(await testPage.evaluate(async (payload) => (await fetch('/api/themes', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      })).status, second)).toBe(201)
      await putDemoTheme(testPage, first, 'light')

      const manager = testPage.getByTestId('theme-manager')
      const legacyVariant = manager.getByLabel('Variant for files without metadata')
      await legacyVariant.selectOption('dark')
      const managerIdentity = await manager.evaluate((node) => {
        const id = `manager-${Date.now()}`
        ;(node as HTMLElement & { __mountIdentity?: string }).__mountIdentity = id
        return id
      })

      await testPage.emulateMedia({ colorScheme: 'dark' })
      await expect.poll(async () => testPage.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
      await expect.poll(async () => testPage.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim())).toBe('#faf1e8')

      // Select and apply through the real Settings UI. The locally selected
      // legacy-import option is an unrelated page-state canary.
      await manager.getByRole('button', { name: second.name, exact: false }).click()
      await manager.getByRole('button', { name: 'System', exact: true }).click()
      await manager.getByRole('button', { name: 'Apply', exact: true }).click()
      await expect.poll(async () => testPage.evaluate(() => document.documentElement.dataset.themeFamily)).toBe(second.id)
      expect(await manager.evaluate((node) => (node as HTMLElement & { __mountIdentity?: string }).__mountIdentity)).toBe(managerIdentity)
      expect(await legacyVariant.inputValue()).toBe('dark')

      await expect.poll(async () => testPage.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
      await testPage.emulateMedia({ colorScheme: 'light' })
      await expect.poll(async () => testPage.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
      await expect.poll(async () => testPage.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim())).toBe('#e6f7f1')
    } finally {
      await context.close()
    }
  }, 30_000)

  it.each([
    {
      label: 'stale',
      corrupt: (raw: string) => JSON.stringify({ ...JSON.parse(raw) as object, mappingVersion: 999 }),
      diagnostic: 'version mismatch',
    },
    { label: 'malformed', corrupt: () => '{not-json', diagnostic: 'Evicted stale cache' },
  ])('evicts a $label first-paint cache and emits a boot diagnostic', async ({ corrupt, diagnostic }) => {
    const { context, page: testPage } = await isolatedPage('light')
    const warnings: ConsoleMessage[] = []
    testPage.on('console', (message) => {
      if (message.text().includes('[theme:first-paint]')) warnings.push(message)
    })
    try {
      const family = customPairedFamily(`invalid-cache-${Date.now()}-${diagnostic.length}`)
      await putDemoTheme(testPage, family, 'light')
      await testPage.evaluate(({ key, corruption }) => {
        const current = localStorage.getItem(key)
        if (current === null) throw new Error('Runtime did not create a first-paint cache')
        localStorage.setItem(key, corruption)
      }, {
        key: firstPaintCacheKey,
        corruption: await testPage.evaluate(({ key }) => {
          const current = localStorage.getItem(key)
          if (current === null) throw new Error('Runtime did not create a first-paint cache')
          return current
        }, { key: firstPaintCacheKey }).then(corrupt),
      })

      const snapshot = await readWhileMainIsBlocked(testPage)
      expect(snapshot.cachePresent).toBe(false)
      expect(snapshot.family).toBeUndefined()
      await expect.poll(() => warnings.map((message) => message.text()).join('\n')).toContain(diagnostic)
    } finally {
      await context.close()
    }
  }, 30_000)
})
