import { describe, expect, it } from 'vitest'

import {
  bunGuardianProcessSpec,
  resolveBunResourceRoot,
} from './bun-standalone.mjs'

describe('Bun standalone launch boundary', () => {
  it('derives an installed sidecar resource root from the executable', () => {
    expect(resolveBunResourceRoot({}, '/opt/openalice/releases/v1/bin/openalice'))
      .toBe('/opt/openalice/releases/v1/share/openalice')
  })

  it('allows an explicit resource root for development acceptance', () => {
    expect(resolveBunResourceRoot(
      { OPENALICE_APP_HOME: '/tmp/openalice-resources' },
      '/opt/openalice/bin/openalice',
    )).toBe('/tmp/openalice-resources')
  })

  it('re-enters the executable as Guardian', () => {
    expect(bunGuardianProcessSpec('/opt/openalice/bin/openalice')).toEqual({
      cmd: '/opt/openalice/bin/openalice',
      args: ['--internal-role', 'guardian'],
    })
  })
})
