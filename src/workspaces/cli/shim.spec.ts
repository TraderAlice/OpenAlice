import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, it, expect } from 'vitest'

/**
 * The CLI shim is ONE file shipped under each export name as a byte-identical
 * copy (it self-detects which export it is via argv[0]). Guard the copies
 * against drift — if they diverge, one binary would lag behind a shim fix.
 * Add a new copy here whenever a new `alice-*` export ships.
 */
const EXPORT_BINARIES = ['alice', 'alice-workspace']

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`bin/${name}`, import.meta.url)))

describe('CLI shim copies', () => {
  it('every export binary is byte-identical to the canonical `alice` shim', () => {
    const canonical = read('alice')
    for (const name of EXPORT_BINARIES) {
      expect(read(name).equals(canonical), `${name} has drifted from the alice shim`).toBe(true)
    }
  })

  it('the shim self-detects the export (no hardcoded binary name)', () => {
    const src = read('alice').toString('utf8')
    expect(src).toContain('process.argv[1]') // derives BIN from how it was invoked
    expect(src).toContain('exportKey') // routes to the per-export gateway path
  })
})
