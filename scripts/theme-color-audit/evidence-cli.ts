import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, type Locator, type Page } from '@playwright/test'
import { imageSize } from 'image-size'
import { version as playwrightVersion } from '@playwright/test/package.json'
import { evidenceImageName, sha256, sortEvidence, validateEvidenceContent, validateOccurrenceEvidenceRecord, validateOccurrenceJpeg } from './evidence.js'
import { themeColorScenarios } from './scenarios.js'
import type { OccurrenceEvidenceRecord, PixelBounds, RuntimeBindingManifest, RuntimeColorBinding, ScenarioAction, StaticColorManifest, ThemeColorEvidenceBundle, ThemeColorScenario } from './types.js'

const root = resolve(import.meta.dirname, '../..')
const baseUrl = 'http://127.0.0.1:5173'
const artifactRoot = resolve(root, '.artifacts/theme-color-audit')
const imageRoot = resolve(artifactRoot, 'evidence')
const bundlePath = resolve(artifactRoot, 'evidence-bundle.json')

function startServer(): ChildProcess {
  return spawn('pnpm', ['-F', 'open-alice-ui', 'exec', 'vite', '--mode', 'demo', '--config', '../scripts/theme-color-audit/audit-vite.config.ts'], {
    cwd: root, stdio: ['ignore', 'inherit', 'inherit'], detached: true,
    env: { ...process.env, OPENALICE_UI_PORT: '5173' },
  })
}

function positiveTarget(binding: RuntimeColorBinding): binding is RuntimeColorBinding & { target: NonNullable<RuntimeColorBinding['target']> } {
  return binding.active && binding.actualValue.trim().length > 0 && binding.target !== null && binding.target.width > 0 && binding.target.height > 0
}

function isCssVariableDefinition(source: StaticColorManifest['occurrences'][number], binding: RuntimeColorBinding): boolean {
  return binding.channel.startsWith('--') || source.ownerHint?.startsWith('--') === true || (source.path.endsWith('.css') && binding.target?.selector === 'html' && binding.channel.startsWith('--'))
}

function chooseVisualBindings(manifest: RuntimeBindingManifest, sourceById: ReadonlyMap<string, StaticColorManifest['occurrences'][number]>): Map<string, { binding: RuntimeColorBinding; index: number }> {
  const selected = new Map<string, { binding: RuntimeColorBinding; index: number }>()
  manifest.bindings.forEach((binding, index) => {
    const source = sourceById.get(binding.inventoryId)
    if (source && positiveTarget(binding) && !isCssVariableDefinition(source, binding) && !selected.has(binding.inventoryId)) selected.set(binding.inventoryId, { binding, index })
  })
  return selected
}

async function locateTarget(page: Page, binding: RuntimeColorBinding & { target: NonNullable<RuntimeColorBinding['target']> }): Promise<PixelBounds> {
  await page.evaluate(() => window.scrollTo(0, 0))
  const candidates = page.locator(binding.target.selector)
  const count = await candidates.count()
  let bestIndex: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < count; index += 1) {
    const box = await candidates.nth(index).boundingBox()
    if (!box || box.width <= 0 || box.height <= 0) continue
    const distance = Math.abs(box.x - binding.target.x) + Math.abs(box.y - binding.target.y) + Math.abs(box.width - binding.target.width) + Math.abs(box.height - binding.target.height)
    if (distance < bestDistance) { bestIndex = index; bestDistance = distance }
  }
  if (bestIndex === null) throw new Error(`${binding.inventoryId}: locator has no positive-area target: ${binding.target.selector}`)
  const target = candidates.nth(bestIndex)
  await target.scrollIntoViewIfNeeded()
  const best = await target.boundingBox()
  if (!best || best.width <= 0 || best.height <= 0) throw new Error(`${binding.inventoryId}: target disappeared after scrolling`)
  return best
}

async function annotatedEvidence(
  page: Page,
  binding: RuntimeColorBinding & { target: NonNullable<RuntimeColorBinding['target']> },
  bindingIndex: number,
  source: StaticColorManifest['occurrences'][number],
  scenario: ThemeColorScenario,
): Promise<OccurrenceEvidenceRecord> {
  const targetBounds = await locateTarget(page, binding)
  const label = `${binding.inventoryId} · ${binding.channel}`
  await page.evaluate(({ bounds, label }) => {
    const overlay = document.createElement('div')
    overlay.id = 'openalice-color-audit-annotation'
    overlay.dataset['label'] = label
    Object.assign(overlay.style, {
      position: 'fixed', left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${bounds.width}px`, height: `${bounds.height}px`,
      border: '3px solid #ff2d55', boxSizing: 'border-box', zIndex: '2147483647', pointerEvents: 'none',
    })
    const badge = document.createElement('div')
    badge.textContent = label
    Object.assign(badge.style, {
      position: 'absolute', left: '0', top: bounds.y >= 24 ? '-24px' : '0', maxWidth: '720px',
      background: '#ff2d55', color: '#fff', font: 'bold 12px/20px monospace', padding: '1px 5px', whiteSpace: 'nowrap',
    })
    overlay.append(badge); document.body.append(overlay)
  }, { bounds: targetBounds, label })
  try {
    const safeId = binding.inventoryId.replace(/[^a-zA-Z0-9-]/g, '-')
    const stem = `annotations/${safeId}--${binding.scenarioId}--${binding.theme}`
    const contextRelativePath = `${stem}--context.jpg`
    const contextContent = await page.screenshot({ type: 'jpeg', quality: 80, animations: 'disabled' })
    await writeFile(resolve(artifactRoot, contextRelativePath), contextContent)
    const contextSize = imageSize(contextContent)
    if (!contextSize.width || !contextSize.height) throw new Error(`${binding.inventoryId}: context dimensions unavailable`)
    const padding = 24
    const cropBounds = {
      x: Math.max(0, targetBounds.x - padding), y: Math.max(0, targetBounds.y - padding),
      width: Math.min(scenario.viewport.width - Math.max(0, targetBounds.x - padding), targetBounds.width + padding * 2),
      height: Math.min(scenario.viewport.height - Math.max(0, targetBounds.y - padding), targetBounds.height + padding * 2),
    }
    if (cropBounds.width <= 0 || cropBounds.height <= 0) throw new Error(`${binding.inventoryId}: crop is outside viewport`)
    const cropRelativePath = `${stem}--crop.jpg`
    const cropContent = await page.screenshot({ type: 'jpeg', quality: 80, animations: 'disabled', clip: cropBounds })
    await writeFile(resolve(artifactRoot, cropRelativePath), cropContent)
    const cropSize = imageSize(cropContent)
    if (!cropSize.width || !cropSize.height) throw new Error(`${binding.inventoryId}: crop dimensions unavailable`)
    return {
      kind: 'visual-element', inventoryId: binding.inventoryId, source, bindingIndex,
      scenarioId: binding.scenarioId, theme: binding.theme, state: scenario.state, surfaceKind: binding.surfaceKind,
      channel: binding.channel, actualValue: binding.actualValue, locator: binding.target.selector,
      viewport: scenario.viewport, deviceScaleFactor: 1, targetBounds,
      annotation: { label, color: '#ff2d55', bounds: targetBounds },
      context: { relativePath: contextRelativePath, sha256: sha256(contextContent), format: 'jpeg', quality: 80, width: contextSize.width, height: contextSize.height },
      crop: {
        relativePath: cropRelativePath, sha256: sha256(cropContent), format: 'jpeg', quality: 80, width: cropSize.width, height: cropSize.height,
        targetBoundsInImage: { x: targetBounds.x - cropBounds.x, y: targetBounds.y - cropBounds.y, width: targetBounds.width, height: targetBounds.height },
      },
    }
  } finally {
    await page.locator('#openalice-color-audit-annotation').evaluate((element) => element.remove()).catch(() => undefined)
  }
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
  const sourceById = new Map(staticManifest.occurrences.map((entry) => [entry.inventoryId, entry]))
  const visualBindings = chooseVisualBindings(runtimeManifest, sourceById)

  await mkdir(imageRoot, { recursive: true })
  await mkdir(resolve(artifactRoot, 'annotations'), { recursive: true })
  const server = startServer()
  const images: ThemeColorEvidenceBundle['images'][number][] = []
  const occurrenceRecords: OccurrenceEvidenceRecord[] = []
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
          for (const [inventoryId, selected] of visualBindings) {
            if (selected.binding.scenarioId !== scenario.scenarioId || selected.binding.theme !== theme) continue
            const source = sourceById.get(inventoryId)
            if (!source) throw new Error(`${inventoryId}: source occurrence missing`)
            occurrenceRecords.push(await annotatedEvidence(page, selected.binding, selected.index, source, scenario))
          }
          console.log(`captured ${scenario.scenarioId}/${theme}: ${inventoryIds.length} occurrences`)
          await page.close()
        }
      }
    } finally { await browser.close() }
    const bundle: ThemeColorEvidenceBundle = {
      schemaVersion: 2, sourceCommit: staticManifest.sourceCommit,
      staticManifestSchemaVersion: staticManifest.schemaVersion,
      runtimeBindingSchemaVersion: runtimeManifest.schemaVersion,
      playwrightVersion, browserVersion, images: sortEvidence(images), occurrenceRecords,
    }
    const recorded = new Set(occurrenceRecords.map((record) => record.inventoryId))
    const indexesById = new Map<string, number[]>()
    runtimeManifest.bindings.forEach((binding, index) => {
      const indexes = indexesById.get(binding.inventoryId) ?? []; indexes.push(index); indexesById.set(binding.inventoryId, indexes)
    })
    for (const source of staticManifest.occurrences.filter((entry) => entry.sourceClass === 'runtime')) {
      if (recorded.has(source.inventoryId)) continue
      const indexes = indexesById.get(source.inventoryId) ?? []
      const bindings = indexes.map((index) => runtimeManifest.bindings[index]!)
      const active = bindings.filter((binding) => binding.active)
      const variableDefinition = active.find((binding) => isCssVariableDefinition(source, binding))
      occurrenceRecords.push({
        kind: 'non-visual-probe', inventoryId: source.inventoryId, source, bindingIndexes: indexes,
        reason: variableDefinition
          ? 'css-variable-definition'
          : active.some((binding) => binding.surfaceKind === 'runtime-value')
          ? 'runtime-value'
          : active.length === 0 ? 'inactive-in-scenario' : 'no-positive-area-target',
      })
    }
    occurrenceRecords.sort((left, right) => left.inventoryId.localeCompare(right.inventoryId))
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

async function jpegHasAnnotation(page: Page, content: Buffer): Promise<boolean> {
  return page.evaluate(async (url) => {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    const context = canvas.getContext('2d'); if (!context) return false
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let matches = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index]! > 210 && pixels[index + 1]! < 110 && pixels[index + 2]! < 150) matches += 1
      if (matches >= 20) return true
    }
    return false
  }, `data:image/jpeg;base64,${content.toString('base64')}`)
}

async function inspectAnnotations(bundle: ThemeColorEvidenceBundle): Promise<void> {
  const browser = await chromium.launch({ headless: true, channel: process.env['PLAYWRIGHT_CHANNEL'] ?? 'chrome' })
  try {
    const page = await browser.newPage()
    for (const record of bundle.occurrenceRecords) {
      validateOccurrenceEvidenceRecord(record)
      if (record.kind !== 'visual-element') continue
      for (const role of ['context', 'crop'] as const) {
        const content = await readFile(resolve(artifactRoot, record[role].relativePath))
        validateOccurrenceJpeg(record, role, content)
        if (!await jpegHasAnnotation(page, content)) throw new Error(`${record.inventoryId}: ${role} JPEG has no visible annotation pixels`)
      }
    }
  } finally { await browser.close() }
}

async function checkBundle(bundle: ThemeColorEvidenceBundle): Promise<void> {
  const staticManifest = JSON.parse(await readFile(resolve(artifactRoot, 'static-manifest.json'), 'utf8')) as StaticColorManifest
  const runtimeManifest = JSON.parse(await readFile(resolve(artifactRoot, 'runtime-bindings.json'), 'utf8')) as RuntimeBindingManifest
  if (bundle.sourceCommit !== staticManifest.sourceCommit) throw new Error('evidence bundle is stale')
  const runtimeIds = new Set(staticManifest.occurrences.filter((entry) => entry.sourceClass === 'runtime').map((entry) => entry.inventoryId))
  const evidenced = new Set(bundle.images.flatMap((image) => image.inventoryIds))
  const missing = [...runtimeIds].filter((id) => !evidenced.has(id))
  if (missing.length > 0) throw new Error(`runtime occurrences without screenshot evidence: ${missing.join(', ')}`)
  if (bundle.images.length !== themeColorScenarios.reduce((sum, scenario) => sum + scenario.themes.length, 0)) throw new Error('scenario/theme image matrix is incomplete')
  if (bundle.schemaVersion !== 2) throw new Error(`unsupported evidence schema: ${bundle.schemaVersion}`)
  const records = new Map<string, OccurrenceEvidenceRecord>()
  for (const record of bundle.occurrenceRecords) {
    if (records.has(record.inventoryId)) throw new Error(`duplicate occurrence evidence: ${record.inventoryId}`)
    records.set(record.inventoryId, record); validateOccurrenceEvidenceRecord(record)
    if (record.kind === 'visual-element') {
      const binding = runtimeManifest.bindings[record.bindingIndex]
      if (!binding || binding.inventoryId !== record.inventoryId || !positiveTarget(binding)) throw new Error(`${record.inventoryId}: annotation references invalid visual binding`)
      if (isCssVariableDefinition(record.source, binding)) throw new Error(`${record.inventoryId}: CSS variable definition cannot be visual component evidence`)
      if (binding.surfaceKind === 'dom-element' && !record.locator.startsWith('#') && !record.locator.includes(record.inventoryId)) throw new Error(`${record.inventoryId}: DOM locator does not identify current occurrence`)
    } else {
      const bindings = record.bindingIndexes.map((index) => runtimeManifest.bindings[index]).filter((binding): binding is RuntimeColorBinding => binding !== undefined)
      if (bindings.length !== record.bindingIndexes.length || bindings.some((binding) => binding.inventoryId !== record.inventoryId)) throw new Error(`${record.inventoryId}: non-visual binding reference mismatch`)
      const active = bindings.filter((binding) => binding.active)
      if (record.reason === 'inactive-in-scenario' && active.length > 0) throw new Error(`${record.inventoryId}: active binding mislabeled inactive`)
      if (record.reason === 'runtime-value' && !active.some((binding) => binding.surfaceKind === 'runtime-value')) throw new Error(`${record.inventoryId}: runtime-value reason has no active value probe`)
      if (record.reason === 'css-variable-definition' && !active.some((binding) => isCssVariableDefinition(record.source, binding))) throw new Error(`${record.inventoryId}: CSS variable definition classification mismatch`)
      if (record.reason === 'no-positive-area-target' && (active.length === 0 || active.some(positiveTarget))) throw new Error(`${record.inventoryId}: non-visual target classification mismatch`)
    }
  }
  const missingRecords = [...runtimeIds].filter((id) => !records.has(id))
  if (missingRecords.length > 0 || records.size !== runtimeIds.size) throw new Error(`occurrence evidence does not exactly cover runtime inventory: ${missingRecords.join(', ')}`)
  await inspectImages(bundle)
}

const command = process.argv[2]
if (command === 'capture') {
  const bundle = await generateBundle()
  await checkBundle(bundle)
  const visual = bundle.occurrenceRecords.filter((record) => record.kind === 'visual-element').length
  console.log(`captured ${bundle.images.length} scenario JPEGs, ${visual} annotated visual occurrence pairs, and ${bundle.occurrenceRecords.length - visual} explicit non-visual records`)
} else if (command === 'check') {
  const bundle = await readBundle(); await checkBundle(bundle)
  console.log(`validated evidence bundle with ${bundle.images.length} images`)
} else if (command === 'inspect-images') {
  const bundle = await readBundle(); await inspectImages(bundle)
  console.log(`validated ${bundle.images.length} JPEG files`)
} else if (command === 'check-annotations') {
  const bundle = await readBundle(); await checkBundle(bundle); await inspectAnnotations(bundle)
  const visual = bundle.occurrenceRecords.filter((record) => record.kind === 'visual-element').length
  console.log(`validated ${visual} annotated visual occurrences and ${bundle.occurrenceRecords.length - visual} explicit non-visual probes`)
} else throw new Error(`unknown evidence command: ${command ?? '<missing>'}`)
