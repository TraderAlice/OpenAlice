import { describe, expect, it } from 'vitest'
import { validateOccurrenceEvidenceRecord, validateOccurrenceJpeg } from './evidence.js'
import type { OccurrenceEvidenceRecord, StaticColorOccurrence } from './types.js'

const source: StaticColorOccurrence = {
  inventoryId: 'color-fixture', path: 'ui/src/Fixture.tsx', sourceText: '#fff', sourceClass: 'runtime',
  syntaxKind: 'typescript-color-literal', ownerHint: 'Fixture',
  span: { startOffset: 0, endOffset: 4, startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
}

const visual = (): Extract<OccurrenceEvidenceRecord, { kind: 'visual-element' }> => ({
  kind: 'visual-element', inventoryId: source.inventoryId, source, bindingIndex: 0, scenarioId: 'fixture', theme: 'light', state: 'normal',
  surfaceKind: 'dom-element', channel: 'color', actualValue: 'rgb(255, 255, 255)', locator: '#fixture', viewport: { width: 100, height: 100 }, deviceScaleFactor: 1,
  targetBounds: { x: 10, y: 10, width: 20, height: 20 }, annotation: { label: 'color-fixture · color', color: '#ff2d55', bounds: { x: 10, y: 10, width: 20, height: 20 } },
  context: { relativePath: 'context.jpg', sha256: 'bad', format: 'jpeg', quality: 80, width: 100, height: 100 },
  crop: { relativePath: 'crop.jpg', sha256: 'bad', format: 'jpeg', quality: 80, width: 40, height: 40, targetBoundsInImage: { x: 10, y: 10, width: 20, height: 20 } },
})

describe('occurrence screenshot annotations', () => {
  it('requires a label, channel, positive target and in-image crop bounds', () => {
    expect(() => validateOccurrenceEvidenceRecord(visual())).not.toThrow()
    expect(() => validateOccurrenceEvidenceRecord({ ...visual(), targetBounds: { x: 10, y: 10, width: 0, height: 20 } })).toThrow('zero area')
    expect(() => validateOccurrenceEvidenceRecord({ ...visual(), annotation: { ...visual().annotation, label: 'unrelated' } })).toThrow('does not identify')
    expect(() => validateOccurrenceEvidenceRecord({ ...visual(), channel: '--color-bg' })).toThrow('CSS variable definition')
    expect(() => validateOccurrenceEvidenceRecord({ ...visual(), locator: '[data-openalice-color-audit~="color-other"]' })).toThrow('locator does not identify')
    expect(() => validateOccurrenceEvidenceRecord({ ...visual(), crop: { ...visual().crop, targetBoundsInImage: { x: 30, y: 30, width: 20, height: 20 } } })).toThrow('crop bounds')
  })

  it('rejects missing, blank and substituted JPEG bytes', () => {
    expect(() => validateOccurrenceJpeg(visual(), 'context', new Uint8Array())).toThrow('invalid or blank')
    const bytes = new Uint8Array(1_100); bytes[0] = 0xff; bytes[1] = 0xd8
    expect(() => validateOccurrenceJpeg(visual(), 'crop', bytes)).toThrow('SHA-256 mismatch')
  })

  it('does not allow a non-visual record without a runtime binding', () => {
    expect(() => validateOccurrenceEvidenceRecord({ kind: 'non-visual-probe', inventoryId: source.inventoryId, source, bindingIndexes: [], reason: 'runtime-value' })).toThrow('no runtime binding')
  })
})
