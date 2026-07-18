import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type PolicyOwner = 'market-color-policy' | 'trading-risk-policy' | 'permission-risk-policy'
type SemanticKind = 'policy-variable' | 'theme-only' | 'no-paint'

interface ContractDecision {
  inventoryId: string
  currentLiteral: string
  proposedCssVariable: string
  disposition: { policyOwner: PolicyOwner; semanticToken: string }
  evidence: {
    source: { path: string }
    scenario: { scenarioId: string; state: string }
    channel: string
  }
}

interface Contract { sourceCommit: string; owner: string; decisions: ContractDecision[] }
interface ReceiptOccurrence {
  inventoryId: string
  semanticDisposition: { kind: SemanticKind }
  currentOutcome?: CurrentOutcome
}
interface CurrentOutcome {
  kind: 'exact-variable' | 'theme-channel' | 'local-theme-channel' | 'retained-no-paint' | 'unresolved-protected-literal'
  targetPath: string
  historicalLocator: { line: number; channel: string }
  targetLine: number | null
  sourceAssertion: string
  forbiddenHistoricalLiteral: string | null
}
interface Receipt {
  schemaVersion: number
  owner: string
  status: string
  historicalContract: {
    sourceCommit: string
    decisionCount: number
    reconciledCount: number
    stableInventoryIdCount: number
    spanIdMappingCount: number
    ownerCounts: Record<PolicyOwner, number>
    receipts: Array<{
      historical: ReceiptOccurrence
      mapping: { method: 'stable-inventory-id' | 'span-shift-semantic-signature'; currentInventoryId: string }
      currentOutcome: CurrentOutcome
    }>
  }
  supplementalContract: {
    sourceCommit: string
    decisionCount: number
    mappedFromHistoricalCount: number
    additionCount: number
    ownerCounts: Record<PolicyOwner, number>
    additions: ReceiptOccurrence[]
  }
  ownerSeparation: {
    issue16HistoricalIntersection: number
    issue16SupplementalIntersection: number
  }
  destructiveActionPolicy: {
    inventoryOccurrenceCount: number
    enforcement: string
    invariant: string
  }
  currentClosure: {
    decisionCount: number
    ownedCount: number
    unownedCount: number
    sourceEvidenceCount: number
    scanEvidence: {
      staticOccurrenceCount: number
      runtimeWorkItemCount: number
      capturedAtCommit: string
      staticManifest: { path: string; sha256: string }
      runtimeWorklist: { path: string; sha256: string }
    }
  }
}

const root = process.cwd()
const load = <T>(path: string): T => JSON.parse(readFileSync(resolve(root, path), 'utf8')) as T
const historical = load<Contract>('.artifacts/theme-color-audit/migration-contract-18.json')
const supplemental = load<Contract>('.artifacts/theme-color-audit/migration-contract-18-rebased-e9318e43.json')
const issue16Historical = load<Contract>('.artifacts/theme-color-audit/migration-contract-16.json')
const issue16Supplemental = load<Contract>('.artifacts/theme-color-audit/migration-contract-16-rebased-e9318e43.json')
const receipt = load<Receipt>('docs/theme-color-migration-18.json')

const semanticSignature = (decision: ContractDecision): string => [
  decision.evidence.source.path,
  decision.currentLiteral,
  decision.evidence.scenario.scenarioId,
  decision.evidence.scenario.state,
  decision.evidence.channel,
  decision.disposition.policyOwner,
  decision.disposition.semanticToken,
].join('\u0000')

const expectedSemanticKind = (decision: ContractDecision): SemanticKind => {
  if (decision.currentLiteral.toLowerCase().includes('transparent')) return 'no-paint'
  const themeOnlyTokens = new Set([
    '--color-market-muted',
    '--color-market-neutral-dark',
    '--color-market-on-strong',
    '--color-market-info',
  ])
  return decision.disposition.policyOwner === 'market-color-policy'
    && themeOnlyTokens.has(decision.disposition.semanticToken)
    ? 'theme-only'
    : 'policy-variable'
}

describe('#18 protected-color occurrence migration receipt', () => {
  it('reconciles the authoritative 83 decisions as 76 stable IDs and 7 span-shift IDs', () => {
    expect(receipt).toMatchObject({
      schemaVersion: 1,
      owner: '#18',
      status: 'historical-supplemental-and-current-reconciled',
      historicalContract: {
        sourceCommit: 'c34b2bd1f1b6e2be45de6620394f6c5a04b44dfb',
        decisionCount: 83,
        reconciledCount: 83,
        stableInventoryIdCount: 76,
        spanIdMappingCount: 7,
        ownerCounts: {
          'market-color-policy': 50,
          'trading-risk-policy': 31,
          'permission-risk-policy': 2,
        },
      },
    })
    expect(receipt.historicalContract.receipts).toHaveLength(83)

    const historicalById = new Map(historical.decisions.map((decision) => [decision.inventoryId, decision]))
    const supplementalById = new Map(supplemental.decisions.map((decision) => [decision.inventoryId, decision]))
    for (const item of receipt.historicalContract.receipts) {
      const before = historicalById.get(item.historical.inventoryId)
      const after = supplementalById.get(item.mapping.currentInventoryId)
      expect(before, `missing historical ${item.historical.inventoryId}`).toBeDefined()
      expect(after, `missing supplemental ${item.mapping.currentInventoryId}`).toBeDefined()
      if (!before || !after) continue
      if (item.mapping.method === 'stable-inventory-id') {
        expect(item.mapping.currentInventoryId).toBe(item.historical.inventoryId)
      } else {
        expect(item.mapping.currentInventoryId).not.toBe(item.historical.inventoryId)
        expect(semanticSignature(after)).toBe(semanticSignature(before))
      }
    }
  })

  it('owns all 88 rebased decisions and identifies exactly 5 supplemental occurrences', () => {
    expect(receipt.supplementalContract).toMatchObject({
      sourceCommit: 'e9318e43647f61b3f2070cc0fc59610f9144b857',
      decisionCount: 88,
      mappedFromHistoricalCount: 83,
      additionCount: 5,
      ownerCounts: {
        'market-color-policy': 50,
        'trading-risk-policy': 36,
        'permission-risk-policy': 2,
      },
    })
    expect(receipt.supplementalContract.additions).toHaveLength(5)
    expect(receipt.currentClosure).toMatchObject({ decisionCount: 88, ownedCount: 88, unownedCount: 0, sourceEvidenceCount: 88 })

    const mapped = receipt.historicalContract.receipts.map((item) => item.mapping.currentInventoryId)
    const additions = receipt.supplementalContract.additions.map((item) => item.inventoryId)
    expect(new Set([...mapped, ...additions])).toEqual(new Set(supplemental.decisions.map((item) => item.inventoryId)))
  })

  it('ties every rebased occurrence to exact post-migration source evidence', () => {
    const outcomes = [
      ...receipt.historicalContract.receipts.map((item) => item.currentOutcome),
      ...receipt.supplementalContract.additions.map((item) => item.currentOutcome!),
    ]
    expect(outcomes).toHaveLength(88)
    for (const outcome of outcomes) {
      expect(outcome.kind).not.toBe('unresolved-protected-literal')
      expect(outcome.targetLine).not.toBeNull()
      const source = readFileSync(resolve(root, outcome.targetPath), 'utf8')
      const targetLine = outcome.targetLine === null ? '' : source.split('\n')[outcome.targetLine - 1]
      expect(targetLine, `${outcome.targetPath}:${outcome.targetLine ?? '?'} must contain ${outcome.sourceAssertion}`)
        .toContain(outcome.sourceAssertion)
      if (outcome.forbiddenHistoricalLiteral !== null) {
        expect(source, `${outcome.targetPath} still contains protected literal ${outcome.forbiddenHistoricalLiteral}`)
          .not.toContain(outcome.forbiddenHistoricalLiteral)
      }
    }
  })

  it('records a fresh static scan and non-variable runtime worklist snapshot', () => {
    const evidence = receipt.currentClosure.scanEvidence
    expect(evidence).toMatchObject({ capturedAtCommit: 'working-tree' })
    const staticBytes = readFileSync(resolve(root, evidence.staticManifest.path))
    const worklistBytes = readFileSync(resolve(root, evidence.runtimeWorklist.path))
    expect(createHash('sha256').update(staticBytes).digest('hex')).toBe(evidence.staticManifest.sha256)
    expect(createHash('sha256').update(worklistBytes).digest('hex')).toBe(evidence.runtimeWorklist.sha256)
    const staticManifest = JSON.parse(staticBytes.toString()) as { occurrences: unknown[] }
    const runtimeWorklist = JSON.parse(worklistBytes.toString()) as { items: unknown[] }
    expect(staticManifest.occurrences).toHaveLength(evidence.staticOccurrenceCount)
    expect(runtimeWorklist.items).toHaveLength(evidence.runtimeWorkItemCount)
  })

  it('gives every occurrence one explicit semantic disposition', () => {
    const receiptByCurrentId = new Map([
      ...receipt.historicalContract.receipts.map((item) => [item.mapping.currentInventoryId, item.historical] as const),
      ...receipt.supplementalContract.additions.map((item) => [item.inventoryId, item] as const),
    ])
    expect(receiptByCurrentId.size).toBe(88)
    for (const decision of supplemental.decisions) {
      const occurrence = receiptByCurrentId.get(decision.inventoryId)
      expect(occurrence, `missing disposition for ${decision.inventoryId}`).toBeDefined()
      expect(occurrence?.semanticDisposition.kind).toBe(expectedSemanticKind(decision))
    }
  })

  it('keeps the #16 and #18 contracts mutually exclusive at both snapshots', () => {
    const intersectionSize = (left: ContractDecision[], right: ContractDecision[]): number => {
      const rightIds = new Set(right.map((decision) => decision.inventoryId))
      return left.filter((decision) => rightIds.has(decision.inventoryId)).length
    }
    expect(intersectionSize(historical.decisions, issue16Historical.decisions)).toBe(0)
    expect(intersectionSize(supplemental.decisions, issue16Supplemental.decisions)).toBe(0)
    expect(receipt.ownerSeparation).toEqual({
      issue16HistoricalIntersection: 0,
      issue16SupplementalIntersection: 0,
    })
  })

  it('does not fabricate a destructive inventory owner and records its runtime invariant', () => {
    expect(new Set(historical.decisions.map((decision) => decision.disposition.policyOwner))).toEqual(new Set([
      'market-color-policy',
      'trading-risk-policy',
      'permission-risk-policy',
    ]))
    expect(receipt.destructiveActionPolicy).toMatchObject({
      inventoryOccurrenceCount: 0,
      enforcement: 'zero-occurrence-runtime-invariant',
    })
    expect(receipt.destructiveActionPolicy.invariant).toContain('--oa-risk-destructive')
  })
})
