import type { RuntimeColorWorklist, SyntaxKind } from './types.js'

export const residualScenarioGroups = [
  'agent-permissions', 'ai-credential-dialog', 'automation-api', 'automation-runs', 'chat',
  'connector-settings', 'connector-status', 'create-uta-dialog', 'first-run', 'global-css',
  'inbox', 'issue-detail', 'issues-board', 'market-board', 'market-detail', 'market-rotation',
  'onboarding-design', 'portfolio', 'simulator', 'trading-as-git', 'trading-settings',
  'uta-detail', 'workspace-config-dialog', 'workspace-mobile', 'workspace-overview', 'workspace-terminal',
] as const

export type ResidualScenarioGroup = typeof residualScenarioGroups[number]
export type ResidualDisposition =
  | { readonly kind: 'transparent-no-paint' | 'alpha-mix-endpoint'; readonly scenarioGroup: ResidualScenarioGroup }
  | { readonly kind: 'physical-shadow'; readonly scenarioGroup: ResidualScenarioGroup }
  | { readonly kind: 'protected-source-data' }
  | { readonly kind: 'must-migrate'; readonly scenarioGroup: ResidualScenarioGroup }

export interface ResidualDecision {
  readonly inventoryId: string
  readonly source: { readonly path: string; readonly sourceText: string; readonly syntaxKind: SyntaxKind; readonly ownerHint: string | null }
  readonly disposition: ResidualDisposition
}

export interface ResidualReview { readonly schemaVersion: 1; readonly decisions: readonly ResidualDecision[] }

export const EXPECTED_RESIDUAL_COUNTS = { total: 56, transparent: 43, physicalShadow: 5, protectedSourceData: 8, mustMigrate: 0, browserTargets: 48 } as const

export function validateResidualReview(worklist: RuntimeColorWorklist, review: ResidualReview): void {
  if (review.schemaVersion !== 1) throw new Error(`unsupported residual review schema: ${String(review.schemaVersion)}`)
  const current = new Map(worklist.items.map((item) => [item.inventoryId, item.source]))
  const seen = new Set<string>()
  const declaredGroups = new Set<string>(residualScenarioGroups)
  for (const decision of review.decisions) {
    if (seen.has(decision.inventoryId)) throw new Error(`duplicate residual decision: ${decision.inventoryId}`)
    seen.add(decision.inventoryId)
    const source = current.get(decision.inventoryId)
    if (!source) throw new Error(`stale or unknown residual decision: ${decision.inventoryId}`)
    for (const key of ['path', 'sourceText', 'syntaxKind', 'ownerHint'] as const) {
      if (decision.source[key] !== source[key]) throw new Error(`${decision.inventoryId}: source fingerprint mismatch for ${key}`)
    }
    if (decision.disposition.kind === 'protected-source-data') {
      if (source.path !== 'ui/src/theme/colorPolicy.ts' || source.ownerHint !== 'protectedColors') {
        throw new Error(`${decision.inventoryId}: protected-source-data is only valid for colorPolicy.ts protectedColors`)
      }
    } else if (!declaredGroups.has(decision.disposition.scenarioGroup)) {
      throw new Error(`${decision.inventoryId}: undeclared scenario group ${decision.disposition.scenarioGroup}`)
    }
  }
  const missing = worklist.items.filter((item) => !seen.has(item.inventoryId)).map((item) => item.inventoryId)
  if (missing.length) throw new Error(`runtime work items missing residual decisions (${missing.length}):\n${missing.join('\n')}`)
  const count = (kind: ResidualDisposition['kind']): number => review.decisions.filter((item) => item.disposition.kind === kind).length
  const transparent = count('transparent-no-paint') + count('alpha-mix-endpoint')
  const browserTargets = review.decisions.filter((item) => item.disposition.kind !== 'protected-source-data').length
  const actual = { total: review.decisions.length, transparent, physicalShadow: count('physical-shadow'), protectedSourceData: count('protected-source-data'), mustMigrate: count('must-migrate'), browserTargets }
  if (actual.mustMigrate !== 0) throw new Error(`residual mustMigrate count: expected 0, received ${actual.mustMigrate}`)
  for (const key of Object.keys(EXPECTED_RESIDUAL_COUNTS) as Array<keyof typeof EXPECTED_RESIDUAL_COUNTS>) {
    if (actual[key] !== EXPECTED_RESIDUAL_COUNTS[key]) throw new Error(`residual ${key} count: expected ${EXPECTED_RESIDUAL_COUNTS[key]}, received ${actual[key]}`)
  }
}

export function browserTargetIds(review: ResidualReview): readonly string[] {
  return review.decisions.filter((item) => item.disposition.kind !== 'protected-source-data').map((item) => item.inventoryId)
}

export function scenarioInventoryFromReview(review: ResidualReview): Record<ResidualScenarioGroup, string[]> {
  const result = Object.fromEntries(residualScenarioGroups.map((group) => [group, []])) as Record<ResidualScenarioGroup, string[]>
  for (const decision of review.decisions) if ('scenarioGroup' in decision.disposition) result[decision.disposition.scenarioGroup].push(decision.inventoryId)
  return result
}
