import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, type Page } from '@playwright/test'
import { validateScenarioCoverage } from './scenario-catalog.js'
import { themeColorScenarios } from './scenarios.js'
import type { RuntimeColorWorklist, ScenarioAction, ThemeColorScenario } from './types.js'

const root = resolve(import.meta.dirname, '../..')
const baseUrl = 'http://127.0.0.1:5173'

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
  return spawn('pnpm', ['-F', 'open-alice-ui', 'dev:demo', '--host', '127.0.0.1'], { cwd: root, stdio: 'inherit', detached: true, env: { ...process.env, OPENALICE_UI_PORT: '5173' } })
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await fetch(baseUrl)).ok) return } catch { /* starting */ }
    await delay(250)
  }
  throw new Error('demo server did not become ready')
}

async function ready(page: Page, scenario: ThemeColorScenario): Promise<void> {
  const locator = scenario.ready.role === 'main' ? page.getByRole('main') : page.getByRole(scenario.ready.role, { name: scenario.ready.name, exact: true }).last()
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
      const page = await browser.newPage()
      const pageErrors: string[] = []
      page.on('pageerror', (error) => pageErrors.push(error.message))
      for (const scenario of themeColorScenarios) {
        pageErrors.length = 0
        await page.setViewportSize(scenario.viewport)
        await page.setExtraHTTPHeaders(scenario.fixtureProfile === 'demo' ? {} : { 'x-openalice-theme-audit-fixture': scenario.fixtureProfile, 'x-openalice-theme-audit-run': scenario.scenarioId })
        const route = scenario.fixtureProfile === 'demo' ? scenario.route : `${scenario.route}${scenario.route.includes('?') ? '&' : '?'}themeAuditFixture=${encodeURIComponent(scenario.fixtureProfile)}`
        await page.goto(`${baseUrl}${route}`, { waitUntil: scenario.collectBeforeNetworkIdle ? 'domcontentloaded' : 'networkidle' })
        if (new URL(page.url()).pathname !== scenario.route) throw new Error(`${scenario.scenarioId}: redirected to ${page.url()}`)
        for (const item of scenario.actions) await action(page, item)
        await ready(page, scenario)
        if (pageErrors.length > 0) throw new Error(`${scenario.scenarioId}: page errors: ${pageErrors.join('; ')}`)
        console.log(`scenario ${scenario.scenarioId}: ready (${scenario.inventoryIds.length} IDs)`)
      }
    } finally { await browser.close() }
  } finally { if (child.pid) process.kill(-child.pid, 'SIGTERM') }
} else throw new Error(`unknown scenario command: ${command ?? '<missing>'}`)
