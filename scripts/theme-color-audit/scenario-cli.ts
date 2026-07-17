import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, type Page } from '@playwright/test'
import { assertScenarioPath, validateScenarioCoverage } from './scenario-catalog.js'
import { themeColorScenarios } from './scenarios.js'
import type { RuntimeColorWorklist, ScenarioAction, ThemeColorScenario } from './types.js'

const root = resolve(import.meta.dirname, '../..')
const auditPort = Number.parseInt(process.env['OPENALICE_THEME_AUDIT_PORT'] ?? '41731', 10)
const baseUrl = `http://127.0.0.1:${auditPort}`

async function action(page: Page, item: ScenarioAction): Promise<void> {
  if (item.kind === 'wait') { await page.waitForTimeout(item.milliseconds); return }
  if (item.kind === 'select') { await page.locator('select').nth(item.index).selectOption(item.value); return }
  if (item.kind === 'click-css') { await page.locator(item.selector).filter({ hasText: item.text }).first().click(); return }
  if (item.kind === 'hover-css') { await page.locator(item.selector).first().hover(); return }
  if (item.kind === 'focus-css') { await page.locator(item.selector).first().focus(); return }
  if (item.kind === 'fill-css') { await page.locator(item.selector).first().fill(item.value); return }
  if (item.kind === 'fill') { await page.getByPlaceholder(item.placeholder, { exact: true }).fill(item.value); return }
  const role = page.getByRole(item.role, { name: item.name, exact: item.exact ?? true }).first()
  const locator = await role.count() > 0 ? role : page.getByText(item.name, { exact: item.exact ?? true }).first()
  if (item.kind === 'click') await locator.click()
  else if (item.kind === 'hover') await locator.hover()
  else await locator.focus()
}

function server(): ChildProcess {
  return spawn('pnpm', ['-F', 'open-alice-ui', 'exec', 'vite', '--mode', 'demo', '--config', '../scripts/theme-color-audit/audit-vite.config.ts'], { cwd: root, stdio: 'inherit', detached: true, env: { ...process.env, OPENALICE_UI_PORT: String(auditPort), OPENALICE_THEME_AUDIT_PORT: String(auditPort), VITE_OPENALICE_FIRST_RUN_GUIDE: '1' } })
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { const response = await fetch(baseUrl); if (response.ok && (await response.text()).includes('__OPENALICE_THEME_COLOR_CONSUME__')) return } catch { /* starting */ }
    await delay(250)
  }
  throw new Error('demo server did not become ready')
}

async function ready(page: Page, scenario: ThemeColorScenario): Promise<void> {
  const locator = scenario.ready.role === 'main' ? page.getByRole('main').last() : page.getByRole(scenario.ready.role, { name: scenario.ready.name, exact: true }).last()
  await locator.waitFor({ state: 'visible' })
}

const command = process.argv[2]
const worklist = JSON.parse(await readFile(resolve(root, '.artifacts/theme-color-audit/runtime-worklist.json'), 'utf8')) as RuntimeColorWorklist
if (command === 'coverage') {
  validateScenarioCoverage(worklist)
  console.log(`validated ${worklist.items.length} explicit inventory-to-scenario assignments`)
} else if (command === 'browser') {
  validateScenarioCoverage(worklist)
  const child = server()
  try {
    await waitForServer()
    const browser = await chromium.launch({ headless: true, channel: process.env['PLAYWRIGHT_CHANNEL'] ?? 'chrome' })
    try {
      for (const scenario of themeColorScenarios) {
        const context = await browser.newContext({ viewport: scenario.viewport })
        const page = await context.newPage(); const pageErrors: string[] = []
        try {
          page.on('pageerror', (error) => pageErrors.push(error.message))
          if (scenario.fixtureProfile !== 'demo') {
            await page.setExtraHTTPHeaders({ 'x-openalice-theme-audit-fixture': scenario.fixtureProfile, 'x-openalice-theme-audit-run': scenario.scenarioId })
            await page.addInitScript(({ fixture, auditRun }) => {
              if (fixture === 'first-run-locked' || fixture === 'first-run-no-uta') window.sessionStorage.setItem('__OPENALICE_AUDIT_ONBOARDING_SEARCH__', '?onboardingStep=broker')
              if (fixture === 'market-search-variants') window.localStorage.setItem('openalice.watchlist.v1', JSON.stringify({ state: { entries: [{ assetClass: 'crypto', symbol: 'BTC-USD', addedAt: 2 }, { assetClass: 'commodity', symbol: 'GC=F', addedAt: 1 }] }, version: 1 }))
              const originalFetch = globalThis.fetch.bind(globalThis)
              globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
                const request = new Request(input, init); const headers = new Headers(request.headers)
                headers.set('x-openalice-theme-audit-fixture', fixture); headers.set('x-openalice-theme-audit-run', auditRun)
                return originalFetch(new Request(request, { headers }))
              }
            }, { fixture: scenario.fixtureProfile, auditRun: scenario.scenarioId })
          }
          if (scenario.fixtureProfile.startsWith('terminal-')) await page.addInitScript((fixture) => {
            ;(globalThis as typeof globalThis & { __name?: (value: unknown) => unknown }).__name = (value) => value
            type Listener = (event?: { data?: unknown; code?: number }) => void
            class AuditWebSocket {
              static readonly OPEN = 1; readonly OPEN = 1; readyState = 0; binaryType = 'arraybuffer'
              private readonly listeners = new Map<string, Listener[]>()
              constructor(_url: string) {
                const emit = (type: string, event?: { data?: unknown; code?: number }): void => { for (const listener of this.listeners.get(type) ?? []) listener(event) }
                if (fixture === 'terminal-connecting') return
                setTimeout(() => { this.readyState = 1; emit('open'); if (fixture !== 'terminal-connected') setTimeout(() => { this.readyState = 3; emit('close', { code: fixture === 'terminal-kicked' ? 4001 : fixture === 'terminal-locked' ? 4409 : fixture === 'terminal-closed' ? 4404 : 1006 }) }, 40) }, 20)
              }
              addEventListener(type: string, listener: Listener): void { const current = this.listeners.get(type) ?? []; current.push(listener); this.listeners.set(type, current) }
              send(_data: unknown): void {}
              close(): void { this.readyState = 3 }
            }
            Object.assign(globalThis, { __OPENALICE_AUDIT_WEBSOCKET__: AuditWebSocket })
          }, scenario.fixtureProfile)
          const route = scenario.fixtureProfile === 'demo' ? scenario.route : `${scenario.route}${scenario.route.includes('?') ? '&' : '?'}themeAuditFixture=${encodeURIComponent(scenario.fixtureProfile)}`
          await page.goto(`${baseUrl}${route}`, { waitUntil: scenario.collectBeforeNetworkIdle ? 'domcontentloaded' : 'networkidle' })
          assertScenarioPath(scenario.scenarioId, scenario.route, page.url())
          for (const item of scenario.actions) await action(page, item)
          await ready(page, scenario)
          if (pageErrors.length > 0) throw new Error(`${scenario.scenarioId}: page errors: ${pageErrors.join('; ')}`)
          console.log(`scenario ${scenario.scenarioId}: ready (${scenario.inventoryIds.length} IDs)`)
        } finally { await context.close() }
      }
    } finally { await browser.close() }
  } finally { if (child.pid) process.kill(-child.pid, 'SIGTERM') }
} else throw new Error(`unknown scenario command: ${command ?? '<missing>'}`)
