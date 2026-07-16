import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, type Locator, type Page } from '@playwright/test'
import { imageSize } from 'image-size'
import { version as playwrightVersion } from '@playwright/test/package.json'
import { evidenceImageName, sha256, sortEvidence, validateEvidenceContent } from './evidence.js'
import { themeColorScenarios } from './scenarios.js'
import type { RuntimeBindingManifest, ScenarioAction, StaticColorManifest, ThemeColorEvidenceBundle, ThemeColorScenario } from './types.js'

const root = resolve(import.meta.dirname, '../..')
const baseUrl = 'http://127.0.0.1:5173'
const artifactRoot = resolve(root, '.artifacts/theme-color-audit')
const imageRoot = resolve(artifactRoot, 'evidence')
const bundlePath = resolve(artifactRoot, 'evidence-bundle.json')

function startServer(): ChildProcess {
  return spawn('pnpm', ['-F', 'open-alice-ui', 'dev:demo', '--host', '127.0.0.1'], {
    cwd: root, stdio: ['ignore', 'inherit', 'inherit'], detached: true,
    env: { ...process.env, OPENALICE_UI_PORT: '5173' },
  })
}

function stopServer(server: ChildProcess): void {
  if (server.pid) process.kill(-server.pid, 'SIGTERM')
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await fetch(baseUrl)).ok) return } catch { /* starting */ }
    await delay(250)
  }
  throw new Error('demo server did not become ready')
}

async function act(page: Page, action: ScenarioAction): Promise<void> {
  const locator = page.getByRole(action.role, { name: action.name, exact: true }).first()
  if (action.kind === 'click') await locator.click()
  else if (action.kind === 'hover') await locator.hover()
  else await locator.focus()
}

async function readyLocator(page: Page, scenario: ThemeColorScenario): Promise<Locator> {
  if (scenario.scenarioId === 'connectors-normal') {
    const connector = page.getByText('Connector Service', { exact: true }).last()
    await connector.waitFor({ state: 'visible', timeout: 10_000 })
    return connector.locator('xpath=ancestor::div[2]')
  }
  const ready = scenario.ready.role === 'main'
    ? page.locator('main').last()
    : page.getByRole(scenario.ready.role, { name: scenario.ready.name, exact: true }).last()
  await ready.waitFor({ state: 'visible', timeout: 10_000 })
  if (scenario.state === 'dialog-overlay') return ready.locator('xpath=ancestor::div[2]')
  return page.locator('main').last()
}

async function generateBundle(): Promise<ThemeColorEvidenceBundle> {
  if (process.env['OPENALICE_THEME_AUDIT_REUSE_BINDINGS'] !== '1') {
    const staticRun = spawnSync('pnpm', ['audit:theme-colors:scan'], { cwd: root, stdio: 'inherit' })
    if (staticRun.status !== 0) throw new Error(`static inventory prerequisite failed: ${staticRun.status}`)
    const bindingRun = spawnSync('pnpm', ['audit:theme-colors:check-runtime-bindings'], { cwd: root, stdio: 'inherit' })
    if (bindingRun.status !== 0) throw new Error(`runtime binding prerequisite failed: ${bindingRun.status}`)
  }
  const staticManifest = JSON.parse(await readFile(resolve(artifactRoot, 'static-manifest.json'), 'utf8')) as StaticColorManifest
  const runtimeManifest = JSON.parse(await readFile(resolve(artifactRoot, 'runtime-bindings.json'), 'utf8')) as RuntimeBindingManifest
  if (staticManifest.sourceCommit !== runtimeManifest.sourceCommit) throw new Error('static/runtime manifest commit mismatch')
  const sourcePathById = new Map(staticManifest.occurrences.map((entry) => [entry.inventoryId, entry.path]))

  await mkdir(imageRoot, { recursive: true })
  const server = startServer()
  const images: ThemeColorEvidenceBundle['images'][number][] = []
  try {
    await waitForServer()
    const browser = await chromium.launch({ headless: true, channel: process.env['PLAYWRIGHT_CHANNEL'] ?? 'chrome' })
    const browserVersion = browser.version()
    try {
      for (const scenario of themeColorScenarios) {
        for (const theme of scenario.themes) {
          const page = await browser.newPage({ viewport: scenario.viewport, deviceScaleFactor: 1 })
          const pageErrors: string[] = []
          page.on('pageerror', (error) => pageErrors.push(error.message))
          await page.addInitScript((selectedTheme) => localStorage.setItem('openalice.theme.v1', JSON.stringify({ state: { theme: selectedTheme }, version: 1 })), theme)
          await page.goto(`${baseUrl}${scenario.route}`, { waitUntil: 'networkidle' })
          for (const action of scenario.actions) await act(page, action)
          const target = await readyLocator(page, scenario)
          await page.evaluate(() => document.fonts.ready)
          const relativePath = `evidence/${evidenceImageName(scenario.scenarioId, theme)}`
          const absolutePath = resolve(artifactRoot, relativePath)
          const box = await target.boundingBox()
          if (!box) throw new Error(`${scenario.scenarioId}/${theme}: target has no bounding box`)
          const x = Math.max(0, box.x)
          const y = Math.max(0, box.y)
          const width = Math.min(box.width - (x - box.x), scenario.viewport.width - x)
          const height = Math.min(box.height - (y - box.y), scenario.viewport.height - y)
          if (width <= 0 || height <= 0) throw new Error(`${scenario.scenarioId}/${theme}: target is outside viewport`)
          const content = await page.screenshot({ type: 'jpeg', quality: 80, animations: 'disabled', clip: { x, y, width, height } })
          await writeFile(absolutePath, content)
          const size = imageSize(content)
          if (!size.width || !size.height) throw new Error(`${relativePath}: JPEG dimensions unavailable`)
          if (pageErrors.length > 0) throw new Error(`${scenario.scenarioId}/${theme}: page errors: ${pageErrors.join('; ')}`)
          const scenarioPaths = new Set<string>(['ui/src/index.css', ...scenario.sourcePaths])
          const inventoryIds = [...new Set(runtimeManifest.bindings
            .filter((binding) => binding.scenarioId === scenario.scenarioId && binding.theme === theme)
            .filter((binding) => scenarioPaths.has(sourcePathById.get(binding.inventoryId) ?? ''))
            .map((binding) => binding.inventoryId))].sort()
          images.push({
            scenarioId: scenario.scenarioId, theme, state: scenario.state, relativePath, sha256: sha256(content),
            format: 'jpeg', quality: 80, width: size.width, height: size.height, viewport: scenario.viewport,
            deviceScaleFactor: 1, inventoryIds,
          })
          console.log(`captured ${scenario.scenarioId}/${theme}: ${inventoryIds.length} occurrences`)
          await page.close()
        }
      }
    } finally { await browser.close() }
    const bundle: ThemeColorEvidenceBundle = {
      schemaVersion: 1, sourceCommit: staticManifest.sourceCommit,
      staticManifestSchemaVersion: staticManifest.schemaVersion,
      runtimeBindingSchemaVersion: runtimeManifest.schemaVersion,
      playwrightVersion, browserVersion, images: sortEvidence(images),
    }
    await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`)
    return bundle
  } finally { stopServer(server) }
}

async function readBundle(): Promise<ThemeColorEvidenceBundle> {
  return JSON.parse(await readFile(bundlePath, 'utf8')) as ThemeColorEvidenceBundle
}

async function inspectImages(bundle: ThemeColorEvidenceBundle): Promise<void> {
  for (const image of bundle.images) {
    const content = await readFile(resolve(artifactRoot, image.relativePath))
    validateEvidenceContent(image, content)
  }
}

async function checkBundle(bundle: ThemeColorEvidenceBundle): Promise<void> {
  const staticManifest = JSON.parse(await readFile(resolve(artifactRoot, 'static-manifest.json'), 'utf8')) as StaticColorManifest
  if (bundle.sourceCommit !== staticManifest.sourceCommit) throw new Error('evidence bundle is stale')
  const runtimeIds = new Set(staticManifest.occurrences.filter((entry) => entry.sourceClass === 'runtime').map((entry) => entry.inventoryId))
  const evidenced = new Set(bundle.images.flatMap((image) => image.inventoryIds))
  const missing = [...runtimeIds].filter((id) => !evidenced.has(id))
  if (missing.length > 0) throw new Error(`runtime occurrences without screenshot evidence: ${missing.join(', ')}`)
  if (bundle.images.length !== themeColorScenarios.reduce((sum, scenario) => sum + scenario.themes.length, 0)) throw new Error('scenario/theme image matrix is incomplete')
  await inspectImages(bundle)
}

const command = process.argv[2]
if (command === 'capture') {
  const bundle = await generateBundle()
  await checkBundle(bundle)
  console.log(`captured ${bundle.images.length} component JPEGs covering all runtime occurrences`)
} else if (command === 'check') {
  const bundle = await readBundle(); await checkBundle(bundle)
  console.log(`validated evidence bundle with ${bundle.images.length} images`)
} else if (command === 'inspect-images') {
  const bundle = await readBundle(); await inspectImages(bundle)
  console.log(`validated ${bundle.images.length} JPEG files`)
} else throw new Error(`unknown evidence command: ${command ?? '<missing>'}`)
