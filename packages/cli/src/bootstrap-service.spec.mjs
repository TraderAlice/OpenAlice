import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  installPersistentService,
  OPENALICE_LAUNCH_AGENT_LABEL,
  OPENALICE_SERVICE_NAME,
} from './bootstrap-service.mjs'

const temporaryRoots = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('native bootstrap persistence adapters', () => {
  it('registers a Windows logon task with the native executable and no script host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-service-test-'))
    temporaryRoots.push(root)
    const writes = []
    const calls = []
    const spawnSyncImpl = vi.fn((command, args) => {
      calls.push([command, args])
      if (command === 'whoami.exe') return ok('"DESKTOP\\alice","S-1-5-21-1234"\r\n')
      if (String(command).toLowerCase().endsWith('cmd.exe')) return failed()
      if (command.endsWith('openalice.exe')) return ok(JSON.stringify(runningStatus()))
      return ok('')
    })

    const result = await installPersistentService({
      mode: 'auto',
      platform: 'win32',
      arch: 'x64',
      commandPath: 'C:\\Alice Root\\bin\\openalice.cmd',
      statusCommandPath: 'C:\\Alice Root\\cli\\release\\bin\\openalice.exe',
      statusEnv: { OPENALICE_INSTALL_ROOT: 'C:\\Alice Root' },
      installRoot: 'C:\\Alice Root',
      homeRoot: 'C:\\Alice Root',
      port: 47332,
      waitSeconds: 5,
    }, {
      temporaryRoot: root,
      spawnSyncImpl,
      writeFileImpl: async (path, contents, encoding) => writes.push([path, String(contents), encoding]),
      rmImpl: async () => undefined,
      sleep: async () => undefined,
    })

    expect(result).toMatchObject({ manager: 'task-scheduler', name: OPENALICE_SERVICE_NAME, state: 'running' })
    expect(calls.filter(([command]) => command === 'schtasks.exe').map(([, args]) => args[0])).toEqual(['/Create', '/Run'])
    expect(calls.find(([command, args]) => command === 'schtasks.exe' && args[0] === '/Create')[1]).not.toContain('/F')
    expect(writes).toHaveLength(1)
    expect(writes[0][1].startsWith('\uFEFF<?xml version="1.0" encoding="UTF-16"?>')).toBe(true)
    expect(writes[0][2]).toBe('utf16le')
    expect(writes[0][1]).toContain('<UserId>S-1-5-21-1234</UserId>')
    expect(writes[0][1]).toContain('<Command>C:\\Alice Root\\cli\\release\\bin\\openalice.exe</Command>')
    expect(writes[0][1]).toContain('<Arguments>server run --home &quot;C:\\Alice Root&quot; --port 47332 --wait 5</Arguments>')
    expect(writes[0][1]).not.toMatch(/cmd\.exe|powershell/i)
  })

  it('removes a newly registered Windows task when the runtime never becomes ready', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-service-test-'))
    temporaryRoots.push(root)
    const calls = []
    const spawnSyncImpl = vi.fn((command, args) => {
      calls.push([command, args])
      if (command === 'whoami.exe') return ok('"DESKTOP\\alice","S-1-5-21-1234"\r\n')
      if (String(command).toLowerCase().endsWith('cmd.exe')) return failed()
      if (command.endsWith('openalice.exe')) return failed('not running')
      return ok('')
    })

    await expect(installPersistentService(windowsServiceOptions({ waitSeconds: 0 }), {
      temporaryRoot: root,
      spawnSyncImpl,
      sleep: async () => undefined,
    })).rejects.toThrow('did not become ready')

    expect(calls.filter(([command]) => command === 'schtasks.exe').map(([, args]) => args[0])).toEqual([
      '/Create', '/Run', '/End', '/Delete',
    ])
  })

  it('refuses an unowned Windows task and restores an authorized replacement after failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-service-test-'))
    temporaryRoots.push(root)
    const calls = []
    const spawnSyncImpl = vi.fn((command, args) => {
      calls.push([command, args])
      if (command === 'whoami.exe') return ok('"DESKTOP\\alice","S-1-5-21-1234"\r\n')
      if (String(command).toLowerCase().endsWith('cmd.exe')) return ok('')
      if (command.endsWith('openalice.exe')) return failed('not running')
      return ok('')
    })

    await expect(installPersistentService(windowsServiceOptions(), {
      temporaryRoot: root,
      spawnSyncImpl,
    })).rejects.toThrow('already owned by another installation')
    expect(calls.some(([command]) => command === 'schtasks.exe')).toBe(false)

    calls.length = 0
    await expect(installPersistentService(windowsServiceOptions({ replaceExisting: true, waitSeconds: 0 }), {
      temporaryRoot: root,
      spawnSyncImpl,
      sleep: async () => undefined,
    })).rejects.toThrow('did not become ready')
    expect(calls.filter(([command]) => command === 'schtasks.exe').map(([, args]) => args[0])).toEqual([
      '/Create', '/Run', '/End', '/Delete', '/Create', '/Run',
    ])
    expect(calls.filter(([command, args]) => command === 'schtasks.exe' && args[0] === '/Create')
      .every(([, args]) => args.includes('/F'))).toBe(true)
  })

  it('writes and activates a user systemd unit on Linux', async () => {
    const calls = []
    const writes = []
    const result = await installPersistentService({
      mode: 'auto',
      platform: 'linux',
      arch: 'x64',
      commandPath: '/home/alice/.openalice/bin/openalice',
      statusCommandPath: '/home/alice/.openalice/cli/releases/r/bin/openalice',
      installRoot: '/home/alice/.openalice',
      homeRoot: '/home/alice/.openalice',
      port: 47332,
      waitSeconds: 5,
    }, serviceDependencies(calls, writes))

    expect(result).toMatchObject({ manager: 'systemd-user', name: 'openalice.service', state: 'running' })
    expect(calls.filter(([command]) => command === 'systemctl').map(([, args]) => args.join(' '))).toEqual([
      '--user daemon-reload',
      '--user enable openalice.service',
      '--user restart openalice.service',
    ])
    expect(writes[0][1]).toContain('Type=simple')
    expect(writes[0][1]).not.toContain('RemainAfterExit')
    expect(writes[0][1]).toContain('ExecStart="/home/alice/.openalice/bin/openalice" "server" "run"')
  })

  it('bootstraps a macOS LaunchAgent in the interactive user domain', async () => {
    const calls = []
    const writes = []
    const dependencies = serviceDependencies(calls, writes)
    dependencies.spawnSyncImpl = vi.fn((command, args) => {
      calls.push([command, args])
      if (command === 'id') return ok('501\n')
      if (command.endsWith('/openalice')) return ok(JSON.stringify(runningStatus()))
      return ok('')
    })
    const result = await installPersistentService({
      mode: 'auto',
      platform: 'darwin',
      arch: 'arm64',
      commandPath: '/Users/alice/.openalice/bin/openalice',
      statusCommandPath: '/Users/alice/.openalice/cli/releases/r/bin/openalice',
      installRoot: '/Users/alice/.openalice',
      homeRoot: '/Users/alice/.openalice',
      port: 47332,
      waitSeconds: 5,
    }, dependencies)

    expect(result).toMatchObject({ manager: 'launchd', name: OPENALICE_LAUNCH_AGENT_LABEL, state: 'running' })
    expect(calls.filter(([command]) => command === 'launchctl').map(([, args]) => args[0])).toEqual([
      'bootout', 'bootstrap', 'kickstart',
    ])
    expect(writes[0][1]).toContain(`<string>${OPENALICE_LAUNCH_AGENT_LABEL}</string>`)
    expect(writes[0][1]).toContain('<key>AbandonProcessGroup</key><true/>')
    expect(writes[0][1]).toContain('<string>server</string>\n      <string>run</string>')
  })
})

function windowsServiceOptions(overrides = {}) {
  return {
    mode: 'auto',
    platform: 'win32',
    arch: 'x64',
    commandPath: 'C:\\Alice Root\\bin\\openalice.cmd',
    statusCommandPath: 'C:\\Alice Root\\cli\\release\\bin\\openalice.exe',
    statusEnv: { OPENALICE_INSTALL_ROOT: 'C:\\Alice Root' },
    installRoot: 'C:\\Alice Root',
    homeRoot: 'C:\\Alice Root',
    port: 47332,
    waitSeconds: 5,
    ...overrides,
  }
}

function serviceDependencies(calls, writes) {
  return {
    unitPath: '/tmp/openalice.service',
    plistPath: '/tmp/openalice.plist',
    readFileImpl: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) },
    mkdirImpl: async () => undefined,
    writeFileImpl: async (path, contents) => writes.push([path, String(contents)]),
    renameImpl: async () => undefined,
    rmImpl: async () => undefined,
    sleep: async () => undefined,
    spawnSyncImpl: vi.fn((command, args) => {
      calls.push([command, args])
      if (command.includes('openalice')) return ok(JSON.stringify(runningStatus()))
      return ok('')
    }),
  }
}

function runningStatus() {
  return { class: 'running', state: 'running', endpoints: { web: 'http://127.0.0.1:47332' } }
}

function ok(stdout) {
  return { status: 0, stdout, stderr: '' }
}

function failed(stderr = '') {
  return { status: 1, stdout: '', stderr }
}
