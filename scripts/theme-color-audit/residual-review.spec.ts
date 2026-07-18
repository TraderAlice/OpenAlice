import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { residualReview } from './residual-review-data.js'
import { validateResidualReview, type ResidualReview } from './residual-review.js'
import type { RuntimeColorWorklist } from './types.js'

const worklist = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../.artifacts/theme-color-audit/runtime-worklist.json'), 'utf8')) as RuntimeColorWorklist
const review = (): ResidualReview => structuredClone(residualReview)
const replacing = (index: number, decision: ResidualReview['decisions'][number]): ResidualReview => ({ ...review(), decisions: review().decisions.map((item, itemIndex) => itemIndex === index ? decision : item) })

describe('post-migration residual review', () => {
  it('covers the current runtime worklist with the approved disposition counts', () => expect(() => validateResidualReview(worklist, review())).not.toThrow())
  it('rejects stale, missing, duplicate, and changed-source decisions', () => {
    const base = review()
    expect(() => validateResidualReview(worklist, replacing(0, { ...base.decisions[0]!, inventoryId: 'color-stale' }))).toThrow('stale or unknown')
    expect(() => validateResidualReview(worklist, { ...base, decisions: base.decisions.slice(1) })).toThrow('missing residual decisions')
    expect(() => validateResidualReview(worklist, replacing(1, { ...base.decisions[1]!, inventoryId: base.decisions[0]!.inventoryId }))).toThrow('duplicate residual decision')
    expect(() => validateResidualReview(worklist, replacing(0, { ...base.decisions[0]!, source: { ...base.decisions[0]!.source, sourceText: 'changed' } }))).toThrow('source fingerprint mismatch')
  })
  it('rejects undeclared scenario groups and must-migrate residuals', () => {
    const base = review()
    expect(() => validateResidualReview(worklist, replacing(0, { ...base.decisions[0]!, disposition: { kind: 'transparent-no-paint', scenarioGroup: 'undeclared' as never } }))).toThrow('undeclared scenario group')
    expect(() => validateResidualReview(worklist, replacing(0, { ...base.decisions[0]!, disposition: { kind: 'must-migrate', scenarioGroup: 'market-detail' } }))).toThrow('mustMigrate count')
  })
})
