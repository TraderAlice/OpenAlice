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

export type ScenarioAction =
  | { readonly kind: 'wait'; readonly milliseconds: number }
  | { readonly kind: 'select'; readonly index: number; readonly value: string }
  | { readonly kind: 'click-css'; readonly selector: string; readonly text: string }
  | { readonly kind: 'hover-css'; readonly selector: string }
  | { readonly kind: 'focus-css'; readonly selector: string }
  | { readonly kind: 'fill-css'; readonly selector: string; readonly value: string }
  | { readonly kind: 'click'; readonly role: 'button' | 'tab' | 'link' | 'switch'; readonly name: string; readonly exact?: boolean }
  | { readonly kind: 'hover'; readonly role: 'button' | 'link'; readonly name: string; readonly exact?: boolean }
  | { readonly kind: 'focus'; readonly role: 'button' | 'textbox'; readonly name: string; readonly exact?: boolean }
  | { readonly kind: 'fill'; readonly placeholder: string; readonly value: string }

export interface ThemeColorScenario {
  readonly scenarioId: string
  readonly route: `/${string}`
  readonly fixtureProfile: 'demo' | 'market-search-variants' | 'issue-status-variants' | 'issues-due' | 'portfolio-cached' | 'portfolio-health-degraded' | 'simulator-audit' | 'snapshot-degraded' | 'inbox-markdown' | 'inbox-dead' | 'automation-loading' | 'automation-run-failed' | 'automation-list-error' | 'automation-output-error' | 'automation-refresh-error' | 'trading-approval' | 'order-partial' | 'issues-invalid' | 'issues-error' | 'issues-stale' | 'issue-comment-error' | 'issue-detail-load-error' | 'issue-property-error' | 'issue-continue-error' | 'issue-credential-missing' | 'issue-node-selection' | 'broker-picker' | 'broker-conflict' | 'credential-test' | 'inquiry-variants' | 'inquiry-error' | 'connector-starting' | 'connector-awaiting' | 'connector-awaiting-status' | 'connector-needs-setup' | 'connector-ready' | 'trading-degraded' | 'agent-permissions-warning' | 'market-stale' | 'chat-no-agents' | 'chat-selected-missing' | 'chat-no-creds' | 'first-run-incomplete' | 'first-run-locked' | 'first-run-no-uta' | 'workspace-empty' | 'workspace-resume' | 'workspace-webpi' | 'workspace-webpi-complete' | 'workspace-webpi-running' | 'workspace-config-stale' | 'terminal-connected' | 'terminal-connecting' | 'terminal-reconnecting' | 'terminal-kicked' | 'terminal-locked' | 'terminal-closed'
  readonly state: 'normal' | 'hover' | 'focus' | 'selected' | 'warning' | 'error' | 'disabled' | 'dialog-overlay'
  readonly stateDriver?: 'route' | 'fixture' | 'action'
  readonly themes: readonly ('light' | 'dark')[]
  readonly viewport: { readonly width: number; readonly height: number }
  readonly ready: { readonly role: 'heading' | 'main' | 'button' | 'textbox'; readonly name?: string }
  readonly actions: readonly ScenarioAction[]
  readonly expectedSurface: 'dom-or-css' | 'typed-non-dom'
  readonly collectBeforeNetworkIdle?: boolean
  readonly inventoryIds: readonly string[]
}

export type RuntimeSurfaceKind = 'css-cascade-winner' | 'dom-element' | 'typed-surface' | 'sandboxed-iframe'

export interface RuntimeTarget {
  readonly selector: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type RuntimeWinnerProof =
  | { readonly kind: 'tailwind-utility'; readonly sourceUtility: string; readonly activeClassToken: string; readonly isolatedValue: string }
  | { readonly kind: 'css-cascade-marker'; readonly winnerProperty: string }
  | { readonly kind: 'runtime-value-match'; readonly consumedValue: string }
  | { readonly kind: 'typed-runtime-value'; readonly consumedValue: string }
  | { readonly kind: 'iframe-computed-style'; readonly sourceValue: string; readonly computedProperty: 'background-color' | 'color'; readonly isolatedValue: string }

export interface RuntimeColorBinding {
  readonly inventoryId: string
  readonly scenarioId: string
  readonly theme: 'light' | 'dark'
  readonly surfaceKind: RuntimeSurfaceKind
  readonly channel: string
  readonly actualValue: string
  readonly winner: RuntimeWinnerProof
  readonly target: RuntimeTarget
}

export interface RuntimeBindingManifest {
  readonly schemaVersion: 3
  readonly sourceCommit: string
  readonly bindings: readonly RuntimeColorBinding[]
}
