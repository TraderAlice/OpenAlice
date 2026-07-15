import { describe, expect, it, vi } from 'vitest'

import {
  buildRemoteArtifactsProbeCommand,
  buildRemoteBuildToolsProbeCommand,
  buildRemoteCheckoutProbeCommand,
  buildRemoteInstallCommand,
  buildRemoteServerStartCommand,
  buildRemoteSshArgs,
  connectRemote,
  createRemotePlan,
  parseRemoteArgs,
} from './remote.mjs'

describe('OpenAlice managed remote connector', () => {
  it('parses an explicit SSH and remote Runtime surface', () => {
    expect(parseRemoteArgs([
      'alice@example.com',
      '--app-dir', '/srv/OpenAlice source',
      '--home', '/srv/openalice home',
      '--local-port', 'auto',
      '--remote-port', '41000',
      '--ssh-port', '2222',
      '--identity', '/tmp/id key',
      '--wait', '30',
      '--plan',
      '--yes',
      '--takeover',
      '--no-open',
    ])).toEqual({
      destination: 'alice@example.com',
      appDir: '/srv/OpenAlice source',
      remoteHome: '/srv/openalice home',
      localPort: 0,
      remotePort: 41000,
      remotePortExplicit: true,
      sshPort: 2222,
      identityFile: '/tmp/id key',
      openBrowser: false,
      waitMs: 30_000,
      assumeYes: true,
      planOnly: true,
      takeover: true,
    })
  })

  it('rejects shell-shaped destinations and relative remote paths', () => {
    expect(() => parseRemoteArgs(['-oProxyCommand=bad'])).toThrow('Unknown option')
    expect(() => parseRemoteArgs(['host name'])).toThrow('unsupported characters')
    expect(() => parseRemoteArgs(['host', '--app-dir', '~/OpenAlice'])).toThrow('absolute path')
  })

  it('plans install and start separately, with no implicit takeover', () => {
    const options = parseRemoteArgs(['host', '--app-dir', '/srv/OpenAlice'])
    const plan = createRemotePlan(options, {
      platform: { os: 'linux', label: 'Linux x86_64' },
      nodeVersion: 'v22.0.0',
      hasCurl: true,
      sourceCheckoutPresent: true,
      sourceArtifactsReady: false,
      runtimeBuildToolsMissing: ['git', 'python3', 'make', 'cxx'],
      cliPath: null,
      cliCompatible: false,
      status: null,
    })
    expect(plan.installCli).toBe(true)
    expect(plan.installRuntimeDeps).toBe(true)
    expect(plan.startServer).toBe(true)
    expect(plan.mutations).toEqual([
      'install remote OpenAlice CLI',
      'install source Runtime build tools',
      'start remote OpenAlice Server',
    ])
    expect(plan.blocker).toBe('')

    const conflict = createRemotePlan(options, compatibleRemote({
      class: 'owned_elsewhere',
      owner: { surface: 'electron', pid: 9 },
    }))
    expect(conflict.blocker).toContain('Re-run with --takeover')
  })

  it('reuses a healthy compatible CLI Server without mutation', () => {
    const plan = createRemotePlan(parseRemoteArgs(['host']), compatibleRemote())
    expect(plan.mutations).toEqual([])
    expect(plan.installCli).toBe(false)
    expect(plan.startServer).toBe(false)
    expect(plan.blocker).toBe('')
  })

  it('does not install build tools when a source Runtime is already built', () => {
    const plan = createRemotePlan(parseRemoteArgs(['host', '--app-dir', '/srv/OpenAlice']), {
      ...missingRemote(),
      sourceArtifactsReady: true,
    })
    expect(plan.installRuntimeDeps).toBe(false)
    expect(plan.mutations).toEqual([
      'install remote OpenAlice CLI',
      'start remote OpenAlice Server',
    ])
  })

  it('blocks remote macOS prerequisite installation with local-session guidance', () => {
    const plan = createRemotePlan(parseRemoteArgs(['host', '--app-dir', '/srv/OpenAlice']), {
      ...missingRemote(),
      platform: { os: 'darwin', label: 'Darwin arm64' },
    })
    expect(plan.blocker).toContain('xcode-select --install')
    expect(plan.installRuntimeDeps).toBe(false)
  })

  it('blocks a missing checkout before proposing system-package changes', () => {
    const plan = createRemotePlan(parseRemoteArgs(['host', '--app-dir', '/srv/missing']), {
      ...missingRemote(),
      sourceCheckoutPresent: false,
      runtimeBuildToolsMissing: ['python3'],
    })
    expect(plan.blocker).toContain('Clone it first')
    expect(plan.installRuntimeDeps).toBe(false)
    expect(plan.mutations).toEqual(['install remote OpenAlice CLI'])
  })

  it('uses the detected Server port and blocks an explicit mismatch', () => {
    const detected = compatibleRemote({ endpoints: { web: 'http://127.0.0.1:41000' } })
    const inferred = createRemotePlan(parseRemoteArgs(['host']), detected)
    expect(inferred.remotePort).toBe(41000)
    expect(inferred.blocker).toBe('')

    const mismatch = createRemotePlan(parseRemoteArgs(['host', '--remote-port', '42000']), detected)
    expect(mismatch.blocker).toContain('listening on 41000')
  })

  it('shell-quotes every remote path and keeps SSH identity as a local argv entry', () => {
    const options = parseRemoteArgs([
      'host',
      '--app-dir', "/srv/Alice's source",
      '--home', "/srv/Alice's home",
      '--identity', '/tmp/id key',
    ])
    const command = buildRemoteServerStartCommand(options, "/opt/Alice's bin/openalice")
    expect(command).toContain("'/opt/Alice'\\''s bin/openalice'")
    expect(command).toContain("'/srv/Alice'\\''s source'")
    expect(command).toContain("'/srv/Alice'\\''s home'")
    expect(buildRemoteSshArgs(options, command)).toEqual(expect.arrayContaining([
      '-i', '/tmp/id key', 'host', command,
    ]))
  })

  it('prints a plan without applying or opening a tunnel', async () => {
    const runRemote = vi.fn()
    const connectTunnel = vi.fn()
    const stdout = { write: vi.fn() }
    await expect(connectRemote(parseRemoteArgs(['host', '--plan']), {
      probeRemote: async () => compatibleRemote(),
      runRemote,
      connectTunnel,
      stdout,
    })).resolves.toBe(0)
    expect(runRemote).not.toHaveBeenCalled()
    expect(connectTunnel).not.toHaveBeenCalled()
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining('No remote files or processes were changed'))
  })

  it('default-no leaves a missing remote Runtime unchanged', async () => {
    const runRemote = vi.fn()
    const connectTunnel = vi.fn()
    const stdout = { write: vi.fn() }
    await expect(connectRemote(parseRemoteArgs(['host', '--app-dir', '/srv/OpenAlice']), {
      probeRemote: async () => missingRemote(),
      confirmPlan: async () => false,
      runRemote,
      connectTunnel,
      stdout,
    })).resolves.toBe(0)
    expect(runRemote).not.toHaveBeenCalled()
    expect(connectTunnel).not.toHaveBeenCalled()
    expect(stdout.write).toHaveBeenCalledWith('No changes made.\n')
  })

  it('applies the normal installer, starts the Server, re-probes, then opens the tunnel', async () => {
    const options = parseRemoteArgs(['host', '--app-dir', '/srv/OpenAlice', '--yes', '--no-open'])
    const probeRemote = vi.fn()
      .mockResolvedValueOnce(missingRemote())
      .mockResolvedValueOnce(compatibleRemote({ class: 'absent', state: 'absent', owner: null, endpoints: {} }))
      .mockResolvedValueOnce(compatibleRemote())
    const runRemote = vi.fn(async () => '')
    const connectTunnel = vi.fn(async () => 0)
    const stdout = { write: vi.fn() }

    await expect(connectRemote(options, {
      probeRemote,
      runRemote,
      connectTunnel,
      installUrl: 'https://example.test/install',
      installVersion: 'dev-test',
      installBaseUrl: 'https://example.test/packages/cli/',
      stdout,
    })).resolves.toBe(0)

    expect(runRemote).toHaveBeenCalledTimes(2)
    expect(runRemote.mock.calls[0][1]).toBe(buildRemoteInstallCommand(
      'https://example.test/install',
      'dev-test',
      'https://example.test/packages/cli/',
      true,
    ))
    expect(runRemote.mock.calls[1][1]).toContain('server start')
    expect(connectTunnel).toHaveBeenCalledWith(expect.objectContaining({
      destination: 'host',
      remotePort: 47331,
      openBrowser: false,
    }), expect.any(Object))
  })

  it('re-plans after install and never replaces a newly discovered owner implicitly', async () => {
    const options = parseRemoteArgs(['host', '--app-dir', '/srv/OpenAlice', '--yes'])
    const probeRemote = vi.fn()
      .mockResolvedValueOnce(missingRemote())
      .mockResolvedValueOnce(compatibleRemote({
        class: 'owned_elsewhere',
        owner: { surface: 'electron', pid: 42 },
      }))
    const runRemote = vi.fn(async () => '')
    const connectTunnel = vi.fn()
    const stdout = { write: vi.fn() }

    await expect(connectRemote(options, {
      probeRemote,
      runRemote,
      connectTunnel,
      stdout,
    })).rejects.toThrow('Re-run with --takeover')

    expect(runRemote).toHaveBeenCalledOnce()
    expect(runRemote.mock.calls[0][1]).toContain('openalice-install')
    expect(connectTunnel).not.toHaveBeenCalled()
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining('refreshed plan'))
  })

  it('builds read-only remote probes without interpolating source paths as shell code', () => {
    const probe = buildRemoteArtifactsProbeCommand("/srv/Alice's source")
    expect(probe).toContain("root='/srv/Alice'\\''s source'")
    expect(probe).toContain('test -f "$root/dist/main.js"')
    expect(buildRemoteCheckoutProbeCommand("/srv/Alice's source"))
      .toContain("'/srv/Alice'\\''s source/package.json'")
    expect(buildRemoteBuildToolsProbeCommand()).toContain("printf 'cxx\\n'")
  })
})

function missingRemote() {
  return {
    platform: { os: 'linux', label: 'Linux x86_64' },
    nodeVersion: 'v22.0.0',
    hasCurl: true,
    sourceCheckoutPresent: true,
    sourceArtifactsReady: false,
    runtimeBuildToolsMissing: ['git', 'python3', 'make', 'cxx'],
    cliPath: null,
    cliVersion: null,
    cliCompatible: false,
    status: null,
  }
}

function compatibleRemote(statusOverrides = {}) {
  return {
    platform: { os: 'linux', label: 'Linux x86_64' },
    nodeVersion: 'v22.0.0',
    hasCurl: true,
    sourceCheckoutPresent: null,
    sourceArtifactsReady: null,
    runtimeBuildToolsMissing: [],
    cliPath: '/home/alice/.openalice/bin/openalice',
    cliVersion: '0.2.0',
    cliCompatible: true,
    status: {
      protocol: 1,
      class: 'running',
      state: 'running',
      home: '/home/alice/.openalice',
      owner: { surface: 'cli-server', pid: 99 },
      endpoints: { web: 'http://127.0.0.1:47331' },
      components: { alice: 'ready', uta: 'disabled', connector: 'disabled' },
      capabilities: ['runtime.stop'],
      ...statusOverrides,
    },
  }
}
