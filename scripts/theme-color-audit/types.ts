export const STATIC_MANIFEST_SCHEMA_VERSION = 1 as const

export type SourceClass = 'runtime' | 'demo' | 'test' | 'built-in-source-data'

export type SyntaxKind =
  | 'css-color-literal'
  | 'typescript-color-literal'
  | 'tailwind-palette-utility'

export interface SourceSpan {
  readonly startOffset: number
  readonly endOffset: number
  readonly startLine: number
  readonly startColumn: number
  readonly endLine: number
  readonly endColumn: number
}

export interface StaticColorOccurrence {
  readonly inventoryId: string
  readonly path: string
  readonly sourceText: string
  readonly sourceClass: SourceClass
  readonly syntaxKind: SyntaxKind
  readonly ownerHint: string | null
  readonly role: 'css-variable-definition' | 'color-consumer'
  readonly span: SourceSpan
}

export interface RuntimeColorWorkItem { readonly inventoryId: string; readonly source: StaticColorOccurrence }
export interface RuntimeColorWorklist { readonly schemaVersion: 1; readonly sourceCommit: string; readonly items: readonly RuntimeColorWorkItem[] }

export interface StaticColorManifest {
  readonly schemaVersion: typeof STATIC_MANIFEST_SCHEMA_VERSION
  readonly sourceCommit: string
  readonly generatedFrom: 'ui/src'
  readonly occurrences: readonly StaticColorOccurrence[]
}
