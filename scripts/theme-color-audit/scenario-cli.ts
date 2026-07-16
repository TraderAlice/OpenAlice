import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { resolve } from 'node:path'
import { chromium, type Page } from '@playwright/test'
import { buildStaticManifest } from './static-inventory.js'
import { resolveScenarioCoverage, validateScenarioCatalog } from './scenario-catalog.js'
import { themeColorScenarios } from './scenarios.js'
import type { ScenarioAction, ThemeColorScenario } from './types.js'

const root = resolve(import.meta.dirname, '../..')
const baseUrl = process.env['OPENALICE_THEME_AUDIT_URL'] ?? 'http://127.0.0.1:5173'

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(baseUrl)
      if (response.ok) return
    } catch { /* server is still starting */ }
    await delay(250)
  }
  throw new Error(`demo server did not become ready: ${baseUrl}`)
}

function startServer(): ChildProcess {
  return spawn('pnpm', ['-F', 'open-alice-ui', 'dev:demo', '--host', '127.0.0.1'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OPENALICE_UI_PORT: '5173' },
  })
}

async function runAction(page: Page, action: ScenarioAction): Promise<void> {
  const locator = page.getByRole(action.role, { name: action.name, exact: true }).first()
  if (action.kind === 'click') await locator.click()
  else if (action.kind === 'hover') await locator.hover()
  else await locator.focus()
}

async function assertReady(page: Page, scenario: ThemeColorScenario): Promise<void> {
  const locator = scenario.ready.role === 'main'
    ? page.getByRole('main')
    : page.getByRole(scenario.ready.role, { name: scenario.ready.name, exact: true }).last()
  await locator.waitFor({ state: 'visible', timeout: 10_000 })
  if (await locator.count() !== 1) throw new Error(`${scenario.scenarioId}: ready locator is not unique`)
}

async function checkBrowserScenarios(): Promise<void> {
  const ownedServer = process.env['OPENALICE_THEME_AUDIT_URL'] === undefined
  const server = ownedServer ? startServer() : null
  try {
    await waitForServer()
    const browser = await chromium.launch({ headless: true, channel: process.env['PLAYWRIGHT_CHANNEL'] ?? 'chrome' })
    try {
      const page = await browser.newPage()
      for (const scenario of themeColorScenarios) {
        await page.setViewportSize(scenario.viewport)
        await page.goto(`${baseUrl}${scenario.route}`, { waitUntil: 'domcontentloaded' })
        for (const action of scenario.actions) await runAction(page, action)
        await assertReady(page, scenario)
        if (new URL(page.url()).pathname !== scenario.route) {
          throw new Error(`${scenario.scenarioId}: route redirected to ${page.url()}`)
        }
        console.log(`scenario ${scenario.scenarioId}: ready`)
      }
    } finally {
      await browser.close()
    }
  } finally {
    if (server) server.kill('SIGTERM')
  }
}

const command = process.argv[2]
if (command === 'validate') {
  validateScenarioCatalog()
  console.log(`validated ${themeColorScenarios.length} typed scenarios`)
} else if (command === 'coverage') {
  const resolved = resolveScenarioCoverage(await buildStaticManifest(root))
  const ids = new Set(resolved.flatMap((scenario) => scenario.inventoryIds))
  console.log(`resolved ${resolved.length} scenarios covering ${ids.size} runtime occurrences`)
} else if (command === 'browser') {
  await checkBrowserScenarios()
} else {
  throw new Error(`unknown scenario command: ${command ?? '<missing>'}`)
}
