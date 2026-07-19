import { EventEmitter } from 'node:events'
import { rm } from 'node:fs/promises'
import { PassThrough } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import {
  buildRemoteArtifactsProbeCommand,
  buildRemoteBuildToolsProbeCommand,
  buildRemoteCheckoutProbeCommand,
  buildRemoteCloneCommand,
  buildRemoteControlProbeCommand,
  buildRemoteInstallCommand,
  buildRemoteServerStartCommand,
  buildRemoteServerStopCommand,
  buildRemoteSourceUpdateCommand,
  buildRemoteSourceUpdateProbeCommand,
  buildRemoteSshArgs,
  connectRemote,
  createRemotePlan,
  parseRemoteArgs,
  probeRemoteHost,
  readRememberedRemotePort,
  runSshCommand,
} from './remote.mjs'

const masterInstallSource = {
  schemaVersion: 1,
  repository: 'TraderAlice/OpenAlice',
  cliVersion: '0.2.0',
  selector: { kind: 'branch', value: 'master' },
  installerUrl: 'https://openalice.ai/install',
}

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
      mode: 'connect',
    })
  })

  it('rejects shell-shaped destinations and relative remote paths', () => {
    expect(() => parseRemoteArgs(['-oProxyCommand=bad'])).toThrow('Unknown option')
    expect(() => parseRemoteArgs(['host name'])).toThrow('unsupported characters')
    expect(() => parseRemoteArgs(['host', '--app-dir', '~/OpenAlice'])).toThrow('absolute path')
    expect(() => parseRemoteArgs(['host', '--branch', 'dev'])).toThrow('Unknown option')
    expect(() => parseRemoteArgs(['host', '--status', '--stop'])).toThrow('cannot be used together')
    expect(() => parseRemoteArgs(['host', '--stop', '--takeover'])).toThrow('cannot be combined')
  })

  it('builds a remote installer command from local provenance, not remote flags', () => {
    const command = buildRemoteInstallCommand(masterInstallSource)
    expect(command).toContain('OPENALICE_INSTALL_URL=')
    expect(command).toContain('OPENALICE_INSTALL_CONTEXT=remote')
    expect(command).toContain("--branch 'master'")
    expect(command).not.toContain('--version')
  })

  it('plans install and start separately, with no implicit takeover', () => {
    const options = parseRemoteArgs(['host', '--app-dir', '/srv/OpenAlice'])
    const plan = createRemotePlan(options, {
      platform: { os: 'linux', label: 'Linux x86_64' },
      nodeVersion: 'v22.23.1',
      hasCurl: true,
      sourceCheckoutPresent: true,
      sourceArtifactsReady: false,
      runtimeBuildToolsMissing: ['git', 'python3', 'make', 'cxx'],
      cliPath: null,
      cliCompatible: false,
      status: null,
    })
    expect(plan.installCli).toBe(true)
    expect(plan.installManagedPi).toBe(true)
    expect(plan.installRuntimeDeps).toBe(true)
    expect(plan.startServer).toBe(true)
    expect(plan.mutations).toEqual([
      'install remote OpenAlice CLI',
      'install managed Pi 0.80.6',
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

  it('updates a protocol-compatible remote CLI when its install source differs from local', () => {
    const remote = compatibleRemote()
    remote.installSource = {
      ...masterInstallSource,
      selector: { kind: 'branch', value: 'dev' },
      installerUrl: 'https://raw.githubusercontent.com/TraderAlice/OpenAlice/dev/install',
    }
    const plan = createRemotePlan(parseRemoteArgs(['host']), remote)
    expect(plan.installCli).toBe(true)
    expect(plan.mutations).toEqual(['update remote OpenAlice CLI'])
  })

  it('updates a protocol-compatible remote CLI when only its CLI version differs', () => {
    const remote = compatibleRemote()
    remote.cliVersion = '0.1.0'
    remote.installSource = { ...masterInstallSource, cliVersion: '0.1.0' }
    const plan = createRemotePlan(parseRemoteArgs(['host']), remote)
    expect(plan.cliCompatible).toBe(true)
    expect(plan.cliMatchesLocal).toBe(false)
    expect(plan.mutations).toEqual(['update remote OpenAlice CLI'])
  })

  it('installs missing managed Pi and plans a self-owned Server restart from its recorded source', () => {
    const remote = compatibleRemote()
    remote.piPath = null
    remote.piVersion = null
    remote.piCompatible = false
    const plan = createRemotePlan(parseRemoteArgs(['host']), remote)

    expect(plan.installManagedPi).toBe(true)
    expect(plan.restartServer).toBe(true)
    expect(plan.serverAppDir).toBe('/srv/OpenAlice')
    expect(plan.mutations).toEqual([
      'install managed Pi 0.80.6',
      'restart remote OpenAlice Server with managed Pi 0.80.6',
    ])
  })

  it('does not install build tools when a source Runtime is already built', () => {
    const plan = createRemotePlan(parseRemoteArgs(['host', '--app-dir', '/srv/OpenAlice']), {
      ...missingRemote(),
      sourceArtifactsReady: true,
    })
    expect(plan.installRuntimeDeps).toBe(false)
    expect(plan.mutations).toEqual([
      'install remote OpenAlice CLI',
      'install managed Pi 0.80.6',
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

  it('rejects Node 22 releases below the managed Pi engine floor', () => {
    const remote = missingRemote()
    remote.nodeVersion = 'v22.18.0'
    const plan = createRemotePlan(parseRemoteArgs(['host', '--app-dir', '/srv/OpenAlice']), remote)
    expect(plan.blocker).toContain('22.19.0')
  })

  it('plans a managed clone instead of making the user prepare a checkout over raw SSH', () => {
    const plan = createRemotePlan(parseRemoteArgs(['host', '--app-dir', '/srv/missing']), {
      ...missingRemote(),
      sourceCheckoutState: 'absent',
      sourceCheckoutPresent: false,
      runtimeBuildToolsMissing: ['python3'],
    })
    expect(plan.blocker).toBe('')
    expect(plan.cloneSource).toBe(true)
    expect(plan.installRuntimeDeps).toBe(true)
    expect(plan.mutations).toEqual([
      'install remote OpenAlice CLI',
      'install managed Pi 0.80.6',
      'install source Runtime build tools',
      'clone OpenAlice source (branch master)',
      'start remote OpenAlice Server',
    ])
  })

  it('selects a private managed checkout when --app-dir is omitted', () => {
    const remote = {
      ...missingRemote(),
      managedAppDir: '/home/alice/.openalice/sources/branch-master-12345678/OpenAlice',
      sourceCheckoutState: 'absent',
      sourceCheckoutPresent: false,
    }
    const plan = createRemotePlan(parseRemoteArgs(['host']), remote)
    expect(plan.sourceMode).toBe('managed')
    expect(plan.serverAppDir).toBe(remote.managedAppDir)
    expect(plan.cloneSource).toBe(true)
    expect(plan.mutations).toContain('clone OpenAlice source (branch master)')
  })

  it('refuses to overwrite an occupied non-OpenAlice source path', () => {
    const plan = createRemotePlan(parseRemoteArgs(['host', '--app-dir', '/srv/existing']), {
      ...missingRemote(),
      sourceCheckoutState: 'invalid',
      sourceCheckoutPresent: false,
    })
    expect(plan.blocker).toContain('exists but is not an OpenAlice source checkout')
    expect(plan.cloneSource).toBe(false)
  })

  it('updates a matching-version remote CLI when its installed payload differs', () => {
    const remote = compatibleRemote()
    remote.cliContentIdentity = '1111111111111111'
    const plan = createRemotePlan(parseRemoteArgs(['host']), remote, {
      contentIdentity: '2222222222222222',
    })
    expect(plan.cliMatchesLocal).toBe(false)
    expect(plan.mutations).toEqual([
      'update remote OpenAlice CLI',
    ])
  })

  it('plans a safe rebuild when the managed branch checkout has advanced', () => {
    const remote = managedUpdateRemote()
    const plan = createRemotePlan(parseRemoteArgs(['host']), remote)
    expect(plan.updateSource).toBe(true)
    expect(plan.rebuildSource).toBe(true)
    expect(plan.restartServer).toBe(true)
    expect(plan.mutations).toEqual([
      'update managed OpenAlice source (branch master)',
      'restart remote OpenAlice Server with updated source',
    ])

    remote.sourceDirty = true
    const dirty = createRemotePlan(parseRemoteArgs(['host']), remote)
    expect(dirty.blocker).toContain('tracked local changes')
    expect(dirty.updateSource).toBe(false)
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
    expect(command).toContain('OPENALICE_PREPARE_OUTPUT=compact')
    expect(command).toContain('TURBO_TELEMETRY_DISABLED=1')
    expect(buildRemoteServerStopCommand(options, "/opt/Alice's bin/openalice"))
      .toContain("'/opt/Alice'\\''s bin/openalice' server stop")
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

  it('reports managed remote status without opening a tunnel or changing the host', async () => {
    const runRemote = vi.fn()
    const connectTunnel = vi.fn()
    const stdout = { write: vi.fn() }
    await expect(connectRemote(parseRemoteArgs(['host', '--status']), {
      probeRemote: async () => compatibleRemote(),
      runRemote,
      connectTunnel,
      stdout,
    })).resolves.toBe(0)
    expect(runRemote).not.toHaveBeenCalled()
    expect(connectTunnel).not.toHaveBeenCalled()
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining('Runtime: running (cli-server)'))
  })

  it('uses one lightweight SSH probe for status and stop control', async () => {
    const runRemote = vi.fn(async (_options, command) => {
      expect(command).toContain('server status --json')
      expect(command).toContain("--home '/data/openalice'")
      return [
        'cli=/home/alice/.openalice/bin/openalice',
        'version=0.2.0',
        'identity=' + JSON.stringify({
          version: '0.2.0',
          installSource: masterInstallSource,
          contentIdentity: '1234567890abcdef',
        }),
        'status=' + JSON.stringify(compatibleRemote().status),
        '',
      ].join('\n')
    })
    const remote = await probeRemoteHost(parseRemoteArgs([
      'host',
      '--home', '/data/openalice',
      '--status',
    ]), { runRemote })

    expect(runRemote).toHaveBeenCalledOnce()
    expect(remote).toEqual(expect.objectContaining({
      cliPath: '/home/alice/.openalice/bin/openalice',
      cliVersion: '0.2.0',
      cliContentIdentity: '1234567890abcdef',
      cliCompatible: true,
      status: expect.objectContaining({ class: 'running' }),
    }))
    expect(buildRemoteControlProbeCommand(parseRemoteArgs(['host', '--stop'])))
      .toContain('server status --json')
  })

  it('stops a managed remote Server without requiring a raw SSH command', async () => {
    const probeRemote = vi.fn()
      .mockResolvedValueOnce(compatibleRemote())
      .mockResolvedValueOnce(compatibleRemote({ class: 'absent', state: 'absent', owner: null, endpoints: {} }))
    const runRemote = vi.fn(async () => 'OpenAlice Server stopped\n')
    const connectTunnel = vi.fn()
    const stdout = { write: vi.fn() }
    await expect(connectRemote(parseRemoteArgs(['host', '--stop']), {
      probeRemote,
      runRemote,
      connectTunnel,
      stdout,
    })).resolves.toBe(0)
    expect(runRemote).toHaveBeenCalledOnce()
    expect(runRemote.mock.calls[0][1]).toContain('server stop')
    expect(connectTunnel).not.toHaveBeenCalled()
    expect(stdout.write).toHaveBeenCalledWith('OpenAlice Server is stopped on host.\n')
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
    const installSource = {
      ...masterInstallSource,
      selector: { kind: 'version', value: 'dev-test' },
      installerUrl: 'https://example.test/install',
    }
    const installedRemote = compatibleRemote({ class: 'absent', state: 'absent', owner: null, endpoints: {} })
    installedRemote.installSource = installSource
    const runningRemote = compatibleRemote()
    runningRemote.installSource = installSource
    const probeRemote = vi.fn()
      .mockResolvedValueOnce(missingRemote())
      .mockResolvedValueOnce(installedRemote)
      .mockResolvedValueOnce(runningRemote)
    const runRemote = vi.fn(async () => '')
    const connectTunnel = vi.fn(async () => 0)
    const stdout = { write: vi.fn() }

    await expect(connectRemote(options, {
      probeRemote,
      runRemote,
      connectTunnel,
      installSource,
      installBaseUrl: 'https://example.test/packages/cli/',
      stdout,
    })).resolves.toBe(0)

    expect(runRemote).toHaveBeenCalledTimes(2)
    expect(runRemote.mock.calls[0][1]).toBe(buildRemoteInstallCommand(
      installSource,
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

  it('installs, clones a managed checkout, starts, and connects without manual SSH setup', async () => {
    const options = parseRemoteArgs(['host', '--yes', '--no-open'])
    const appDir = '/home/alice/.openalice/sources/version-remote-smoke/OpenAlice'
    const initial = { ...missingRemote(), managedAppDir: appDir, sourceCheckoutState: 'absent', sourceCheckoutPresent: false }
    const installed = {
      ...compatibleRemote({ class: 'absent', state: 'absent', owner: null, endpoints: {} }),
      managedAppDir: appDir,
      sourceCheckoutState: 'absent',
      sourceCheckoutPresent: false,
      sourceArtifactsReady: null,
    }
    const cloned = {
      ...installed,
      sourceCheckoutState: 'present',
      sourceCheckoutPresent: true,
      sourceArtifactsReady: true,
    }
    const running = {
      ...compatibleRemote(),
      managedAppDir: appDir,
      sourceCheckoutState: 'present',
      sourceCheckoutPresent: true,
      sourceArtifactsReady: true,
    }
    const probeRemote = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(installed)
      .mockResolvedValueOnce(cloned)
      .mockResolvedValueOnce(running)
    const runRemote = vi.fn(async () => '')
    const connectTunnel = vi.fn(async () => 0)

    await expect(connectRemote(options, {
      probeRemote,
      runRemote,
      connectTunnel,
      installSource: masterInstallSource,
      repositoryUrl: 'https://example.test/OpenAlice.git',
      stdout: { write: vi.fn() },
    })).resolves.toBe(0)

    expect(runRemote).toHaveBeenCalledTimes(3)
    expect(runRemote.mock.calls[0][1]).toContain('openalice-install')
    expect(runRemote.mock.calls[1][1]).toContain("git clone --branch 'master' --single-branch 'https://example.test/OpenAlice.git'")
    expect(runRemote.mock.calls[2][1]).toContain(`--app-dir '${appDir}'`)
    expect(connectTunnel).toHaveBeenCalledOnce()
  })

  it('continues when an interrupted installer or Server start actually completed remotely', async () => {
    const options = parseRemoteArgs(['host', '--app-dir', '/srv/OpenAlice', '--yes', '--no-open'])
    const probeRemote = vi.fn()
      .mockResolvedValueOnce(missingRemote())
      .mockResolvedValueOnce(compatibleRemote({ class: 'absent', state: 'absent', owner: null, endpoints: {} }))
      .mockResolvedValueOnce(compatibleRemote())
    const runRemote = vi.fn()
      .mockRejectedValueOnce(new Error('connection closed'))
      .mockRejectedValueOnce(new Error('connection reset'))
    const stdout = { write: vi.fn() }

    await expect(connectRemote(options, {
      probeRemote,
      runRemote,
      connectTunnel: async () => 0,
      stdout,
    })).resolves.toBe(0)

    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining('remote install completed before the disconnect'))
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining('remote Server became ready before the disconnect'))
  })

  it('stops, fast-forwards, rebuilds, and reconnects when a managed branch advances', async () => {
    const options = parseRemoteArgs(['host', '--yes', '--no-open'])
    const absentBeforeUpdate = managedUpdateRemote({ class: 'absent', state: 'absent', owner: null, endpoints: {} })
    const absentAfterUpdate = { ...absentBeforeUpdate, sourceUpdateAvailable: false }
    const runningAfterUpdate = { ...managedUpdateRemote(), sourceUpdateAvailable: false }
    const probeRemote = vi.fn()
      .mockResolvedValueOnce(managedUpdateRemote())
      .mockResolvedValueOnce(absentBeforeUpdate)
      .mockResolvedValueOnce(absentAfterUpdate)
      .mockResolvedValueOnce(runningAfterUpdate)
    const runRemote = vi.fn(async () => '')
    const connectTunnel = vi.fn(async () => 0)

    await expect(connectRemote(options, {
      probeRemote,
      runRemote,
      connectTunnel,
      stdout: { write: vi.fn() },
    })).resolves.toBe(0)

    expect(runRemote).toHaveBeenCalledTimes(3)
    expect(runRemote.mock.calls[0][1]).toContain('server stop')
    expect(runRemote.mock.calls[1][1]).toContain('merge --ff-only FETCH_HEAD')
    expect(runRemote.mock.calls[2][1]).toContain('--rebuild')
    expect(connectTunnel).toHaveBeenCalledOnce()
  })

  it('installs Pi, gracefully restarts an existing CLI Server, and reconnects', async () => {
    const options = parseRemoteArgs(['host', '--yes', '--no-open'])
    const initial = compatibleRemote()
    initial.piPath = null
    initial.piVersion = null
    initial.piCompatible = false
    const absent = compatibleRemote({ class: 'absent', state: 'absent', owner: null, endpoints: {} })
    const probeRemote = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(compatibleRemote())
      .mockResolvedValueOnce(absent)
      .mockResolvedValueOnce(compatibleRemote())
    const runRemote = vi.fn(async () => '')
    const connectTunnel = vi.fn(async () => 0)

    await expect(connectRemote(options, {
      probeRemote,
      runRemote,
      connectTunnel,
      stdout: { write: vi.fn() },
    })).resolves.toBe(0)

    expect(runRemote).toHaveBeenCalledTimes(3)
    expect(runRemote.mock.calls[0][1]).toContain('openalice-install')
    expect(runRemote.mock.calls[1][1]).toContain('server stop')
    expect(runRemote.mock.calls[2][1]).toContain("--app-dir '/srv/OpenAlice'")
    expect(connectTunnel).toHaveBeenCalledOnce()
  })

  it('remembers the successful local port per remote target and reuses it next time', async () => {
    const stateFile = `/tmp/openalice-remote-state-${process.pid}-${Date.now()}.json`
    const env = { OPENALICE_REMOTE_STATE_FILE: stateFile }
    const options = parseRemoteArgs(['host', '--no-open'])
    const connectTunnel = vi.fn(async (tunnelOptions) => {
      await tunnelOptions.onReady({ localPort: 40126, localUrl: 'http://127.0.0.1:40126' })
      return 0
    })
    await connectRemote(options, {
      env,
      probeRemote: async () => compatibleRemote(),
      connectTunnel,
      stdout: { write: vi.fn() },
    })
    expect(await readRememberedRemotePort(options, { env })).toBe(40126)

    await connectRemote(options, {
      env,
      probeRemote: async () => compatibleRemote(),
      connectTunnel,
      stdout: { write: vi.fn() },
    })
    expect(connectTunnel.mock.calls[1][0]).toEqual(expect.objectContaining({
      preferredLocalPort: 40126,
    }))
    await rm(stateFile, { force: true })
  })

  it('retries only transient SSH transport failures', async () => {
    const spawnProcess = vi.fn()
      .mockImplementationOnce(() => commandChild({ code: 255, stderr: "Railway can't verify your SSH key right now\n" }))
      .mockImplementationOnce(() => commandChild({ code: 255, stderr: 'Connection reset by peer\n' }))
      .mockImplementationOnce(() => commandChild({ code: 0, stdout: 'ready\n' }))
    const sleep = vi.fn(async () => undefined)

    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }
    await expect(runSshCommand(parseRemoteArgs(['host']), 'printf ready', {
      spawnProcess,
      sleep,
      stdout,
      stderr,
    })).resolves.toBe('ready\n')
    expect(spawnProcess).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenNthCalledWith(1, 750)
    expect(sleep).toHaveBeenNthCalledWith(2, 1500)
    expect(stdout.write).toHaveBeenCalledWith('Connection interrupted; retrying (1 of 2)...\n')
    expect(stderr.write).not.toHaveBeenCalled()
  })

  it('does not retry an ordinary remote command failure', async () => {
    const spawnProcess = vi.fn(() => commandChild({ code: 1, stderr: 'remote command rejected\n' }))
    const stderr = { write: vi.fn() }
    await expect(runSshCommand(parseRemoteArgs(['host']), 'exit 1', {
      spawnProcess,
      sleep: vi.fn(async () => undefined),
      stdout: { write: vi.fn() },
      stderr,
    })).rejects.toThrow('Remote SSH command failed')
    expect(spawnProcess).toHaveBeenCalledOnce()
    expect(stderr.write).toHaveBeenCalledOnce()
    expect(stderr.write).toHaveBeenCalledWith('remote command rejected\n')
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
      .toContain("root='/srv/Alice'\\''s source'")
    expect(buildRemoteBuildToolsProbeCommand()).toContain("printf 'cxx\\n'")
    const clone = buildRemoteCloneCommand("/srv/Alice's source", masterInstallSource)
    expect(clone).toContain("root='/srv/Alice'\\''s source'")
    expect(clone).toContain("--branch 'master' --single-branch")
    expect(clone).toContain('mv "$tmp" "$root"')
    const updateProbe = buildRemoteSourceUpdateProbeCommand('/srv/OpenAlice', masterInstallSource)
    expect(updateProbe).toContain("'refs/heads/master'")
    const update = buildRemoteSourceUpdateCommand('/srv/OpenAlice', masterInstallSource)
    expect(update).toContain('merge --ff-only FETCH_HEAD')
  })
})

function commandChild({ code, stdout = '', stderr = '' }) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn()
  queueMicrotask(() => {
    if (stdout) child.stdout.write(stdout)
    if (stderr) child.stderr.write(stderr)
    child.emit('exit', code, null)
  })
  return child
}

function missingRemote() {
  return {
    platform: { os: 'linux', label: 'Linux x86_64' },
    nodeVersion: 'v22.23.1',
    hasCurl: true,
    piPath: null,
    piVersion: null,
    piCompatible: false,
    sourceCheckoutPresent: true,
    sourceCheckoutState: 'present',
    sourceArtifactsReady: false,
    runtimeBuildToolsMissing: ['git', 'python3', 'make', 'cxx'],
    cliPath: null,
    cliVersion: null,
    installSource: null,
    cliCompatible: false,
    status: null,
  }
}

function compatibleRemote(statusOverrides = {}) {
  return {
    platform: { os: 'linux', label: 'Linux x86_64' },
    nodeVersion: 'v22.23.1',
    hasCurl: true,
    piPath: '/home/alice/.openalice/bin/pi',
    piVersion: '0.80.6',
    piCompatible: true,
    sourceCheckoutPresent: null,
    sourceCheckoutState: null,
    sourceArtifactsReady: null,
    runtimeBuildToolsMissing: [],
    cliPath: '/home/alice/.openalice/bin/openalice',
    cliVersion: '0.2.0',
    installSource: masterInstallSource,
    cliCompatible: true,
    status: {
      protocol: 1,
      class: 'running',
      state: 'running',
      home: '/home/alice/.openalice',
      owner: { surface: 'cli-server', pid: 99, launchRoot: '/srv/OpenAlice' },
      endpoints: { web: 'http://127.0.0.1:47331' },
      components: { alice: 'ready', uta: 'disabled', connector: 'disabled' },
      capabilities: ['runtime.stop'],
      ...statusOverrides,
    },
  }
}

function managedUpdateRemote(statusOverrides = {}) {
  return {
    ...compatibleRemote(statusOverrides),
    managedAppDir: '/home/alice/.openalice/sources/branch-master-12345678/OpenAlice',
    sourceCheckoutState: 'present',
    sourceCheckoutPresent: true,
    sourceArtifactsReady: true,
    sourceUpdateAvailable: true,
    sourceDirty: false,
  }
}
