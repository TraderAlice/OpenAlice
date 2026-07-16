import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, type Page } from '@playwright/test'
import postcss from 'postcss'
import { buildStaticManifest } from './static-inventory.js'
import { themeColorScenarios } from './scenarios.js'
import type { RuntimeBindingManifest, RuntimeColorBinding, ScenarioAction, StaticColorOccurrence } from './types.js'

const root = resolve(import.meta.dirname, '../..')
const baseUrl = 'http://127.0.0.1:5173'
const output = resolve(root, '.artifacts/theme-color-audit/runtime-bindings.json')

function startServer(): ChildProcess {
  return spawn('pnpm', ['-F', 'open-alice-ui', 'exec', 'vite', '--mode', 'demo', '--config', '../scripts/theme-color-audit/audit-vite.config.ts'], {
    cwd: root, stdio: ['ignore', 'inherit', 'inherit'], detached: true, env: { ...process.env, OPENALICE_UI_PORT: '5173' },
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
  throw new Error('audit Vite server did not become ready')
}

async function act(page: Page, action: ScenarioAction): Promise<void> {
  const locator = page.getByRole(action.role, { name: action.name, exact: true }).first()
  if (action.kind === 'click') await locator.click()
  else if (action.kind === 'hover') await locator.hover()
  else await locator.focus()
}

function channelFor(occurrence: StaticColorOccurrence): string {
  if (occurrence.syntaxKind === 'tailwind-palette-utility') {
    const prefix = occurrence.sourceText.split('-')[0]
    return ({ bg: 'background-color', text: 'color', border: 'border-color', fill: 'fill', stroke: 'stroke' } as Record<string, string>)[prefix!] ?? 'computed-style'
  }
  return 'computed-style'
}

async function cssBindingMetadata(runtime: readonly StaticColorOccurrence[]): Promise<Map<string, { selector: string; channel: string }>> {
  const result = new Map<string, { selector: string; channel: string }>()
  const cssPaths = [...new Set(runtime.filter((entry) => entry.path.endsWith('.css')).map((entry) => entry.path))]
  for (const path of cssPaths) {
    const source = await readFile(resolve(root, path), 'utf8')
    const entries = runtime.filter((entry) => entry.path === path)
    const parsed = postcss.parse(source, { from: path })
    parsed.walkDecls((declaration) => {
      const start = declaration.source?.start?.offset
      const end = declaration.source?.end?.offset
      if (start === undefined || end === undefined) return
      const parent = declaration.parent
      const selector = parent?.type === 'rule' ? parent.selector : parent?.type === 'atrule' && parent.name === 'theme' ? ':root' : ''
      if (!selector) return
      for (const entry of entries) {
        if (entry.span.startOffset >= start && entry.span.startOffset <= end) result.set(entry.inventoryId, { selector, channel: declaration.prop })
      }
    })
  }
  return result
}

async function collect(page: Page, scenarioId: string, theme: 'light' | 'dark', runtime: readonly StaticColorOccurrence[]): Promise<RuntimeColorBinding[]> {
  const cssMetadata = await cssBindingMetadata(runtime)
  const metadata = runtime.map((entry) => ({ id: entry.inventoryId, sourceText: entry.sourceText, syntaxKind: entry.syntaxKind, channel: channelFor(entry), css: cssMetadata.get(entry.inventoryId) }))
  return page.evaluate(({ metadata, scenarioId, theme }) => {
    const result: RuntimeColorBinding[] = []
    for (const item of metadata) {
      if (item.css) {
        let matchedCssTarget = false
        for (const candidate of item.css.selector.split(',')) {
          const pseudoMatch = candidate.match(/::(?:before|after)$/)
          const pseudo = pseudoMatch?.[0] ?? null
          const query = candidate.trim().replace(/::(?:before|after)$/, '')
          let elements: Element[] = []
          try { elements = [...document.querySelectorAll(query)] } catch { continue }
          for (const element of elements) {
          matchedCssTarget = true
          const style = getComputedStyle(element, pseudo)
          const rect = element.getBoundingClientRect()
          const audit = element.getAttribute('data-openalice-color-audit')?.split(' ')[0]
          const selector = element.id ? `#${CSS.escape(element.id)}` : audit ? `[data-openalice-color-audit~="${audit}"]` : element.tagName.toLowerCase()
          result.push({ inventoryId: item.id, scenarioId, theme, surfaceKind: 'css-rule', channel: item.css.channel, actualValue: style.getPropertyValue(item.css.channel), active: true, target: { selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height } })
          }
        }
        if (!matchedCssTarget) result.push({ inventoryId: item.id, scenarioId, theme, surfaceKind: 'css-rule', channel: item.css.channel, actualValue: item.sourceText, active: false, target: null })
      }
      for (const element of document.querySelectorAll(`[data-openalice-color-audit~="${item.id}"]`)) {
        const style = getComputedStyle(element)
        const classActive = item.syntaxKind !== 'tailwind-palette-utility' || element.className.toString().split(/\s+/).includes(item.sourceText)
        const rect = element.getBoundingClientRect()
        const audit = element.getAttribute('data-openalice-color-audit')?.split(' ')[0]
        const selector = element.id ? `#${CSS.escape(element.id)}` : audit ? `[data-openalice-color-audit~="${audit}"]` : element.tagName.toLowerCase()
        result.push({ inventoryId: item.id, scenarioId, theme, surfaceKind: 'dom-element', channel: item.channel, actualValue: style.getPropertyValue(item.channel), active: classActive, target: { selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height } })
      }
      const values = (globalThis as typeof globalThis & { __OPENALICE_THEME_COLOR_VALUES__?: Map<string, { value: string; active: boolean }> }).__OPENALICE_THEME_COLOR_VALUES__
      const value = values?.get(item.id)
      if (value !== undefined) result.push({ inventoryId: item.id, scenarioId, theme, surfaceKind: 'runtime-value', channel: 'value', actualValue: value.value, active: value.active, target: null })
    }
    return result
  }, { metadata, scenarioId, theme })
}

async function buildBindings(): Promise<RuntimeBindingManifest> {
  const staticManifest = await buildStaticManifest(root)
  const runtime = staticManifest.occurrences.filter((entry) => entry.sourceClass === 'runtime')
  const server = startServer()
  try {
    await waitForServer()
    const browser = await chromium.launch({ headless: true, channel: process.env['PLAYWRIGHT_CHANNEL'] ?? 'chrome' })
    const bindings: RuntimeColorBinding[] = []
    try {
      const page = await browser.newPage()
      for (const scenario of themeColorScenarios) {
        for (const theme of scenario.themes) {
          console.log(`binding ${scenario.scenarioId} ${theme}`)
          await page.addInitScript((selectedTheme) => localStorage.setItem('openalice.theme.v1', JSON.stringify({ state: { theme: selectedTheme }, version: 1 })), theme)
          await page.setViewportSize(scenario.viewport)
          await page.goto(`${baseUrl}${scenario.route}`, { waitUntil: 'networkidle' })
          await page.evaluate(async (paths) => {
            const imports: Promise<unknown>[] = []
            for (const path of paths) {
              if (/\.[jt]sx?$/.test(path)) imports.push(import(`/${path.replace(/^ui\//, '')}`))
            }
            await Promise.all(imports)
          }, scenario.sourcePaths)
          for (const action of scenario.actions) await act(page, action)
          bindings.push(...await collect(page, scenario.scenarioId, theme, runtime))
        }
      }
    } finally { await browser.close() }
    const unique = new Map(bindings.map((binding) => [JSON.stringify(binding), binding]))
    const manifest: RuntimeBindingManifest = { schemaVersion: 1, sourceCommit: staticManifest.sourceCommit, bindings: [...unique.values()] }
    await mkdir(resolve(output, '..'), { recursive: true })
    await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`)
    const bound = new Set(manifest.bindings.map((binding) => binding.inventoryId))
    const missing = runtime.filter((entry) => !bound.has(entry.inventoryId))
    if (missing.length > 0) throw new Error(`runtime occurrences without bindings (${missing.length}):\n${missing.map((entry) => `${entry.inventoryId} ${entry.path}:${entry.span.startLine}`).join('\n')}`)
    return manifest
  } finally { stopServer(server) }
}

async function assertProductionClean(): Promise<void> {
  const dist = resolve(root, 'ui/dist')
  const files = await (await import('node:fs/promises')).readdir(resolve(dist, 'assets'))
  for (const file of files) {
    const content = await readFile(resolve(dist, 'assets', file))
    if (content.includes(Buffer.from('data-openalice-color-audit')) || content.includes(Buffer.from('__OPENALICE_THEME_COLOR_VALUE__'))) {
      throw new Error(`audit runtime leaked into production asset: ${file}`)
    }
  }
  console.log('production assets contain no theme color audit runtime')
}

const command = process.argv[2]
if (command === 'check') {
  const manifest = await buildBindings()
  console.log(`validated ${manifest.bindings.length} runtime bindings`)
} else if (command === 'assert-production-clean') await assertProductionClean()
else throw new Error(`unknown runtime binding command: ${command ?? '<missing>'}`)
