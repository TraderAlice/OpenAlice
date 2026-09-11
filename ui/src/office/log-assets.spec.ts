import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { OFFICE_LOG_ASSETS, officeLogAssetKind } from './log-assets'

const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10]
const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../public')

describe('OFFICE_LOG_ASSETS', () => {
  it('keeps the generated journal badges stable', () => {
    expect(OFFICE_LOG_ASSETS).toEqual({
      lifecycle: '/office/log/lifecycle-v1.png',
      message: '/office/log/message-v1.png',
      tool: '/office/log/tool-action-v1.png',
      alert: '/office/log/alert-v1.png',
    })

    for (const url of Object.values(OFFICE_LOG_ASSETS)) {
      const bytes = readFileSync(resolve(publicRoot, url.replace(/^\//, '')))
      expect([...bytes.subarray(0, 8)]).toEqual(PNG_MAGIC)
      expect(bytes[25]).toBe(6) // PNG color type 6: RGBA.
      expect(bytes.byteLength).toBeGreaterThan(1000)
    }
  })

  it('maps every runtime event family to a stable visual category', () => {
    expect(officeLogAssetKind('session.born')).toBe('lifecycle')
    expect(officeLogAssetKind('runtime.started')).toBe('lifecycle')
    expect(officeLogAssetKind('runtime.stopped')).toBe('lifecycle')
    expect(officeLogAssetKind('runtime.turn.text')).toBe('message')
    expect(officeLogAssetKind('runtime.turn.tool')).toBe('tool')
    expect(officeLogAssetKind('runtime.turn.error')).toBe('alert')
    expect(officeLogAssetKind('runtime.spawn_failed')).toBe('alert')
    expect(officeLogAssetKind('runtime.rejected')).toBe('alert')
  })
})
