import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { ThemePalette } from '../api/themes'
import { projectSemanticConsumerVariables } from './semanticConsumers'

const palette: ThemePalette = {
  base00: '#101010', base01: '#181818', base02: '#282828', base03: '#585858',
  base04: '#b8b8b8', base05: '#d8d8d8', base06: '#e8e8e8', base07: '#f8f8f8',
  base08: '#ab4642', base09: '#dc9656', base0A: '#f7ca88', base0B: '#a1b56c',
  base0C: '#86c1b9', base0D: '#7cafc2', base0E: '#ba8baf', base0F: '#a16946',
}

interface DerivedDisposition {
  kind: 'derived'
  baseSlots: [keyof ThemePalette, keyof ThemePalette]
  colorSpace: 'oklch'
  alpha: number
}

type ReviewedDisposition = DerivedDisposition | { kind: string }

interface MigrationReceipt {
  historicalContract: {
    decisionCount: number
    reconciledCount: number
    receipts: Array<{
      historical: { inventoryId: string; reviewDisposition: ReviewedDisposition }
      currentResult: { outcome: string; cssVariable: `--color-${string}` | null }
    }>
  }
  supplementalContract: {
    decisionCount: number
    mappedFromHistoricalCount: number
    additionCount: number
    additions: Array<{
      supplemental: { inventoryId: string; reviewDisposition: ReviewedDisposition }
      currentResult: { outcome: string; cssVariable: `--color-${string}` | null }
    }>
  }
  ownerSeparation: {
    historicalInventoryIdIntersection: number
    supplementalInventoryIdIntersection: number
    xtermDeferredCount: number
  }
}

describe('reviewed #16 semantic consumers', () => {
  it('projects every supplemental migrated consumer through the typed authority', () => {
    const projection = projectSemanticConsumerVariables(palette)
    const receipt = JSON.parse(readFileSync(
      resolve(process.cwd(), 'docs/theme-color-migration-16.json'),
      'utf8',
    )) as MigrationReceipt

    expect(receipt.historicalContract).toMatchObject({ decisionCount: 193, reconciledCount: 193 })
    expect(receipt.supplementalContract).toMatchObject({
      decisionCount: 240,
      mappedFromHistoricalCount: 178,
      additionCount: 62,
    })
    expect(receipt.ownerSeparation).toEqual(expect.objectContaining({
      historicalInventoryIdIntersection: 0,
      supplementalInventoryIdIntersection: 0,
      xtermDeferredCount: 6,
    }))
    const results = [
      ...receipt.historicalContract.receipts.map((item) => ({
        inventoryId: item.historical.inventoryId,
        ...item.currentResult,
      })),
      ...receipt.supplementalContract.additions.map((item) => ({
        inventoryId: item.supplemental.inventoryId,
        ...item.currentResult,
      })),
    ]
    expect(results.filter(({ outcome }) => outcome === 'removed-before-migration')).toHaveLength(15)
    expect(results.filter(({ outcome }) => outcome === 'deferred-owner-17-xterm')).toHaveLength(6)
    for (const item of results) {
      if (item.outcome.startsWith('migrated-')) {
        expect(item.cssVariable, item.inventoryId).not.toBeNull()
        expect(projection, item.inventoryId).toHaveProperty(item.cssVariable!)
      }
    }
  })


  it('preserves both reviewed OKLCH endpoints and percentage for every migrated derived receipt', () => {
    const projection = projectSemanticConsumerVariables(palette)
    const receipt = JSON.parse(readFileSync(
      resolve(process.cwd(), 'docs/theme-color-migration-16.json'),
      'utf8',
    )) as MigrationReceipt
    const decisions = [
      ...receipt.historicalContract.receipts.map(({ historical, currentResult }) => ({
        inventoryId: historical.inventoryId,
        disposition: historical.reviewDisposition,
        currentResult,
      })),
      ...receipt.supplementalContract.additions.map(({ supplemental, currentResult }) => ({
        inventoryId: supplemental.inventoryId,
        disposition: supplemental.reviewDisposition,
        currentResult,
      })),
    ]
    for (const decision of decisions) {
      if (decision.disposition.kind !== 'derived' || decision.currentResult.cssVariable === null) continue
      const disposition = decision.disposition as DerivedDisposition
      const [foreground, background] = disposition.baseSlots
      expect(projection[decision.currentResult.cssVariable], decision.inventoryId).toBe(
        `color-mix(in oklch, ${palette[foreground]} ${Math.round(disposition.alpha * 100)}%, ${palette[background]})`,
      )
    }
  })

  it('keeps reviewed alpha variants distinct instead of collapsing semantics', () => {
    const projection = projectSemanticConsumerVariables(palette)
    expect(projection['--color-issue-detail-warning-border-subtle-alpha-25'])
      .toBe('color-mix(in oklch, #f7ca88 25%, #101010)')
    expect(projection['--color-issue-detail-warning-border-subtle-alpha-30'])
      .toBe('color-mix(in oklch, #f7ca88 30%, #101010)')
    expect(projection['--color-issue-detail-warning-border-subtle-alpha-60'])
      .toBe('color-mix(in oklch, #f7ca88 60%, #101010)')
  })
})
