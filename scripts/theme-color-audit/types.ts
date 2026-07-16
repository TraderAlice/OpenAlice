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

export interface PixelBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface EvidenceJpeg {
  readonly relativePath: string
  readonly sha256: string
  readonly format: 'jpeg'
  readonly quality: 80
  readonly width: number
  readonly height: number
}

export type OccurrenceEvidenceRecord =
  | {
      readonly kind: 'visual-element'
      readonly inventoryId: string
      readonly source: StaticColorOccurrence
      readonly bindingIndex: number
      readonly scenarioId: string
      readonly theme: 'light' | 'dark'
      readonly state: ThemeColorScenario['state']
      readonly surfaceKind: RuntimeSurfaceKind
      readonly channel: string
      readonly actualValue: string
      readonly locator: string
      readonly viewport: ThemeColorScenario['viewport']
      readonly deviceScaleFactor: number
      readonly targetBounds: PixelBounds
      readonly annotation: { readonly strategy: 'element-bounds' | 'surface-sample'; readonly label: string; readonly color: '#ff2d55'; readonly bounds: PixelBounds }
      readonly context: EvidenceJpeg
      readonly crop: EvidenceJpeg & { readonly annotationBoundsInImage: PixelBounds }
    }
  | {
      readonly kind: 'non-visual-probe'
      readonly inventoryId: string
      readonly source: StaticColorOccurrence
      readonly bindingIndexes: readonly number[]
      readonly reason: 'runtime-value' | 'no-positive-area-target' | 'inactive-in-scenario' | 'css-variable-definition'
    }

export interface ThemeColorEvidenceBundle {
  readonly schemaVersion: 3
  readonly sourceCommit: string
  readonly staticManifestSchemaVersion: number
  readonly runtimeBindingSchemaVersion: number
  readonly playwrightVersion: string
  readonly browserVersion: string
  readonly images: readonly EvidenceImage[]
  readonly occurrenceRecords: readonly OccurrenceEvidenceRecord[]
}

export interface DecisionEvidenceReference {
  readonly inventoryId: string
  readonly runtimeBindingIndexes: readonly number[]
  readonly imageSha256: readonly string[]
  readonly occurrenceEvidenceKind: OccurrenceEvidenceRecord['kind']
  readonly annotationContextSha256: string | null
  readonly annotationCropSha256: string | null
}

export interface ThemeColorAnalysisRecord {
  readonly occurrence: StaticColorOccurrence
  readonly evidence: DecisionEvidenceReference
}

export interface ThemeColorAnalysisBundle {
  readonly schemaVersion: 1
  readonly sourceCommit: string
  readonly staticManifestSha256: string
  readonly runtimeBindingManifestSha256: string
  readonly evidenceBundleSha256: string
  readonly records: readonly ThemeColorAnalysisRecord[]
}

export type BaseSlot = `base${'00' | '01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09' | '0A' | '0B' | '0C' | '0D' | '0E' | '0F' | '10' | '11' | '12' | '13' | '14' | '15' | '16' | '17'}`

export type ThemeColorDisposition =
  | { readonly kind: 'direct-base'; readonly baseSlot: BaseSlot; readonly semanticToken: string }
  | { readonly kind: 'derived'; readonly from: BaseSlot; readonly to: BaseSlot; readonly colorSpace: 'oklab' | 'oklch'; readonly ratio: number; readonly alpha: number; readonly targetToken: string }
  | { readonly kind: 'protected'; readonly policyOwner: 'market-color-policy' | 'terminal-ansi-policy'; readonly reason: string }
  | { readonly kind: 'allowed-literal'; readonly invariant: 'external-brand' | 'physical-display'; readonly reason: string }
  | { readonly kind: 'non-runtime'; readonly sourceClass: Exclude<SourceClass, 'runtime'>; readonly reason: string }

export interface ThemeColorSuggestion {
  readonly inventoryId: string
  readonly disposition: ThemeColorDisposition
  readonly rationale: string
  readonly evidence: DecisionEvidenceReference
}

export interface ThemeColorSuggestionManifest {
  readonly schemaVersion: 1
  readonly sourceCommit: string
  readonly analysisBundleSha256: string
  readonly suggestions: readonly ThemeColorSuggestion[]
}

export interface ReviewedThemeColorDecision extends ThemeColorSuggestion {
  readonly reviewer: { readonly status: 'accepted' | 'corrected'; readonly reviewerId: string; readonly reviewedAt: string; readonly policyVersion: 1 }
}

export interface ThemeColorDecisionManifest {
  readonly schemaVersion: 1
  readonly sourceCommit: string
  readonly suggestionManifestSha256: string
  readonly decisions: readonly ReviewedThemeColorDecision[]
}

export interface ThemeColorMigrationContract {
  readonly schemaVersion: 1
  readonly sourceCommit: string
  readonly owner: 'frontend-semantic' | 'market-protected'
  readonly decisions: readonly ReviewedThemeColorDecision[]
}
