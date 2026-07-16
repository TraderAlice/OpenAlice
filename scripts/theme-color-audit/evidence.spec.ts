import { describe, expect, it } from 'vitest'
import { evidenceImageName, sha256, sortEvidence, validateEvidenceContent } from './evidence.js'
import type { EvidenceImage } from './types.js'

describe('theme color evidence identity', () => {
  it('uses stable scenario and theme file names', () => {
    expect(evidenceImageName('workspace-config-dialog', 'dark')).toBe('workspace-config-dialog--dark.jpg')
  })

  it('sorts records independently of capture enumeration order', () => {
    const base = { state: 'normal', relativePath: 'x.jpg', sha256: 'x', format: 'jpeg', quality: 80, width: 1, height: 1, viewport: { width: 1, height: 1 }, deviceScaleFactor: 1, inventoryIds: [] } as const
    const images: EvidenceImage[] = [
      { ...base, scenarioId: 'z', theme: 'light' }, { ...base, scenarioId: 'a', theme: 'dark' },
    ]
    expect(sortEvidence(images).map((image) => `${image.scenarioId}/${image.theme}`)).toEqual(['a/dark', 'z/light'])
    expect(sha256(new TextEncoder().encode('evidence'))).toHaveLength(64)
  })

  it('rejects blank or substituted screenshot bytes', () => {
    const image: EvidenceImage = {
      scenarioId: 'fixture', theme: 'light', state: 'normal', relativePath: 'fixture.jpg', sha256: 'wrong',
      format: 'jpeg', quality: 80, width: 10, height: 10, viewport: { width: 10, height: 10 },
      deviceScaleFactor: 1, inventoryIds: ['color-fixture'],
    }
    expect(() => validateEvidenceContent(image, new Uint8Array())).toThrow('invalid or blank JPEG')
  })
})
