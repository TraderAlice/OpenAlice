import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { OFFICE_HUD_ASSETS } from './hud-assets'

const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10]
const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../public')

describe('OFFICE_HUD_ASSETS', () => {
  it('ships generated RGBA pixel controls', () => {
    expect(OFFICE_HUD_ASSETS.movePad).toBe('/office/hud/move-pad-v1.png')
    expect(OFFICE_HUD_ASSETS.resetCompass).toBe('/office/hud/reset-compass-v1.png')

    for (const url of Object.values(OFFICE_HUD_ASSETS)) {
      const bytes = readFileSync(resolve(publicRoot, url.replace(/^\//, '')))
      expect([...bytes.subarray(0, 8)]).toEqual(PNG_MAGIC)
      expect(bytes[25]).toBe(6) // PNG color type 6: RGBA.
      expect(bytes.byteLength).toBeGreaterThan(1000)
    }
  })
})
