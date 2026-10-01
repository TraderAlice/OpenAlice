import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectRemote, createRemotePlan, parseRemoteArgs } from '../../../packages/cli/src/remote.mjs'
import { readRemoteUpdate } from '../../../packages/cli/src/remote-update-journal.mjs'
import { initial, runtimePlans } from '../../../ui/src/components/dev/upgrade-rehearsal/model'

function host(version: string, identity = 'aaaaaaaaaaaaaaaa') {
  const path = `/srv/cli/releases/${version}-linux-x64-${identity}`
  return { platform: { os: 'linux', architecture: 'x86_64', label: 'Linux x64' },
    cliPath: '/srv/bin/openalice', cliVersion: version, cliCompatible: true, cliContentIdentity: identity, hasCurl: true,
    installSource: { schemaVersion: 3, repository: 'TraderAlice/OpenAlice', cliVersion: version,
      selector: { kind: 'version', value: `v${version}` }, installerUrl: 'https://example.test/install',
      updateChannel: version.includes('-') ? 'beta' : 'stable', method: 'direct',
      artifact: { platform: 'linux', arch: 'x64', sha256: identity.repeat(4) }, installedAt: '2026-09-27T00:00:00Z' },
    managedRuntime: { path, productVersion: version, contentIdentity: identity, platform: 'linux', arch: 'x64', compatible: true },
    status: { protocol: 1, class: 'running', state: 'running', home: '/srv/projects/selected', productVersion: version,
      owner: { surface: 'cli-server', pid: 123, instanceId: 'original', startedAt: '2026-09-24T00:00:00Z', launchRoot: `${path}/share/openalice` },
      provider: { kind: 'bun', root: `${path}/share/openalice`, contentIdentity: identity },
      endpoints: { web: 'http://127.0.0.1:47331' }, capabilities: ['runtime.stop'] } }
}
const stable = () => host('0.94.1')
const beta = () => host('0.94.1-beta.2', 'bbbbbbbbbbbbbbbb')
const pending = () => ({ ...stable(), status: { ...beta().status,
  pendingActivation: { productVersion: '0.94.1', restartRequired: true } } })
const stopped = () => ({ ...stable(), status: { ...stable().status, class: 'absent', state: 'absent', owner: null, provider: null } })
const options = () => parseRemoteArgs(['fixture', '--home', '/srv/projects/selected', '--yes'])
let scratch: string
let env: Record<string, string>
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'openalice-update-recovery-'))
  env = { OPENALICE_REMOTE_STATE_FILE: join(scratch, 'remote.json') }
})
afterEach(async () => { await rm(scratch, { recursive: true, force: true }) })
function dependencies() {
  return { env, installSource: beta().installSource, contentIdentity: beta().cliContentIdentity,
    runRemote: vi.fn(async (..._args: unknown[]) => ''), connectTunnel: vi.fn(async () => 0), stdout: { write: vi.fn() } }
}

describe('remote upgrade recovery through the production controller', () => {
  it('does not require the client CPU architecture payload on another architecture', () => {
    const client = stable()
    client.installSource.artifact.arch = 'arm64'
    const plan = createRemotePlan(options(), host('0.94.0', 'cccccccccccccccc'), {
      installSource: client.installSource, contentIdentity: client.cliContentIdentity,
    })
    expect(plan.lifecycle?.target).toEqual({ version: '0.94.1', channel: 'stable' })
    expect(plan.lifecycle?.stages).toContain('install')
  })
  it('produces the same activation-only plan in production and rehearsal for installed stable / active beta', () => {
    const actual = createRemotePlan(options(), pending(), { installSource: beta().installSource })
    const rehearsed = runtimePlans(initial('pending-activation')).backend
    expect(actual.blocker).toBe('')
    expect(actual.installCli).toBe(false)
    expect(actual.restartServer).toBe(true)
    expect(actual.lifecycle?.stages).toEqual(rehearsed.stages)
    expect(actual.lifecycle?.target?.version).toBe(rehearsed.target?.version)
    expect(actual.installSource.cliVersion).toBe('0.94.1')
  })
  it('activates installed stable with no installer command and reconnects only after verification', async () => {
    const deps = dependencies()
    const probeRemote = vi.fn().mockResolvedValueOnce(pending()).mockResolvedValueOnce(stopped()).mockResolvedValueOnce(stable())
    await connectRemote(options(), { ...deps, probeRemote })
    expect(deps.runRemote.mock.calls.map(call => call[1])).toEqual([
      expect.stringContaining('server stop'), expect.stringContaining('server start'),
    ])
    expect(deps.connectTunnel).toHaveBeenCalledOnce()
    expect(await readRemoteUpdate(options(), deps)).toBeNull()
  })
  it('resumes after controller loss following installation without reinstalling or changing the approved target', async () => {
    const deps = { ...dependencies(), installSource: stable().installSource, contentIdentity: stable().cliContentIdentity }
    const old = host('0.94.0', 'cccccccccccccccc')
    await expect(connectRemote(options(), { ...deps, probeRemote: vi.fn().mockResolvedValueOnce(old)
      .mockRejectedValueOnce(new Error('SSH unavailable after install')) })).rejects.toThrow('SSH unavailable')
    expect(deps.runRemote).toHaveBeenCalledOnce()
    expect(deps.runRemote.mock.calls[0]?.[1]).toContain('openalice-install')
    const afterInstall = { ...stable(), status: old.status }
    const next = dependencies() // A different (older beta) client resumes the recorded stable target.
    await connectRemote(options(), { ...next, probeRemote: vi.fn().mockResolvedValueOnce(afterInstall)
      .mockResolvedValueOnce(stopped()).mockResolvedValueOnce(stable()) })
    expect(next.runRemote.mock.calls.map(call => call[1])).toEqual([
      expect.stringContaining('server stop'), expect.stringContaining('server start'),
    ])
  })
  it('resumes activation after the old process stopped but startup was interrupted', async () => {
    const deps = dependencies()
    deps.runRemote.mockResolvedValueOnce('').mockRejectedValueOnce(new Error('startup connection lost'))
    await expect(connectRemote(options(), { ...deps, probeRemote: vi.fn().mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(stopped()).mockRejectedValueOnce(new Error('unreachable')) })).rejects.toThrow('startup connection lost')
    const next = dependencies()
    await connectRemote(options(), { ...next, probeRemote: vi.fn().mockResolvedValueOnce(stopped()).mockResolvedValueOnce(stable()) })
    expect(next.runRemote).toHaveBeenCalledOnce()
    expect(next.runRemote.mock.calls[0]?.[1]).toContain('server start')
  })
  it('does not stop a replacement owner when recovering an interrupted activation', async () => {
    const deps = dependencies()
    deps.runRemote.mockRejectedValueOnce(new Error('disconnected'))
    await expect(connectRemote(options(), { ...deps, probeRemote: vi.fn().mockResolvedValueOnce(pending())
      .mockRejectedValueOnce(new Error('unreachable')) })).rejects.toThrow('disconnected')
    const changed = pending()
    changed.status.owner.instanceId = 'replacement'
    const next = dependencies()
    await expect(connectRemote(options(), { ...next, probeRemote: async () => changed })).rejects.toThrow('owner changed')
    expect(next.runRemote).not.toHaveBeenCalled()
  })
  it('retains failed reconnect in the journal and retries it without another restart', async () => {
    const deps = dependencies()
    await expect(connectRemote(options(), { ...deps, probeRemote: vi.fn().mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(stopped()).mockResolvedValueOnce(stable()),
      afterRuntimeReady: async () => { throw new Error('relay reconnect failed') },
    })).rejects.toThrow('relay reconnect failed')
    expect((await readRemoteUpdate(options(), deps))?.operation.completed).toEqual(['activate', 'verify'])
    const next = dependencies()
    await connectRemote(options(), { ...next, probeRemote: async () => stable() })
    expect(next.runRemote).not.toHaveBeenCalled()
    expect(next.connectTunnel).toHaveBeenCalledOnce()
  })
  it('keeps completed activation recorded when a foreground tunnel later disconnects', async () => {
    const deps = dependencies()
    await expect(connectRemote(options(), { ...deps, probeRemote: async () => stable(),
      connectTunnel: async (tunnel: { onReady: (value: { localPort: number }) => Promise<void> }) => {
        await tunnel.onReady({ localPort: 47331 })
        throw new Error('later SSH disconnect')
      },
    })).rejects.toThrow('later SSH disconnect')
    expect(await readRemoteUpdate(options(), deps)).toBeNull()
    expect(deps.runRemote).not.toHaveBeenCalled()
  })
  it('discovers explicit upgrades from the remote channel instead of the client channel', async () => {
    const deps = dependencies()
    const checkForUpdateImpl = vi.fn(async (..._args: unknown[]) => ({ status: 'current' }))
    await connectRemote({ ...options(), planOnly: true, updateIntent: 'update' }, { ...deps,
      probeRemote: async () => stable(), checkForUpdateImpl })
    expect(checkForUpdateImpl.mock.calls[0]?.[0]).toMatchObject({ currentVersion: '0.94.1',
      installSource: { updateChannel: 'stable' }, platform: 'linux', arch: 'x64' })
    expect(deps.runRemote).not.toHaveBeenCalled()
  })
})
