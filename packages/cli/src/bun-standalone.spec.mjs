import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'

import {
  buildBunRuntimeEnvironment,
  prepareBunRuntimeEnvironment,
  buildExternalAgentRuntimeEnvironment,
  bunGuardianProcessSpec,
  bunInstallSourceLocations,
  resolveBunContentIdentity,
  resolveBunInstallSourcePath,
  resolveBunResourceRoot,
} from './bun-standalone.mjs'

describe('Bun standalone launch boundary', () => {
  it.each(['x64', 'arm64'])('uses detected Windows Git/Bash without selecting managed Pi (%s)', (arch) => {
    const resourceRoot = resolve('/preview/share/openalice')
    const git = 'C:\\Program Files\\Git\\cmd\\git.exe'
    const bash = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const env = buildBunRuntimeEnvironment({ Path: 'user-tools', OPENALICE_MANAGED_PI_PATH: 'old' },
      resourceRoot, '/preview/bin/openalice.exe', { platform: 'win32', arch, exists: () => false,
        dependencyChecks: [
          { id: 'git', status: 'available', executable: git },
          { id: 'bash', status: 'available', executable: bash },
        ],
      })
    expect(env).not.toHaveProperty('Path')
    expect(env).not.toHaveProperty('OPENALICE_MANAGED_PI_PATH')
    expect(env.OPENALICE_MANAGED_SHELL_PATH).toBe(bash)
    expect(env.OPENALICE_SYSTEM_GIT_PATH).toBe(git)
    expect(env).not.toHaveProperty('GIT_EXEC_PATH')
    expect(env).not.toHaveProperty('LOCAL_GIT_DIRECTORY')
    expect(env.PATH).toBe('C:\\Program Files\\Git\\cmd;C:\\Program Files\\Git\\bin;user-tools')
  })
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

  it('preserves system Git configuration without injecting resource paths', () => {
    const resourceRoot = resolve('/opt/openalice/share/openalice')
    expect(buildBunRuntimeEnvironment(
      {
        PATH: '/usr/local/bin',
        KEEP: 'yes',
        GIT_EXEC_PATH: '/custom/git-core',
        GIT_TEMPLATE_DIR: '/custom/templates',
        OPENALICE_INSTALL_SOURCE: '/opt/openalice/install-source.json',
      },
      resourceRoot,
      '/opt/openalice/bin/openalice',
    )).toEqual(expect.objectContaining({
      KEEP: 'yes',
      OPENALICE_INSTALL_SOURCE: '/opt/openalice/install-source.json',
      OPENALICE_RUNTIME_EXECUTABLE: '/opt/openalice/bin/openalice',
      GIT_EXEC_PATH: '/custom/git-core',
      GIT_TEMPLATE_DIR: '/custom/templates',
      PATH: '/usr/local/bin',
    }))
  })

  it('re-detects dependencies before launch and forwards the verified executable', async () => {
    const env = await prepareBunRuntimeEnvironment({ PATH: '/usr/bin' }, '/resources', '/alice', {
      platform: 'linux', exists: () => false,
      inspectDependencies: async () => [
        { id: 'git', status: 'available', executable: '/custom/bin/git' },
        { id: 'bash', status: 'available', executable: '/bin/bash' },
      ],
    })
    expect(env.OPENALICE_SYSTEM_GIT_PATH).toBe('/custom/bin/git')
    expect(env.PATH).toBe('/custom/bin:/bin:/usr/bin')
  })

  it('does not launch or install silently with missing dependencies', async () => {
    await expect(prepareBunRuntimeEnvironment({}, '/resources', '/alice', {
      inspectDependencies: async () => [{ id: 'git', status: 'missing' }],
    })).rejects.toThrow('Run openalice setup')
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
