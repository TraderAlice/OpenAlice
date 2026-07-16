import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import postcss from 'postcss'
import ts from 'typescript'
import {
  STATIC_MANIFEST_SCHEMA_VERSION,
  type SourceClass,
  type StaticColorManifest,
  type StaticColorOccurrence,
  type SyntaxKind,
} from './types.js'

const COLOR_LITERAL = /#[\da-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(\s*[^()]*\)/g
const CSS_COLOR_LITERAL = /#[\da-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(\s*[^()]*\)|\b(?:black|white|transparent)\b/g
const TAILWIND_PALETTE = /\b(?:bg|text|border|ring|outline|shadow|fill|stroke|from|via|to|divide|decoration|caret|accent)-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00)|black|white|transparent)(?:\/\d{1,3})?\b/g
const SOURCE_EXTENSIONS = new Set(['.css', '.ts', '.tsx'])

interface RawMatch {
  readonly startOffset: number
  readonly endOffset: number
  readonly sourceText: string
  readonly syntaxKind: SyntaxKind
  readonly ownerHint: string | null
}

function sourceClassFor(path: string): SourceClass {
  if (path.includes('/__tests__/') || /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path)) return 'test'
  if (path.includes('/demo/')) return 'demo'
  if (/(?:theme|scheme|palette).*(?:fixture|builtin)|(?:fixture|builtin).*(?:theme|scheme|palette)/i.test(path)) {
    return 'built-in-source-data'
  }
  return 'runtime'
}

function extension(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot)
}

function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) {
      line += 1
      lineStart = index + 1
    }
  }
  return { line, column: offset - lineStart + 1 }
}

function makeId(path: string, match: RawMatch): string {
  const identity = [path, match.syntaxKind, match.startOffset, match.endOffset, match.sourceText].join('\0')
  return `color-${createHash('sha256').update(identity).digest('hex').slice(0, 20)}`
}

function scanText(text: string, absoluteStart: number, ownerHint: string | null): RawMatch[] {
  const matches: RawMatch[] = []
  for (const pattern of [COLOR_LITERAL, TAILWIND_PALETTE]) {
    pattern.lastIndex = 0
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      const sourceText = match[0]
      matches.push({
        startOffset: absoluteStart + match.index,
        endOffset: absoluteStart + match.index + sourceText.length,
        sourceText,
        syntaxKind: pattern === TAILWIND_PALETTE ? 'tailwind-palette-utility' : 'typescript-color-literal',
        ownerHint,
      })
    }
  }
  const trimmed = text.trim()
  if (/^(?:black|white|transparent)$/.test(trimmed)) {
    const start = text.indexOf(trimmed)
    matches.push({
      startOffset: absoluteStart + start,
      endOffset: absoluteStart + start + trimmed.length,
      sourceText: trimmed,
      syntaxKind: 'typescript-color-literal',
      ownerHint,
    })
  }
  return matches
}

function cssMatches(path: string, source: string): RawMatch[] {
  const root = postcss.parse(source, { from: path })
  const matches: RawMatch[] = []
  root.walkDecls((declaration) => {
    const declarationStart = declaration.source?.start?.offset
    const declarationEnd = declaration.source?.end?.offset
    if (declarationStart === undefined || declarationEnd === undefined) {
      throw new Error(`${path}: PostCSS did not provide declaration offsets`)
    }
    const rawDeclaration = source.slice(declarationStart, declarationEnd + 1)
    const valueIndex = rawDeclaration.indexOf(declaration.value)
    if (valueIndex === -1) throw new Error(`${path}: could not locate value for ${declaration.prop}`)
    CSS_COLOR_LITERAL.lastIndex = 0
    for (let match = CSS_COLOR_LITERAL.exec(declaration.value); match; match = CSS_COLOR_LITERAL.exec(declaration.value)) {
      const sourceText = match[0]
      matches.push({
        startOffset: declarationStart + valueIndex + match.index,
        endOffset: declarationStart + valueIndex + match.index + sourceText.length,
        sourceText,
        syntaxKind: 'css-color-literal',
        ownerHint: declaration.parent?.type === 'rule' ? declaration.parent.selector : declaration.prop,
      })
    }
  })
  return matches
}

function nearestOwner(node: ts.Node): string | null {
  let current: ts.Node | undefined = node
  while (current) {
    if (
      (ts.isFunctionDeclaration(current) || ts.isClassDeclaration(current) || ts.isVariableDeclaration(current))
      && current.name
    ) {
      return current.name.getText()
    }
    current = current.parent
  }
  return null
}

function typescriptMatches(path: string, source: string): RawMatch[] {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind)
  if (file.parseDiagnostics.length > 0) {
    const diagnostic = file.parseDiagnostics[0]
    throw new Error(`${path}:${diagnostic.start ?? 0}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)
  }
  const matches: RawMatch[] = []
  const scanTemplatePart = (literal: ts.TemplateLiteralLikeNode, ownerHint: string | null): void => {
    const literalText = literal.rawText ?? literal.text
    if (literalText.length === 0) return
    const raw = literal.getText(file)
    const textIndex = raw.indexOf(literalText)
    if (textIndex === -1) throw new Error(`${path}: could not locate template literal text`)
    matches.push(...scanText(literalText, literal.getStart(file) + textIndex, ownerHint))
  }
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const nodeText = node.getText(file)
      const contentStart = node.getStart(file) + 1
      matches.push(...scanText(nodeText.slice(1, -1), contentStart, nearestOwner(node)))
    } else if (ts.isTemplateExpression(node)) {
      scanTemplatePart(node.head, nearestOwner(node))
      for (const span of node.templateSpans) scanTemplatePart(span.literal, nearestOwner(node))
    } else if (ts.isJsxText(node)) {
      matches.push(...scanText(node.getText(file), node.getStart(file), nearestOwner(node)))
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return matches
}

async function sourceFiles(root: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    await Promise.all(entries.map(async (entry) => {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(extension(entry.name))) found.push(path)
    }))
  }
  await walk(resolve(root, 'ui/src'))
  return found.sort()
}

export async function buildStaticManifest(root: string, sourceCommit?: string): Promise<StaticColorManifest> {
  const occurrences: StaticColorOccurrence[] = []
  for (const absolutePath of await sourceFiles(root)) {
    const path = relative(root, absolutePath).split(sep).join('/')
    const source = await readFile(absolutePath, 'utf8')
    const rawMatches = path.endsWith('.css') ? cssMatches(path, source) : typescriptMatches(path, source)
    const seen = new Set<string>()
    for (const raw of rawMatches) {
      const dedupeKey = `${raw.startOffset}:${raw.endOffset}:${raw.syntaxKind}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      const start = offsetToLineColumn(source, raw.startOffset)
      const end = offsetToLineColumn(source, raw.endOffset)
      occurrences.push({
        inventoryId: makeId(path, raw),
        path,
        sourceText: raw.sourceText,
        sourceClass: sourceClassFor(path),
        syntaxKind: raw.syntaxKind,
        ownerHint: raw.ownerHint,
        span: {
          startOffset: raw.startOffset,
          endOffset: raw.endOffset,
          startLine: start.line,
          startColumn: start.column,
          endLine: end.line,
          endColumn: end.column,
        },
      })
    }
  }
  occurrences.sort((left, right) => left.path.localeCompare(right.path) || left.span.startOffset - right.span.startOffset)
  return {
    schemaVersion: STATIC_MANIFEST_SCHEMA_VERSION,
    sourceCommit: sourceCommit ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    generatedFrom: 'ui/src',
    occurrences,
  }
}

export async function validateStaticManifest(root: string, manifest: StaticColorManifest): Promise<void> {
  if (manifest.schemaVersion !== STATIC_MANIFEST_SCHEMA_VERSION) throw new Error('unsupported static manifest schema')
  if (manifest.generatedFrom !== 'ui/src') throw new Error('unexpected manifest source root')
  const ids = new Set<string>()
  for (const occurrence of manifest.occurrences) {
    if (ids.has(occurrence.inventoryId)) throw new Error(`duplicate inventory ID: ${occurrence.inventoryId}`)
    ids.add(occurrence.inventoryId)
    const source = await readFile(resolve(root, occurrence.path), 'utf8')
    const actual = source.slice(occurrence.span.startOffset, occurrence.span.endOffset)
    if (actual !== occurrence.sourceText) {
      throw new Error(`${occurrence.inventoryId}: source span reads ${JSON.stringify(actual)}, expected ${JSON.stringify(occurrence.sourceText)}`)
    }
    const start = offsetToLineColumn(source, occurrence.span.startOffset)
    const end = offsetToLineColumn(source, occurrence.span.endOffset)
    if (
      start.line !== occurrence.span.startLine || start.column !== occurrence.span.startColumn
      || end.line !== occurrence.span.endLine || end.column !== occurrence.span.endColumn
    ) throw new Error(`${occurrence.inventoryId}: line/column projection is stale`)
  }
}
