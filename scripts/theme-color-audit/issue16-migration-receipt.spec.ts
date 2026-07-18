import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface ReceiptItem { inventoryId: string }
interface MigrationReceipt {
  schemaVersion: number
  owner: string
  status: string
  historicalContract: { sourceCommit: string; decisionCount: number; reconciledCount: number; receipts: unknown[] }
  supplementalContract: { decisionCount: number; mappedFromHistoricalCount: number; additionCount: number; additions: unknown[] }
  ownerSeparation: { excludedDecisionCount: number; historicalInventoryIdIntersection: number; supplementalInventoryIdIntersection: number; xtermDeferredCount: number }
  contractCorrections: { evidenceUrl: string; historicalCorrectionCount: number; historicalInventoryIds: string[] }
  currentClosure: {
    runtimeWorkItemCount: number
    ownedCount: number
    unownedCount: number
    categories: {
      protectedIssue18: { count: number; receipts: ReceiptItem[] }
      deferredXtermIssue17: { count: number; receipts: ReceiptItem[] }
      allowedLiteralIssue16: { count: number; receipts: ReceiptItem[] }
    }
  }
}

const receipt = JSON.parse(readFileSync(resolve(process.cwd(), 'docs/theme-color-migration-16.json'), 'utf8')) as MigrationReceipt

describe('#16 reviewed occurrence migration receipt', () => {
  it('reconciles the exact #21 closure contract and keeps owner boundaries explicit', () => {
    expect(receipt).toMatchObject({
      schemaVersion: 2,
      owner: '#16',
      status: 'historical-and-supplemental-reconciled',
      historicalContract: {
        sourceCommit: 'c34b2bd1f1b6e2be45de6620394f6c5a04b44dfb',
        decisionCount: 193,
        reconciledCount: 193,
      },
      supplementalContract: { decisionCount: 240, mappedFromHistoricalCount: 178, additionCount: 62 },
      ownerSeparation: {
        excludedDecisionCount: 83,
        historicalInventoryIdIntersection: 0,
        supplementalInventoryIdIntersection: 0,
        xtermDeferredCount: 6,
      },
    })
    expect(receipt.historicalContract.receipts).toHaveLength(193)
    expect(receipt.contractCorrections).toMatchObject({
      evidenceUrl: 'https://github.com/mouriya-s-lab/OpenAlice/issues/21#issuecomment-5008677922',
      historicalCorrectionCount: 15,
    })
    expect(receipt.contractCorrections.historicalInventoryIds).toHaveLength(15)
    expect(receipt.supplementalContract.additions).toHaveLength(62)
  })

  it('owns every remaining non-variable runtime occurrence without a regex allowlist', () => {
    const categories = receipt.currentClosure.categories
    expect(categories.protectedIssue18.receipts).toHaveLength(categories.protectedIssue18.count)
    expect(categories.deferredXtermIssue17.receipts).toHaveLength(categories.deferredXtermIssue17.count)
    expect(categories.allowedLiteralIssue16.receipts).toHaveLength(categories.allowedLiteralIssue16.count)
    const ids = Object.values(categories).flatMap((category) => category.receipts.map((item) => item.inventoryId))
    expect(new Set(ids).size).toBe(receipt.currentClosure.runtimeWorkItemCount)
    expect(receipt.currentClosure).toMatchObject({ runtimeWorkItemCount: 133, ownedCount: 133, unownedCount: 0 })
  })
})
