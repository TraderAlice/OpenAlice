import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, type Page } from '@playwright/test'
import postcss from 'postcss'
import ts from 'typescript'
import { buildStaticManifest } from './static-inventory.js'
import { themeColorScenarios } from './scenarios.js'
import type { RuntimeBindingManifest, RuntimeColorBinding, ScenarioAction, StaticColorOccurrence, ThemeColorScenario } from './types.js'
import { assertBindingIntegrity, assertEveryTarget, metadataForDeclaredIds, type RuntimeBindingMetadata } from './runtime-provenance.js'

const root = resolve(import.meta.dirname, '../..')
const baseUrl = 'http://127.0.0.1:5173'
const output = resolve(root, '.artifacts/theme-color-audit/runtime-bindings.json')
const winnerPrefix = '--openalice-audit-winner-'

type Metadata = RuntimeBindingMetadata

function startServer(): ChildProcess {
  return spawn('pnpm', ['-F', 'open-alice-ui', 'exec', 'vite', '--mode', 'demo', '--config', '../scripts/theme-color-audit/audit-vite.config.ts'], {
    cwd: root, stdio: ['ignore', 'inherit', 'inherit'], detached: true, env: { ...process.env, OPENALICE_UI_PORT: '5173', VITE_OPENALICE_FIRST_RUN_GUIDE: '1' },
  })
}
function stopServer(server: ChildProcess): void {
  if (!server.pid) return
  try { process.kill(-server.pid, 'SIGTERM') } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') throw error
  }
}
async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await fetch(baseUrl)).ok) return } catch { /* starting */ }
    await delay(250)
  }
  throw new Error('audit Vite server did not become ready')
}
async function act(page: Page, action: ScenarioAction): Promise<void> {
  if (action.kind === 'wait') { await page.waitForTimeout(action.milliseconds); return }
  if (action.kind === 'select') { await page.locator('select').nth(action.index).selectOption(action.value); return }
  if (action.kind === 'click-css') { await page.locator(action.selector).filter({ hasText: action.text }).first().click(); return }
  if (action.kind === 'hover-css') { await page.locator(action.selector).first().hover(); return }
  if (action.kind === 'focus-css') { await page.locator(action.selector).first().focus(); return }
  if (action.kind === 'fill-css') { await page.locator(action.selector).first().fill(action.value); return }
  if (action.kind === 'fill') { await page.getByPlaceholder(action.placeholder, { exact: true }).fill(action.value); return }
  const roleLocator = page.getByRole(action.role, { name: action.name, exact: action.exact ?? true }).first()
  const locator = await roleLocator.count() > 0 ? roleLocator : page.getByText(action.name, { exact: action.exact ?? true }).first()
  if (action.kind === 'click') await locator.click()
  else if (action.kind === 'hover') await locator.hover()
  else await locator.focus()
}

function tsChannel(path: string, source: string, occurrence: StaticColorOccurrence): string {
  if (occurrence.syntaxKind === 'tailwind-palette-utility') {
    return occurrence.sourceText.split(':').at(-1)!.split('-')[0]!
  }
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  let found: ts.Node | undefined
  const visit = (node: ts.Node): void => {
    if (node.getStart(file) <= occurrence.span.startOffset && node.getEnd() >= occurrence.span.endOffset) { found = node; ts.forEachChild(node, visit) }
  }
  visit(file)
  for (let node = found; node; node = node.parent) {
    if (ts.isJsxAttribute(node)) return node.name.getText(file)
    if (ts.isPropertyAssignment(node)) return node.name.getText(file)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text
  }
  return 'color'
}

async function metadataFor(entries: readonly StaticColorOccurrence[]): Promise<Metadata[]> {
  const result: Metadata[] = []
  for (const path of [...new Set(entries.map((entry) => entry.path))]) {
    const source = await readFile(resolve(root, path), 'utf8')
    const inFile = entries.filter((entry) => entry.path === path)
    if (path.endsWith('.css')) {
      const parsed = postcss.parse(source, { from: path })
      parsed.walkDecls((declaration) => {
        const start = declaration.source?.start?.offset; const end = declaration.source?.end?.offset
        if (start === undefined || end === undefined) return
        const selector = declaration.parent?.type === 'rule' ? declaration.parent.selector : undefined
        for (const entry of inFile.filter((item) => item.span.startOffset >= start && item.span.startOffset <= end)) {
          result.push({ id: entry.inventoryId, path, sourceText: entry.sourceText, syntaxKind: entry.syntaxKind, channel: declaration.prop, selector })
        }
      })
    } else for (const entry of inFile) result.push({ id: entry.inventoryId, path, sourceText: entry.sourceText, syntaxKind: entry.syntaxKind, channel: tsChannel(path, source, entry) })
  }
  return result
}

async function collect(page: Page, scenarioId: string, theme: 'light' | 'dark', metadata: readonly Metadata[]): Promise<RuntimeColorBinding[]> {
  return page.evaluate(({ scenarioId, theme, metadata, winnerPrefix }) => {
    type RectTarget = { selector: string; x: number; y: number; width: number; height: number }
    type Consumed = { value: string; kind: string }
    const isCssColorValue = (value: string): boolean => /^(?:#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([^)]*\)|transparent|currentcolor)$/i.test(value.trim())
    const bindings: RuntimeColorBinding[] = []
    const consumed = (globalThis as typeof globalThis & { __OPENALICE_THEME_COLOR_CONSUMED__?: Map<string, Consumed> }).__OPENALICE_THEME_COLOR_CONSUMED__
    const target = (element: Element): RectTarget | null => {
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      const audit = element.getAttribute('data-openalice-color-audit')?.split(' ')[0]
      const selector = element.id ? `#${CSS.escape(element.id)}` : audit ? `[data-openalice-color-audit~="${audit}"]` : element.classList.length ? `${element.tagName.toLowerCase()}.${CSS.escape(element.classList[0]!)}` : element.tagName.toLowerCase()
      return { selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    const push = (item: Metadata, element: Element, surfaceKind: RuntimeColorBinding['surfaceKind'], actualValue: string): boolean => {
      const rect = target(element); if (!rect) return false
      bindings.push({ inventoryId: item.id, scenarioId, theme, surfaceKind, channel: item.channel, actualValue, target: rect })
      return true
    }
    const normalize = (value: string): string => {
      const probe = document.createElement('span'); probe.style.color = value; document.body.append(probe)
      const normalized = getComputedStyle(probe).color; probe.remove(); return normalized
    }
    for (const item of metadata) {
      let bound = false
      if (item.selector) {
        const pseudo = item.selector.match(/::(?:before|after|selection|marker|-webkit-scrollbar(?:-track)?)/)?.[0] ?? null
        const baseSelector = item.selector.replace(/::(?:before|after|selection|marker|-webkit-scrollbar(?:-track)?)/g, '').trim() || '*'
        let elements: Element[] = []
        try { elements = [...document.querySelectorAll(baseSelector)] } catch { elements = [] }
        const pseudos: Array<string | null> = [pseudo]
        for (const element of elements) {
          for (const pseudo of pseudos) {
            const style = getComputedStyle(element, pseudo)
            if (!style.getPropertyValue(`${winnerPrefix}${item.channel.replace(/[^a-z0-9-]/gi, '-')}`).replace(/["']/g, '').trim().split(/\s+/).includes(item.id)) continue
            bound = push(item, element, 'css-cascade-winner', style.getPropertyValue(item.channel).trim()) || bound
          }
        }
      } else {
        const direct = [...document.querySelectorAll(`[data-openalice-color-audit~="${item.id}"],.openalice-audit-${item.id}`)]
        for (const element of direct) {
          const style = getComputedStyle(element)
          const channel = item.syntaxKind === 'tailwind-palette-utility'
            ? ({ bg: 'background-color', text: 'color', border: 'border-color', fill: 'fill', stroke: 'stroke', from: '--tw-gradient-from', via: '--tw-gradient-via', to: '--tw-gradient-to' } as Record<string, string>)[item.channel]
            : item.channel
          if (!channel) continue
          const actualValue = style.getPropertyValue(channel).trim() || element.getAttribute(channel) || ''
          if (actualValue && actualValue !== item.sourceText) bound = push(item, element, 'dom-element', actualValue) || bound
        }
        const execution = consumed?.get(item.id)
        if (!bound && execution) {
          const typedSelectors = item.path.includes('KlinePanel') ? ['canvas'] : item.path.includes('MarketBoardPage') || item.path.includes('MarketRotationPage') ? ['svg'] : []
          for (const selector of typedSelectors) {
            const element = document.querySelector(selector)
            if (element && push(item, element, 'typed-surface', execution.value)) { bound = true; break }
          }
        }
        if (!bound && execution && item.syntaxKind !== 'tailwind-palette-utility' && isCssColorValue(execution.value)) {
          const expected = normalize(execution.value)
          const candidates = item.path.includes('/Terminal.tsx')
            ? document.querySelectorAll(`.status-dot[title="${CSS.escape(item.channel)}"]`)
            : document.querySelectorAll('body *')
          for (const element of candidates) {
            const style = getComputedStyle(element)
            const values = [style.color, style.backgroundColor, style.borderColor, style.fill, style.stroke, element.getAttribute('fill') ?? '', element.getAttribute('stroke') ?? '']
            const actualValue = values.find((value) => normalize(value) === expected)
            if (actualValue && push(item, element, 'dom-element', actualValue)) { bound = true; break }
          }
        }
      }
    }
    return bindings
  }, { scenarioId, theme, metadata, winnerPrefix })
}

export interface RuntimeCaptureEvent {
  readonly page: Page
  readonly binding: RuntimeColorBinding
  readonly occurrence: StaticColorOccurrence
  readonly scenario: ThemeColorScenario
}

export interface RuntimeBindingOptions {
  readonly onBinding?: (event: RuntimeCaptureEvent) => Promise<void>
}

export async function buildBindings(options: RuntimeBindingOptions = {}): Promise<RuntimeBindingManifest> {
  const staticManifest = await buildStaticManifest(root)
  const runtime = staticManifest.occurrences.filter((entry) => entry.sourceClass === 'runtime' && entry.role === 'color-consumer')
  const allMetadata = await metadataFor(runtime)
  const declaredIds = new Set(themeColorScenarios.flatMap((scenario) => [...scenario.inventoryIds]))
  const undeclared = runtime.map((entry) => entry.inventoryId).filter((id) => !declaredIds.has(id))
  if (undeclared.length) throw new Error(`runtime occurrences without a declared scenario (${undeclared.length}):\n${undeclared.join('\n')}`)
  const server = startServer()
  try {
    await waitForServer(); const browser = await chromium.launch({ headless: true, channel: process.env['PLAYWRIGHT_CHANNEL'] ?? 'chrome' })
    const bindings: RuntimeColorBinding[] = []
    try {
      const selectedScenarios = process.env['AUDIT_SCENARIO']
        ? themeColorScenarios.filter((scenario) => scenario.scenarioId === process.env['AUDIT_SCENARIO'])
        : themeColorScenarios
      for (const scenario of selectedScenarios) for (const theme of scenario.themes) {
        console.log(`binding ${scenario.scenarioId} ${theme}`)
        const context = await browser.newContext({ viewport: scenario.viewport })
        const page = await context.newPage()
        try {
        page.on('pageerror', (error) => console.error('audit page error', error.stack ?? error.message))
        const auditRun = `${scenario.scenarioId}:${theme}`
        if (scenario.fixtureProfile !== 'demo') await page.setExtraHTTPHeaders({ 'x-openalice-theme-audit-fixture': scenario.fixtureProfile, 'x-openalice-theme-audit-run': auditRun })
        if (scenario.fixtureProfile !== 'demo') await page.addInitScript(({ fixture, auditRun }) => {
          if (fixture === 'first-run-locked' || fixture === 'first-run-no-uta') window.sessionStorage.setItem('__OPENALICE_AUDIT_ONBOARDING_SEARCH__', '?onboardingStep=broker')
          if (fixture === 'market-search-variants') window.localStorage.setItem('openalice.watchlist.v1', JSON.stringify({ state: { entries: [{ assetClass: 'crypto', symbol: 'BTC-USD', addedAt: 2 }, { assetClass: 'commodity', symbol: 'GC=F', addedAt: 1 }] }, version: 1 }))
          const originalFetch = globalThis.fetch.bind(globalThis)
          globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
            const request = new Request(input, init)
            const headers = new Headers(request.headers); headers.set('x-openalice-theme-audit-fixture', fixture); headers.set('x-openalice-theme-audit-run', auditRun)
            return originalFetch(new Request(request, { headers }))
          }
        }, { fixture: scenario.fixtureProfile, auditRun })
        if (scenario.fixtureProfile.startsWith('terminal-')) await page.addInitScript((fixture) => {
          ;(globalThis as typeof globalThis & { __name?: (value: unknown) => unknown }).__name = (value) => value
          type Listener = (event?: { data?: unknown; code?: number }) => void
          class AuditWebSocket {
            static readonly OPEN = 1
            readonly OPEN = 1
            readyState = 0
            binaryType = 'arraybuffer'
            private readonly listeners = new Map<string, Listener[]>()
            constructor(_url: string) {
              const profile = new URLSearchParams(globalThis.location.search).get('themeAuditFixture') ?? fixture
              const emit = (type: string, event?: { data?: unknown; code?: number }): void => {
                for (const listener of this.listeners.get(type) ?? []) listener(event)
              }
              if (profile === 'terminal-connecting') return
              setTimeout(() => {
                this.readyState = 1; emit('open')
                if (profile === 'terminal-connected') return
                setTimeout(() => {
                  this.readyState = 3
                  emit('close', { code: profile === 'terminal-kicked' ? 4001 : profile === 'terminal-locked' ? 4409 : profile === 'terminal-closed' ? 4404 : 1006 })
                }, 40)
              }, 20)
            }
            addEventListener(type: string, listener: Listener): void {
              const current = this.listeners.get(type) ?? []; current.push(listener); this.listeners.set(type, current)
            }
            send(_data: unknown): void {}
            close(): void { this.readyState = 3 }
          }
          Object.assign(globalThis, { __OPENALICE_AUDIT_WEBSOCKET__: AuditWebSocket })
        }, scenario.fixtureProfile)
        await page.addInitScript(() => { (globalThis as typeof globalThis & { __name?: (value: unknown) => unknown }).__name = (value) => value })
        await page.addInitScript((selectedTheme) => localStorage.setItem('openalice.color-theme', selectedTheme), theme)
        const route = scenario.fixtureProfile === 'demo'
          ? scenario.route
          : `${scenario.route}${scenario.route.includes('?') ? '&' : '?'}themeAuditFixture=${encodeURIComponent(scenario.fixtureProfile)}`
        await page.goto(`${baseUrl}${route}`, { waitUntil: scenario.collectBeforeNetworkIdle ? 'domcontentloaded' : 'networkidle' })
        for (const action of scenario.actions) await act(page, action)
        await page.getByRole(scenario.ready.role, { name: scenario.ready.name, exact: scenario.ready.name !== undefined }).first().waitFor({ state: 'visible' })
        if (!scenario.collectBeforeNetworkIdle) await page.waitForLoadState('networkidle')
        await page.waitForTimeout(scenario.collectBeforeNetworkIdle ? 50 : scenario.fixtureProfile.startsWith('terminal-') ? 1_000 : 150)
        const scenarioIds = new Set<string>(scenario.inventoryIds)
        const collected = await collect(page, scenario.scenarioId, theme, metadataForDeclaredIds(allMetadata, [...scenarioIds]))
        bindings.push(...collected)
        if (options.onBinding) {
          const occurrenceById = new Map(runtime.map((entry) => [entry.inventoryId, entry]))
          for (const binding of collected) {
            const occurrence = occurrenceById.get(binding.inventoryId)
            if (occurrence) await options.onBinding({ page, binding, occurrence, scenario })
          }
        }
        } finally { await context.close() }
      }
    } finally { await browser.close() }
    const unique = [...new Map(bindings.map((entry) => [`${entry.inventoryId}:${entry.scenarioId}:${entry.theme}`, entry])).values()]
    assertBindingIntegrity(unique, allMetadata)
    await mkdir(resolve(output, '..'), { recursive: true }); await writeFile(output, `${JSON.stringify({ schemaVersion: 2, sourceCommit: staticManifest.sourceCommit, bindings: unique }, null, 2)}\n`)
    if (!process.env['AUDIT_SCENARIO']) assertEveryTarget(runtime.map((entry) => entry.inventoryId), unique, 'complete manifest')
    const manifest: RuntimeBindingManifest = { schemaVersion: 2, sourceCommit: staticManifest.sourceCommit, bindings: unique }
    return manifest
  } finally { stopServer(server) }
}

async function assertProductionClean(): Promise<void> {
  for (const file of await readdir(resolve(root, 'ui/dist/assets'))) {
    const content = await readFile(resolve(root, 'ui/dist/assets', file), 'utf8')
    for (const forbidden of ['data-openalice-color-audit', '__OPENALICE_THEME_COLOR_CONSUME__', '__OPENALICE_THEME_COLOR_CONSUMED__', 'openalice-audit-winner-', '__OPENALICE_AUDIT_WEBSOCKET__', '__OPENALICE_AUDIT_ONBOARDING_SEARCH__']) if (content.includes(forbidden)) throw new Error(`audit runtime leaked into production asset ${file}: ${forbidden}`)
  }
  console.log('production assets contain no theme color audit runtime')
}

async function main(): Promise<void> {
  const command = process.argv[2]
  if (command === 'check') console.log(`validated ${(await buildBindings()).bindings.length} runtime bindings`)
  else if (command === 'test-missing-target-guard') {
    try { assertEveryTarget(['deliberately-missing'], [], 'guard'); throw new Error('guard accepted a missing target') } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('deliberately-missing')) throw error
      console.log('missing target guard rejected an unbound inventory ID')
    }
  } else if (command === 'assert-production-clean') await assertProductionClean()
  else throw new Error(`unknown runtime binding command: ${command ?? '<missing>'}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
