import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'

import {
  buildBunRuntimeEnvironment,
  buildExternalAgentRuntimeEnvironment,
  bunGuardianProcessSpec,
  bunInstallSourceLocations,
  resolveBunContentIdentity,
  resolveBunInstallSourcePath,
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

  it('discovers package-manager provenance beside the install root or resources', () => {
    const executable = resolve('/opt/openalice/bin/openalice')
    const resourceRoot = resolve('/opt/openalice/share/openalice')
    const locations = bunInstallSourceLocations({}, executable, resourceRoot)

    expect(locations).toEqual([
      resolve('/opt/openalice/install-source.json'),
      resolve('/opt/openalice/share/openalice/install-source.json'),
    ])
    expect(resolveBunInstallSourcePath(
      {},
      executable,
      resourceRoot,
      (path) => path === locations[1],
    )).toBe(locations[1])
    expect(resolveBunInstallSourcePath(
      {},
      executable,
      resourceRoot,
      (path) => path === locations[0],
    )).toBe(locations[0])
    expect(resolveBunInstallSourcePath(
      {},
      executable,
      resourceRoot,
      () => false,
    )).toBeNull()
  })

  it('preserves explicit provenance so malformed metadata fails closed downstream', () => {
    expect(resolveBunInstallSourcePath(
      { OPENALICE_INSTALL_SOURCE: '/managed/provenance.json' },
      '/opt/openalice/bin/openalice',
      '/opt/openalice/share/openalice',
      () => false,
    )).toBe('/managed/provenance.json')
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
      {
        PATH: '/usr/local/bin',
        KEEP: 'yes',
        OPENALICE_INSTALL_SOURCE: '/opt/openalice/install-source.json',
      },
      resourceRoot,
      '/opt/openalice/bin/openalice',
    )).toEqual(expect.objectContaining({
      KEEP: 'yes',
      OPENALICE_INSTALL_SOURCE: '/opt/openalice/install-source.json',
      OPENALICE_RUNTIME_EXECUTABLE: '/opt/openalice/bin/openalice',
      LOCAL_GIT_DIRECTORY: resolve(resourceRoot, 'runtime/git'),
      GIT_EXEC_PATH: resolve(resourceRoot, 'runtime/git/libexec/git-core'),
      GIT_TEMPLATE_DIR: resolve(resourceRoot, 'runtime/git/share/git-core/templates'),
      PATH: `${resolve(resourceRoot, 'runtime/git/bin')}${process.platform === 'win32' ? ';' : ':'}/usr/local/bin`,
    }))
  })

  it('propagates discovered package-manager provenance into the Runtime', () => {
    const executable = resolve('/opt/openalice/bin/openalice')
    const resourceRoot = resolve('/opt/openalice/share/openalice')
    const metadataPath = resolve(resourceRoot, 'install-source.json')

    expect(buildBunRuntimeEnvironment(
      { PATH: '/usr/local/bin' },
      resourceRoot,
      executable,
      { exists: (path) => path === metadataPath },
    )).toEqual(expect.objectContaining({
      OPENALICE_INSTALL_SOURCE: metadataPath,
    }))
    expect(buildBunRuntimeEnvironment(
      { PATH: '/usr/local/bin' },
      resourceRoot,
      executable,
      { exists: () => false },
    )).not.toHaveProperty('OPENALICE_INSTALL_SOURCE')
  })

  it('removes desktop-managed Pi selection without replacing native Pi state', () => {
    const env = {
      OPENALICE_MANAGED_PI_PATH: '/desktop/pi/cli.js',
      OPENALICE_MANAGED_PI_NODE_PATH: '/desktop/node',
      PI_CODING_AGENT_DIR: '/user/pi',
      PI_CODING_AGENT_SESSION_DIR: '/user/pi/sessions',
      PATH: '/user/bin',
    }

    expect(buildExternalAgentRuntimeEnvironment(env)).toEqual({
      PI_CODING_AGENT_DIR: '/user/pi',
      PI_CODING_AGENT_SESSION_DIR: '/user/pi/sessions',
      PATH: '/user/bin',
    })
    expect(env).toHaveProperty('OPENALICE_MANAGED_PI_PATH')

    expect(buildBunRuntimeEnvironment(
      env,
      resolve('/opt/openalice/share/openalice'),
      '/opt/openalice/bin/openalice',
    )).not.toHaveProperty('OPENALICE_MANAGED_PI_PATH')
  })

  it('reads content identity from release metadata with an environment override', () => {
    const read = (path) => {
      if (path === resolve('/opt/release/share/openalice/release.json')) {
        return JSON.stringify({ contentIdentity: 'artifact-identity' })
      }
      const error = new Error('missing')
      error.code = 'ENOENT'
      throw error
    }
    expect(resolveBunContentIdentity('/opt/release/share/openalice', {}, read))
      .toBe('artifact-identity')
    expect(resolveBunContentIdentity(
      '/opt/release/share/openalice',
      { OPENALICE_RUNTIME_CONTENT_IDENTITY: 'explicit-identity' },
      read,
    )).toBe('explicit-identity')
  })
})
