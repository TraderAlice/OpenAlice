import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  MIGRATION_BASELINE,
  NEXT_MIGRATION_NUMBER,
  REGISTRY,
} from './registry.js'

describe('migration baseline', () => {
  it('keeps retired development migrations out of the runtime registry', () => {
    expect(MIGRATION_BASELINE).toBe('0.89.2-beta')
    expect(NEXT_MIGRATION_NUMBER).toBe(40)
    expect(REGISTRY.map((migration) => Number.parseInt(migration.id.slice(0, 4), 10)))
      .toEqual([39])
  })

  it('runs unit tests inside one isolated complete home', () => {
    const home = process.env['OPENALICE_HOME']
    expect(home).toBeTruthy()
    expect(process.env['AQ_LAUNCHER_ROOT']).toBe(join(home!, 'workspaces'))
    expect(process.env['OPENALICE_GLOBAL_DIR']).toBe(join(home!, 'global'))
  })
})
