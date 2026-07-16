import { relative, resolve, sep } from 'node:path'
import postcss from 'postcss'
import ts from 'typescript'
import type { Plugin } from 'vite'
import { buildStaticManifest } from './static-inventory.js'
import type { StaticColorManifest, StaticColorOccurrence } from './types.js'

const ATTRIBUTE = 'data-openalice-color-audit'
const VALUE_HOOK = '__OPENALICE_THEME_COLOR_VALUE__'

function repoPath(root: string, id: string): string {
  return relative(root, id.split('?')[0]!).split(sep).join('/')
}

function markerName(inventoryId: string): string {
  return `--openalice-audit-${inventoryId.slice('color-'.length)}`
}

function jsxAncestor(node: ts.Node): ts.JsxOpeningLikeElement | null {
  let current: ts.Node | undefined = node
  while (current) {
    if (ts.isJsxOpeningElement(current) || ts.isJsxSelfClosingElement(current)) return current
    current = current.parent
  }
  return null
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

function transformTsx(path: string, code: string, occurrences: readonly StaticColorOccurrence[]): string {
  const file = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const elementIds = new Map<number, { element: ts.JsxOpeningLikeElement; ids: string[] }>()
  const replacements: { start: number; end: number; text: string }[] = []
  const valueNodes = new Map<number, { node: ts.StringLiteralLike; ids: string[] }>()

  for (const occurrence of occurrences) {
    const node = findSmallestNode(file, occurrence.span.startOffset, occurrence.span.endOffset)
    if (!node) continue
    const element = jsxAncestor(node)
    if (element) {
      const entry = elementIds.get(element.getStart(file)) ?? { element, ids: [] }
      entry.ids.push(occurrence.inventoryId)
      elementIds.set(element.getStart(file), entry)
    }
    if (ts.isStringLiteralLike(node)) {
      const entry = valueNodes.get(node.getStart(file)) ?? { node, ids: [] }
      entry.ids.push(occurrence.inventoryId)
      valueNodes.set(node.getStart(file), entry)
    }
  }

  for (const { node, ids } of valueNodes.values()) {
    const original = code.slice(node.getStart(file), node.getEnd())
    const wrapped = [...new Set(ids)].reduce(
      (value, id) => `globalThis.${VALUE_HOOK}(${JSON.stringify(id)}, ${value})`, original,
    )
    replacements.push({
      start: node.getStart(file), end: node.getEnd(),
      text: ts.isJsxAttribute(node.parent) ? `{${wrapped}}` : wrapped,
    })
  }

  for (const { element, ids } of elementIds.values()) {
    if (element.attributes.properties.some((property) => ts.isJsxAttribute(property) && property.name.getText(file) === ATTRIBUTE)) continue
    const insertAt = element.attributes.end
    replacements.push({ start: insertAt, end: insertAt, text: ` ${ATTRIBUTE}=${JSON.stringify([...new Set(ids)].join(' '))}` })
  }

  const transformed = replacements.sort((a, b) => b.start - a.start).reduce(
    (result, replacement) => result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end), code,
  )
  const sourceRegistrations = occurrences
    .map((entry) => `globalThis.${VALUE_HOOK}(${JSON.stringify(entry.inventoryId)}, ${JSON.stringify(entry.sourceText)}, false);`)
    .join('')
  return `${transformed}\n${sourceRegistrations}\n`
}

function transformCss(path: string, code: string, occurrences: readonly StaticColorOccurrence[]): string {
  const root = postcss.parse(code, { from: path })
  const byOffset = new Map(occurrences.map((entry) => [entry.span.startOffset, entry]))
  const declarations: import('postcss').Declaration[] = []
  root.walkDecls((declaration) => { declarations.push(declaration) })
  for (const declaration of declarations) {
    const start = declaration.source?.start?.offset
    const end = declaration.source?.end?.offset
    if (start === undefined || end === undefined) continue
    const entries = [...byOffset.entries()].filter(([offset]) => offset >= start && offset <= end).map(([, entry]) => entry)
    const selector = declaration.parent?.type === 'rule' ? declaration.parent.selector : ''
    for (const entry of entries) declaration.cloneAfter({ prop: markerName(entry.inventoryId), value: JSON.stringify(`${declaration.prop}\t${selector}`) })
  }
  return root.toString()
}

export function themeColorAuditPlugin(repoRoot: string): Plugin {
  let manifest: StaticColorManifest
  return {
    name: 'openalice-theme-color-audit',
    enforce: 'pre',
    async buildStart() { manifest = await buildStaticManifest(repoRoot) },
    transform(code, id) {
      if (!id.startsWith(resolve(repoRoot, 'ui/src'))) return null
      const path = repoPath(repoRoot, id)
      const occurrences = manifest.occurrences.filter((entry) => entry.sourceClass === 'runtime' && entry.path === path)
      if (occurrences.length === 0) return null
      if (path.endsWith('.css')) return { code: transformCss(path, code, occurrences), map: null }
      if (path.endsWith('.ts') || path.endsWith('.tsx')) return { code: transformTsx(path, code, occurrences), map: null }
      return null
    },
    transformIndexHtml: {
      order: 'pre',
      handler() {
        const sourceCommit = manifest.sourceCommit
        return [{
          tag: 'script', injectTo: 'head-prepend', children: `globalThis.${VALUE_HOOK}=(id,value,active=true)=>{const a=globalThis.__OPENALICE_THEME_COLOR_VALUES__??=(new Map);const previous=a.get(id);if(!previous||active)a.set(id,{value:String(value),active});return value};globalThis.__OPENALICE_THEME_COLOR_COMMIT__=${JSON.stringify(sourceCommit)};`,
        }]
      },
    },
  }
}

export const auditRuntimeNames = { ATTRIBUTE, VALUE_HOOK } as const
