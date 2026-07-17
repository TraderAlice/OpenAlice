import { relative, resolve, sep } from 'node:path'
import postcss from 'postcss'
import ts from 'typescript'
import type { Plugin } from 'vite'
import { buildStaticManifest } from './static-inventory.js'
import type { StaticColorManifest, StaticColorOccurrence } from './types.js'

const ATTRIBUTE = 'data-openalice-color-audit'
const VALUE_HOOK = '__OPENALICE_THEME_COLOR_CONSUME__'
const WINNER_PREFIX = '--openalice-audit-winner-'

function repoPath(root: string, id: string): string {
  return relative(root, id.split('?')[0]!).split(sep).join('/')
}

function findSmallestNode(file: ts.SourceFile, start: number, end: number): ts.Node | null {
  let found: ts.Node | null = null
  const visit = (node: ts.Node): void => {
    if (node.getStart(file) <= start && node.getEnd() >= end) {
      found = node
      ts.forEachChild(node, visit)
    }
  }
  visit(file)
  return found
}

function jsxAncestor(node: ts.Node): ts.JsxOpeningLikeElement | null {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (ts.isJsxOpeningElement(current) || ts.isJsxSelfClosingElement(current)) return current
  }
  return null
}

function valueCarrier(node: ts.Node): ts.StringLiteralLike | ts.TemplateExpression | null {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (ts.isStringLiteralLike(current) || ts.isTemplateExpression(current)) return current
    if (ts.isStatement(current) || ts.isJsxOpeningElement(current) || ts.isJsxSelfClosingElement(current)) return null
  }
  return null
}

function transformTs(path: string, code: string, occurrences: readonly StaticColorOccurrence[]): string {
  const file = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const replacements: { start: number; end: number; text: string }[] = []
  const elements = new Map<number, { element: ts.JsxOpeningLikeElement; ids: Set<string> }>()
  const values = new Map<number, { node: ts.StringLiteralLike | ts.TemplateExpression; ids: Set<string>; kind: StaticColorOccurrence['syntaxKind'] }>()
  const occurrenceById = new Map(occurrences.map((occurrence) => [occurrence.inventoryId, occurrence]))
  for (const occurrence of occurrences) {
    const node = findSmallestNode(file, occurrence.span.startOffset, occurrence.span.endOffset)
    if (!node) continue
    const carrier = valueCarrier(node)
    if (!carrier) continue
    const value = values.get(carrier.getStart(file)) ?? { node: carrier, ids: new Set<string>(), kind: occurrence.syntaxKind }
    value.ids.add(occurrence.inventoryId)
    values.set(carrier.getStart(file), value)
    const element = jsxAncestor(carrier)
    if (element) {
      const entry = elements.get(element.getStart(file)) ?? { element, ids: new Set<string>() }
      entry.ids.add(occurrence.inventoryId)
      elements.set(element.getStart(file), entry)
    }
  }
  for (const { node, ids, kind } of values.values()) {
    const original = code.slice(node.getStart(file), node.getEnd())
    const records = [...ids].map((id) => ({ id, sourceText: occurrenceById.get(id)!.sourceText }))
    const wrapped = `globalThis.${VALUE_HOOK}(${JSON.stringify(records)},${original},${JSON.stringify(kind)})`
    replacements.push({ start: node.getStart(file), end: node.getEnd(), text: ts.isJsxAttribute(node.parent) ? `{${wrapped}}` : wrapped })
  }
  for (const { element, ids } of elements.values()) {
    replacements.push({ start: element.attributes.end, end: element.attributes.end, text: ` ${ATTRIBUTE}=${JSON.stringify([...ids].join(' '))}` })
  }
  return replacements.sort((a, b) => b.start - a.start).reduce((result, item) => result.slice(0, item.start) + item.text + result.slice(item.end), code)
}

function transformCss(path: string, code: string, occurrences: readonly StaticColorOccurrence[]): string {
  const root = postcss.parse(code, { from: path })
  const declarations: import('postcss').Declaration[] = []
  root.walkDecls((declaration) => declarations.push(declaration))
  for (const declaration of declarations) {
    const start = declaration.source?.start?.offset
    const end = declaration.source?.end?.offset
    if (start === undefined || end === undefined) continue
    const entries = occurrences.filter((entry) => entry.span.startOffset >= start && entry.span.startOffset <= end)
    if (entries.length > 0) {
      declaration.cloneAfter({
        prop: `${WINNER_PREFIX}${declaration.prop.replace(/[^a-z0-9-]/gi, '-')}`,
        value: JSON.stringify(entries.map((entry) => entry.inventoryId).join(' ')),
        important: declaration.important,
      })
    }
  }
  return root.toString()
}

export function themeColorAuditPlugin(repoRoot: string): Plugin {
  let manifest: StaticColorManifest
  return {
    name: 'openalice-theme-color-audit', enforce: 'pre',
    async buildStart() { manifest = await buildStaticManifest(repoRoot) },
    transform(code, id) {
      if (!id.startsWith(resolve(repoRoot, 'ui/src'))) return null
      const path = repoPath(repoRoot, id)
      const occurrences = manifest.occurrences.filter((entry) => entry.sourceClass === 'runtime' && entry.role === 'color-consumer' && entry.path === path)
      if (occurrences.length === 0 && path !== 'ui/src/App.tsx') return null
      let transformed = occurrences.length === 0 ? code : path.endsWith('.css') ? transformCss(path, code, occurrences) : transformTs(path, code, occurrences)
      if (path === 'ui/src/index.css') {
        const utilities = [...new Set(manifest.occurrences.filter((entry) => entry.syntaxKind === 'tailwind-palette-utility').map((entry) => entry.sourceText))]
        transformed += `\n@source inline(${JSON.stringify(utilities.join(' '))});\n`
      }
      if (path === 'ui/src/App.tsx') {
        transformed = transformed.replace("const firstRunGuideEnabled = import.meta.env.VITE_OPENALICE_FIRST_RUN_GUIDE === '1'", 'const firstRunGuideEnabled = true')
      }
      if (path === 'ui/src/components/FirstRunGuide.tsx') {
        transformed = transformed.replace("const ONBOARDING_TEST_MODE = import.meta.env.VITE_OPENALICE_ONBOARDING_TEST === '1'", 'const ONBOARDING_TEST_MODE = true')
        transformed = transformed.replace('parseFirstRunStepOverride(window.location.search, ONBOARDING_TEST_MODE)', "parseFirstRunStepOverride(window.location.search || window.sessionStorage.getItem('__OPENALICE_AUDIT_ONBOARDING_SEARCH__') || '', ONBOARDING_TEST_MODE)")
      }
      // The normal demo intentionally substitutes a replay component for the
      // real xterm surface.  The audit build instead drives TerminalView with a
      // typed WebSocket fixture so its actual status/theme consumers execute.
      if (path === 'ui/src/components/workspace/Terminal.tsx') {
        transformed = transformed.replace('if (import.meta.env.VITE_DEMO_MODE)', 'if (false)')
        transformed = transformed.replace('new WebSocket(currentUrl())', 'new globalThis.__OPENALICE_AUDIT_WEBSOCKET__(currentUrl())')
      }
      return { code: transformed, map: null }
    },
    transformIndexHtml: {
      order: 'pre',
      handler() {
        return [{ tag: 'script', injectTo: 'head-prepend', children: `globalThis.${VALUE_HOOK}=(records,value,kind)=>{const m=globalThis.__OPENALICE_THEME_COLOR_CONSUMED__??=new Map(),text=String(value),tokens=text.split(/\\s+/),active=(source)=>tokens.some(token=>token===source||token.endsWith(':'+source));for(const record of records)m.set(record.id,{value:text,kind,active:kind!=='tailwind-palette-utility'||active(record.sourceText)});return kind==='tailwind-palette-utility'?text+records.filter(record=>active(record.sourceText)).map(record=>' openalice-audit-'+record.id).join(''):text};` }]
      },
    },
  }
}

export const auditRuntimeNames = { ATTRIBUTE, VALUE_HOOK, WINNER_PREFIX } as const
