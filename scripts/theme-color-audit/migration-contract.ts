import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ThemeColorOccurrenceEvidence } from './evidence.js'

export const MIGRATION_SUGGESTION_SCHEMA_VERSION = 1 as const
export const MIGRATION_DECISION_SCHEMA_VERSION = 1 as const
export type BaseSlot = `base${'00' | '01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09' | '0A' | '0B' | '0C' | '0D' | '0E' | '0F' | '10' | '11' | '12' | '13' | '14' | '15' | '16' | '17'}`
export type MigrationOwner = '#16' | '#18'

export type MigrationDisposition =
  | { readonly kind: 'direct-base'; readonly baseSlot: BaseSlot; readonly semanticToken: string }
  | { readonly kind: 'derived'; readonly baseSlots: readonly [BaseSlot, BaseSlot, ...BaseSlot[]]; readonly colorSpace: 'oklch'; readonly mix: string; readonly alpha: number | null; readonly semanticToken: string }
  | { readonly kind: 'protected'; readonly policyOwner: 'market-color-policy' | 'trading-risk-policy' | 'permission-risk-policy' | 'destructive-action-policy'; readonly semanticToken: string; readonly reason: string }
  | { readonly kind: 'allowed-literal'; readonly invariant: 'transparent-no-paint' | 'physical-shadow' | 'external-widget-contract'; readonly reason: string }
  | { readonly kind: 'non-runtime'; readonly sourceClass: 'demo' | 'test' | 'built-in-source-data'; readonly reason: string }

export interface MigrationEvidenceReference {
  readonly inventoryId: string
  readonly source: ThemeColorOccurrenceEvidence['source']
  readonly runtimeTarget: ThemeColorOccurrenceEvidence['target']
  readonly scenario: ThemeColorOccurrenceEvidence['scenario']
  readonly channel: string
  readonly actualValue: string
  readonly context: ThemeColorOccurrenceEvidence['context']
  readonly crop: ThemeColorOccurrenceEvidence['crop']
  readonly reviewIndexHref: string
}

export interface MigrationSuggestion {
  readonly inventoryId: string
  readonly currentLiteral: string
  readonly proposedCssVariable: string | null
  readonly disposition: MigrationDisposition
  readonly rationale: string
  readonly risk: string
  readonly migrationOwner: MigrationOwner
  readonly evidence: MigrationEvidenceReference
}

export interface MigrationSuggestionManifest { readonly schemaVersion: 1; readonly sourceCommit: string; readonly evidenceManifestSha256: string; readonly suggestions: readonly MigrationSuggestion[] }
export interface ReviewedMigrationDecision extends MigrationSuggestion { readonly reviewer: { readonly status: 'accepted'; readonly reviewerId: string; readonly reviewedAt: string; readonly policyVersion: 1 } }
export interface MigrationDecisionManifest { readonly schemaVersion: 1; readonly sourceCommit: string; readonly suggestionManifestSha256: string; readonly decisions: readonly ReviewedMigrationDecision[] }
export interface MigrationContractExport { readonly schemaVersion: 1; readonly sourceCommit: string; readonly owner: MigrationOwner; readonly decisions: readonly ReviewedMigrationDecision[] }

const HASH = /^[0-9a-f]{64}$/
const CSS_VAR = /^--[a-z][a-z0-9-]*$/
const BASE_SLOTS = new Set<BaseSlot>(Array.from({ length: 24 }, (_, index) => `base${index.toString(16).toUpperCase().padStart(2, '0')}` as BaseSlot))
const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

function semanticStem(entry: ThemeColorOccurrenceEvidence): string {
  const file = entry.source.path.split('/').at(-1)!.replace(/\.(tsx?|css)$/, '')
  return file.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
}

function alphaFrom(sourceText: string): number | null {
  const tailwind = sourceText.match(/\/(\d{1,3})$/)
  if (tailwind) return Number(tailwind[1]) / 100
  const rgba = sourceText.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/i)
  if (rgba) return Number(rgba[1])
  if (/^#[0-9a-f]{8}$/i.test(sourceText)) return Number.parseInt(sourceText.slice(7, 9), 16) / 255
  return null
}

function hue(entry: ThemeColorOccurrenceEvidence): { slot: BaseSlot; name: string } {
  const text = `${entry.source.sourceText} ${entry.actualValue}`.toLowerCase()
  if (/red|rose|#f85149|#d65c5c/.test(text)) return { slot: 'base08', name: 'danger' }
  if (/orange/.test(text)) return { slot: 'base09', name: 'attention' }
  if (/amber|yellow|#d29922|#28c840/.test(text)) return { slot: 'base0A', name: 'warning' }
  if (/emerald|green|#3fb950|#7ee787/.test(text)) return { slot: 'base0B', name: 'success' }
  if (/blue|#3b82f6|#58a6ff/.test(text)) return { slot: 'base0D', name: 'info' }
  if (/purple|#d2a8ff/.test(text)) return { slot: 'base0E', name: 'special' }
  if (/white|255[, )]|#c9d1d9/.test(text)) return { slot: 'base07', name: 'on-strong' }
  if (/black|#000|0[, )]|#21262d/.test(text)) return { slot: 'base00', name: 'neutral-dark' }
  return { slot: 'base04', name: 'muted' }
}

function protectedDisposition(entry: ThemeColorOccurrenceEvidence): Extract<MigrationDisposition, { kind: 'protected' }> | null {
  const path = entry.source.path.toLowerCase(); const text = entry.source.sourceText.toLowerCase(); const name = hue(entry).name
  if (/market|kline|simulator|portfolio/.test(path)) return { kind: 'protected', policyOwner: 'market-color-policy', semanticToken: `--color-market-${name}`, reason: 'Market direction, chart series, asset identity, and financial state are owned by the market color policy.' }
  if (/orderentry|pushapproval|tradingpage|uta\//.test(path)) return { kind: 'protected', policyOwner: 'trading-risk-policy', semanticToken: `--color-trading-${name}`, reason: 'Trading confirmation and broker-write state require an invariant risk policy across themes.' }
  if (/permission/.test(path)) return { kind: 'protected', policyOwner: 'permission-risk-policy', semanticToken: `--color-permission-${name}`, reason: 'Permission warnings must remain distinguishable under the permission risk policy.' }
  if (/(delete|destructive)/.test(`${path} ${text}`)) return { kind: 'protected', policyOwner: 'destructive-action-policy', semanticToken: '--color-destructive-action', reason: 'Destructive actions require a protected semantic independent of decorative status colors.' }
  return null
}

export function suggestMigration(entry: ThemeColorOccurrenceEvidence): MigrationSuggestion {
  const stem = semanticStem(entry); const alpha = alphaFrom(entry.source.sourceText); const color = hue(entry); const source = entry.source.sourceText.toLowerCase(); const protectedValue = protectedDisposition(entry)
  let disposition: MigrationDisposition; let proposedCssVariable: string | null; let rationale: string; let risk: string; let migrationOwner: MigrationOwner
  if (protectedValue) {
    disposition = protectedValue; proposedCssVariable = protectedValue.semanticToken
    rationale = `The ${entry.channel} occurrence renders a policy-sensitive ${color.name} state on ${stem}; visual proximity to a Base slot must not choose its final policy value.`
    risk = 'Changing direction or risk semantics can invert user interpretation; #18 must resolve the protected value and contrast pairs.'; migrationOwner = '#18'
  } else if (/^transparent$|rgba\([^)]*,\s*0\)$/.test(source)) {
    disposition = { kind: 'allowed-literal', invariant: 'transparent-no-paint', reason: 'This occurrence explicitly removes paint rather than expressing a theme color.' }; proposedCssVariable = null
    rationale = `The ${entry.channel} channel uses transparent as a no-paint control value; replacing it with a chromatic token would change behavior.`
    risk = 'Keep the literal only at this exact occurrence; do not generalize it to nearby visible colors.'; migrationOwner = '#16'
  } else if (entry.channel.includes('shadow') && /black|#000|rgba\(0/.test(source)) {
    disposition = { kind: 'allowed-literal', invariant: 'physical-shadow', reason: 'The black alpha is a physical elevation primitive, not a foreground or surface identity.' }; proposedCssVariable = null
    rationale = 'The runtime evidence shows a shadow channel whose literal encodes physical occlusion rather than UI semantic color.'
    risk = 'Retain only if #16 confirms the shadow remains an elevation primitive and meets elevation requirements in both themes.'; migrationOwner = '#16'
  } else if (alpha !== null || /-dim|overlay|gradient|\/\d+$/.test(source)) {
    const token = `--color-${stem}-${color.name}-${entry.channel}-subtle`
    disposition = { kind: 'derived', baseSlots: [color.slot, 'base00'], colorSpace: 'oklch', mix: `${Math.round((alpha ?? 0.15) * 100)}% ${color.slot} over base00`, alpha, semanticToken: token }; proposedCssVariable = token
    rationale = `The ${entry.channel} channel is a translucent ${color.name} treatment for ${stem}; it needs a named state token derived in OKLCH instead of preserving component-local color arithmetic.`
    risk = 'Validate contrast and state differentiation in both themes after #16 defines the derived token.'; migrationOwner = '#16'
  } else {
    const token = `--color-${stem}-${color.name}-${entry.channel}`
    disposition = { kind: 'direct-base', baseSlot: color.slot, semanticToken: token }; proposedCssVariable = token
    rationale = `The evidence identifies a visible ${entry.channel} channel with ${color.name} semantics on ${stem}; map the semantic token to ${color.slot} rather than choosing by RGB distance.`
    risk = 'Confirm the selected Base slot preserves contrast and state hierarchy in light and dark themes.'; migrationOwner = '#16'
  }
  return { inventoryId: entry.inventoryId, currentLiteral: entry.source.sourceText, proposedCssVariable, disposition, rationale, risk, migrationOwner, evidence: { inventoryId: entry.inventoryId, source: entry.source, runtimeTarget: entry.target, scenario: entry.scenario, channel: entry.channel, actualValue: entry.actualValue, context: entry.context, crop: entry.crop, reviewIndexHref: `evidence/review-index.html#${entry.inventoryId}` } }
}

export async function assertEvidenceFiles(evidenceRoot: string, entries: readonly ThemeColorOccurrenceEvidence[]): Promise<void> {
  for (const entry of entries) for (const image of [entry.context, entry.crop]) if (sha256(await readFile(resolve(evidenceRoot, image.path))) !== image.sha256) throw new Error(`evidence hash mismatch: ${entry.inventoryId} ${image.path}`)
}

function assertDisposition(value: MigrationDisposition, label: string): void {
  if (value.kind === 'direct-base') { if (!BASE_SLOTS.has(value.baseSlot) || !CSS_VAR.test(value.semanticToken)) throw new Error(`${label} has invalid direct-base disposition`) }
  else if (value.kind === 'derived') { if (value.colorSpace !== 'oklch' || value.baseSlots.length < 2 || value.baseSlots.some((slot) => !BASE_SLOTS.has(slot)) || !CSS_VAR.test(value.semanticToken) || !value.mix.trim()) throw new Error(`${label} has invalid derived disposition`) }
  else if (value.kind === 'protected') { if (!CSS_VAR.test(value.semanticToken) || !value.reason.trim()) throw new Error(`${label} has invalid protected disposition`) }
  else if (value.kind === 'allowed-literal' || value.kind === 'non-runtime') { if (!value.reason.trim()) throw new Error(`${label} has an unjustified ${value.kind}`) }
  else { const neverDisposition: never = value; throw new Error(`${label} has unknown disposition: ${JSON.stringify(neverDisposition)}`) }
}

export function validateSuggestionManifest(manifest: MigrationSuggestionManifest, expectedIds: readonly string[]): void {
  if (manifest.schemaVersion !== 1 || !HASH.test(manifest.evidenceManifestSha256)) throw new Error('invalid suggestion manifest metadata')
  const expected = new Set(expectedIds); const seen = new Set<string>()
  for (const item of manifest.suggestions) {
    if (!expected.has(item.inventoryId)) throw new Error(`orphan suggestion: ${item.inventoryId}`)
    if (seen.has(item.inventoryId)) throw new Error(`duplicate suggestion: ${item.inventoryId}`); seen.add(item.inventoryId)
    if (item.evidence.inventoryId !== item.inventoryId || item.currentLiteral !== item.evidence.source.sourceText) throw new Error(`suggestion evidence identity mismatch: ${item.inventoryId}`)
    if (!item.rationale.trim() || !item.risk.trim()) throw new Error(`blank rationale/risk: ${item.inventoryId}`)
    assertDisposition(item.disposition, item.inventoryId)
    const variable = item.disposition.kind === 'direct-base' || item.disposition.kind === 'derived' || item.disposition.kind === 'protected' ? item.disposition.semanticToken : null
    if (item.proposedCssVariable !== variable) throw new Error(`proposed CSS variable mismatch: ${item.inventoryId}`)
    if (item.migrationOwner !== (item.disposition.kind === 'protected' ? '#18' : '#16')) throw new Error(`migration owner mismatch: ${item.inventoryId}`)
  }
  const missing = [...expected].filter((id) => !seen.has(id)); if (missing.length) throw new Error(`missing suggestions (${missing.length}): ${missing.join(', ')}`)
}

export function validateDecisionManifest(manifest: MigrationDecisionManifest, suggestions: MigrationSuggestionManifest): void {
  validateSuggestionManifest(suggestions, suggestions.suggestions.map((item) => item.inventoryId))
  if (manifest.schemaVersion !== 1 || manifest.sourceCommit !== suggestions.sourceCommit || manifest.suggestionManifestSha256 !== hashJson(suggestions)) throw new Error('decision manifest is stale or not linked to the suggestion manifest')
  const byId = new Map(suggestions.suggestions.map((item) => [item.inventoryId, item])); const seen = new Set<string>()
  for (const decision of manifest.decisions) {
    if (seen.has(decision.inventoryId)) throw new Error(`duplicate final decision: ${decision.inventoryId}`); seen.add(decision.inventoryId)
    const suggestion = byId.get(decision.inventoryId); if (!suggestion) throw new Error(`orphan final decision: ${decision.inventoryId}`)
    if (decision.reviewer.status !== 'accepted' || !decision.reviewer.reviewerId.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(decision.reviewer.reviewedAt)) throw new Error(`unreviewed final decision: ${decision.inventoryId}`)
    const { reviewer: _reviewer, ...decisionSuggestion } = decision
    if (JSON.stringify(decisionSuggestion) !== JSON.stringify(suggestion)) throw new Error(`final decision drifted from reviewed suggestion: ${decision.inventoryId}`)
    assertDisposition(decision.disposition, decision.inventoryId)
  }
  const missing = [...byId.keys()].filter((id) => !seen.has(id)); if (missing.length) throw new Error(`missing final decisions (${missing.length}): ${missing.join(', ')}`)
}

export function exportContracts(manifest: MigrationDecisionManifest): readonly [MigrationContractExport, MigrationContractExport] {
  const frontend = manifest.decisions.filter((item) => item.migrationOwner === '#16'); const protectedDecisions = manifest.decisions.filter((item) => item.migrationOwner === '#18')
  const all = [...frontend, ...protectedDecisions]; if (all.length !== manifest.decisions.length || new Set(all.map((item) => item.inventoryId)).size !== manifest.decisions.length) throw new Error('migration exports overlap or omit final decisions')
  return [{ schemaVersion: 1, sourceCommit: manifest.sourceCommit, owner: '#16', decisions: frontend }, { schemaVersion: 1, sourceCommit: manifest.sourceCommit, owner: '#18', decisions: protectedDecisions }]
}

export const hashJson = (value: unknown): string => sha256(`${JSON.stringify(value, null, 2)}\n`)
