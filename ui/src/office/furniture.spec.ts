import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { OFFICE_FURNITURE } from './furniture'

const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10]
const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../public')

describe('OFFICE_FURNITURE', () => {
  it('ships pixel PNG props and does not reference photoreal JPEGs', () => {
    expect(OFFICE_FURNITURE.desk).toBe('/office/furniture/desk.png')
    expect(OFFICE_FURNITURE.chair).toBe('/office/furniture/chair.png')
    expect(OFFICE_FURNITURE.cabinet).toBe('/office/furniture/cabinet.png')
    expect(OFFICE_FURNITURE.generated.workstation).toBe('/office/furniture/workstation-v1.png')
    expect(OFFICE_FURNITURE.generated.cabinet).toBe('/office/furniture/filing-cabinet-v1.png')
    for (const url of [
      OFFICE_FURNITURE.desk,
      OFFICE_FURNITURE.chair,
      OFFICE_FURNITURE.cabinet,
      OFFICE_FURNITURE.coffee,
      OFFICE_FURNITURE.plant,
      ...Object.values(OFFICE_FURNITURE.generated),
    ]) {
      expect(url.endsWith('.png')).toBe(true)
      expect(url.includes('.jpg')).toBe(false)
      expect(url.includes('treadmill')).toBe(false)
      const file = resolve(publicRoot, url.replace(/^\//, ''))
      const bytes = readFileSync(file)
      expect([...bytes.subarray(0, 8)]).toEqual(PNG_MAGIC)
      expect(bytes.byteLength).toBeGreaterThan(1000)
    }
  })
})
