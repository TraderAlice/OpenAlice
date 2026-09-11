import { describe, expect, it } from 'vitest'

import { parseRemoteSshSmokeOptions } from './remote-ssh-smoke-options.mjs'

describe('parseRemoteSshSmokeOptions', () => {
  it('accepts pnpm argument separators', () => {
    expect(parseRemoteSshSmokeOptions(['--', '--skip-tui'])).toEqual({
      help: false,
      image: undefined,
      keepContainer: false,
      keepImage: false,
      skipBuild: false,
      skipTui: true,
    })
  })

  it('supports building and reusing a named image', () => {
    expect(parseRemoteSshSmokeOptions([
      '--image', 'openalice-remote-smoke:dev',
      '--skip-build',
      '--keep-container',
    ])).toEqual(expect.objectContaining({
      image: 'openalice-remote-smoke:dev',
      skipBuild: true,
      keepContainer: true,
    }))
  })

  it('rejects skip-build without an explicit image', () => {
    expect(() => parseRemoteSshSmokeOptions(['--skip-build']))
      .toThrow('--skip-build requires --image <name>')
  })

  it('rejects a missing image value before consuming the next option', () => {
    expect(() => parseRemoteSshSmokeOptions(['--image', '--skip-tui']))
      .toThrow('--image requires a Docker image name')
  })

  it('rejects unknown options', () => {
    expect(() => parseRemoteSshSmokeOptions(['--wat']))
      .toThrow('unknown option: --wat')
  })
})
