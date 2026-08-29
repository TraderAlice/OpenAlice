import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'

import {
  buildBunRuntimeEnvironment,
  bunGuardianProcessSpec,
  resolveBunContentIdentity,
  resolveBunResourceRoot,
} from './bun-standalone.mjs'

describe('Bun standalone launch boundary', () => {
  it('derives an installed sidecar resource root from the executable', () => {
    expect(resolveBunResourceRoot({}, '/opt/openalice/releases/v1/bin/openalice'))
      .toBe(resolve('/opt/openalice/releases/v1/share/openalice'))
  })

  it('allows an explicit resource root for development acceptance', () => {
    expect(resolveBunResourceRoot(
      { OPENALICE_APP_HOME: '/tmp/openalice-resources' },
      '/opt/openalice/bin/openalice',
    )).toBe(resolve('/tmp/openalice-resources'))
  })

  it('re-enters the executable as Guardian', () => {
    expect(bunGuardianProcessSpec('/opt/openalice/bin/openalice')).toEqual({
      cmd: '/opt/openalice/bin/openalice',
      args: ['--internal-role', 'guardian'],
    })
  })

  it('injects the release-owned Git without discarding the user PATH', () => {
    const resourceRoot = resolve('/opt/openalice/share/openalice')
    expect(buildBunRuntimeEnvironment(
      { PATH: '/usr/local/bin', KEEP: 'yes' },
      resourceRoot,
      '/opt/openalice/bin/openalice',
    )).toEqual(expect.objectContaining({
      KEEP: 'yes',
      OPENALICE_RUNTIME_EXECUTABLE: '/opt/openalice/bin/openalice',
      LOCAL_GIT_DIRECTORY: resolve(resourceRoot, 'runtime/git'),
      GIT_EXEC_PATH: resolve(resourceRoot, 'runtime/git/libexec/git-core'),
      GIT_TEMPLATE_DIR: resolve(resourceRoot, 'runtime/git/share/git-core/templates'),
      PATH: `${resolve(resourceRoot, 'runtime/git/bin')}${process.platform === 'win32' ? ';' : ':'}/usr/local/bin`,
    }))
  })

  it('reads content identity from release metadata with an environment override', () => {
    const read = () => JSON.stringify({ contentIdentity: 'artifact-identity' })
    expect(resolveBunContentIdentity('/opt/release/share/openalice', {}, read))
      .toBe('artifact-identity')
    expect(resolveBunContentIdentity(
      '/opt/release/share/openalice',
      { OPENALICE_RUNTIME_CONTENT_IDENTITY: 'explicit-identity' },
      read,
    )).toBe('explicit-identity')
  })
})
