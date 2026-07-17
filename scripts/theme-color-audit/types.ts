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
  readonly span: SourceSpan
}

export interface StaticColorManifest {
  readonly schemaVersion: typeof STATIC_MANIFEST_SCHEMA_VERSION
  readonly sourceCommit: string
  readonly generatedFrom: 'ui/src'
  readonly occurrences: readonly StaticColorOccurrence[]
}

export type ScenarioAction =
  | { readonly kind: 'click'; readonly role: 'button' | 'tab'; readonly name: string }
  | { readonly kind: 'hover'; readonly role: 'button' | 'link'; readonly name: string }
  | { readonly kind: 'focus'; readonly role: 'button' | 'textbox'; readonly name: string }

export interface ThemeColorScenario {
  readonly scenarioId: string
  readonly route: `/${string}`
  readonly fixtureProfile: 'demo'
  readonly state: 'normal' | 'hover' | 'focus' | 'selected' | 'loading' | 'warning' | 'error' | 'disabled' | 'dialog-overlay'
  readonly themes: readonly ('light' | 'dark')[]
  readonly viewport: { readonly width: number; readonly height: number }
  readonly ready: { readonly role: 'heading' | 'main' | 'button' | 'textbox'; readonly name?: string }
  readonly actions: readonly ScenarioAction[]
  readonly sourcePaths: readonly string[]
}

export type RuntimeSurfaceKind = 'css-rule' | 'dom-element' | 'runtime-value'

export interface RuntimeColorBinding {
  readonly inventoryId: string
  readonly scenarioId: string
  readonly theme: 'light' | 'dark'
  readonly surfaceKind: RuntimeSurfaceKind
  readonly channel: string
  readonly actualValue: string
  readonly active: boolean
  readonly target: {
    readonly selector: string
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  } | null
}

export interface RuntimeBindingManifest {
  readonly schemaVersion: 1
  readonly sourceCommit: string
  readonly bindings: readonly RuntimeColorBinding[]
}

export interface EvidenceImage {
  readonly scenarioId: string
  readonly theme: 'light' | 'dark'
  readonly state: ThemeColorScenario['state']
  readonly relativePath: string
  readonly sha256: string
  readonly format: 'jpeg'
  readonly quality: 80
  readonly width: number
  readonly height: number
  readonly viewport: ThemeColorScenario['viewport']
  readonly deviceScaleFactor: number
  readonly inventoryIds: readonly string[]
}

export interface ThemeColorEvidenceBundle {
  readonly schemaVersion: 1
  readonly sourceCommit: string
  readonly staticManifestSchemaVersion: number
  readonly runtimeBindingSchemaVersion: number
  readonly playwrightVersion: string
  readonly browserVersion: string
  readonly images: readonly EvidenceImage[]
}
