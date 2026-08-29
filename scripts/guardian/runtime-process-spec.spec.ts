import { describe, expect, it } from 'vitest'

import { runtimeProcessSpec } from './runtime-process-spec.mjs'

describe('runtimeProcessSpec', () => {
  it('re-enters the Bun standalone executable under a private role', () => {
    expect(runtimeProcessSpec({
      role: 'uta',
      legacyPath: 'services/uta/dist/uta.js',
      provider: 'bun',
      executable: '/opt/openalice/bin/openalice',
      nodeBinary: '/usr/bin/node',
    })).toEqual({
      cmd: '/opt/openalice/bin/openalice',
      args: ['--internal-role', 'uta'],
    })
  })

  it('preserves the existing Node service entrypoint for other providers', () => {
    expect(runtimeProcessSpec({
      role: 'alice',
      legacyPath: 'dist/main.js',
      provider: 'source',
      executable: '/opt/openalice/bin/openalice',
      nodeBinary: '/usr/bin/node',
    })).toEqual({
      cmd: '/usr/bin/node',
      args: ['dist/main.js'],
    })
  })
})
