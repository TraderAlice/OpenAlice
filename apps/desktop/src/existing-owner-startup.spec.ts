import { beforeEach, describe, expect, it, vi } from 'vitest'

import { classifyGuardianRuntimeStatus, decideExistingOwnerStartup } from '@traderalice/guardian-runtime'
import {
  dialogButtons,
  dialogCancelId,
  dialogDefaultId,
  resolveExistingOwnerStartup,
} from './existing-owner-startup.js'

const electron = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
  showErrorBox: vi.fn(),
  openExternal: vi.fn(),
}))

vi.mock('electron', () => ({
  dialog: {
    showMessageBox: electron.showMessageBox,
    showErrorBox: electron.showErrorBox,
  },
  shell: { openExternal: electron.openExternal },
}))

const activeLock = {
  state: 'active' as const,
  heartbeatStale: false,
  owner: {
    schemaVersion: 1 as const,
    pid: 42,
    hostname: 'host',
    token: 'hidden',
    launcher: 'guardian-dev',
    acquiredAt: '2026-08-13T00:00:00.000Z',
    heartbeatAt: '2026-08-13T00:00:10.000Z',
  },
  lockDir: '/tmp/home/state/guardian.lock',
  heartbeatAgeMs: 10,
  directoryIdentity: 'id',
  reason: 'active',
}

describe('desktop existing-owner dialog', () => {
  beforeEach(() => {
    electron.showMessageBox.mockReset()
    electron.showErrorBox.mockReset()
    electron.openExternal.mockReset()
  })

  it('defaults a healthy dev owner to Open in browser, then quits without takeover', async () => {
    electron.showMessageBox.mockResolvedValue({ response: 0 })
    electron.openExternal.mockResolvedValue(undefined)
    const discovered = classifyGuardianRuntimeStatus('/tmp/home', {
      state: 'running',
      owner: { surface: 'dev', pid: 42 },
      endpoints: { web: 'http://127.0.0.1:5173' },
      components: { alice: 'ready' },
    })

    await expect(resolveExistingOwnerStartup({
      userDataHome: '/tmp/home',
      launcherRoot: '/tmp/home/workspaces',
      canChooseAnother: true,
      takeoverRequested: false,
      dependencies: {
        inspectLocks: async () => [activeLock],
        discoverRuntime: async () => discovered,
        probeAuth: async () => true,
        showMessageBox: electron.showMessageBox,
        openExternal: electron.openExternal,
      },
    })).resolves.toEqual({ action: 'quit' })

    expect(electron.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      buttons: [
        'Open in browser',
        'Keep existing AliceProject',
        'Choose another data location',
        'Stop the other AliceProject and start this one',
      ],
      defaultId: 0,
      cancelId: 1,
    }))
    expect(electron.openExternal).toHaveBeenCalledWith('http://127.0.0.1:5173')
  })

  it('dismisses a healthy handoff without opening the browser or taking over', async () => {
    electron.showMessageBox.mockResolvedValue({ response: 1 })
    const discovered = classifyGuardianRuntimeStatus('/tmp/home', {
      state: 'running',
      owner: { surface: 'dev', pid: 42 },
      endpoints: { web: 'http://127.0.0.1:5173' },
      components: { alice: 'ready' },
    })

    await expect(resolveExistingOwnerStartup({
      userDataHome: '/tmp/home',
      launcherRoot: '/tmp/home/workspaces',
      canChooseAnother: true,
      takeoverRequested: false,
      dependencies: {
        inspectLocks: async () => [activeLock],
        discoverRuntime: async () => discovered,
        probeAuth: async () => true,
        showMessageBox: electron.showMessageBox,
        openExternal: electron.openExternal,
      },
    })).resolves.toEqual({ action: 'quit' })

    expect(electron.openExternal).not.toHaveBeenCalled()
    expect(electron.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      defaultId: 0,
      cancelId: 1,
    }))
  })

  it('keeps takeover secondary for Electron owners and preserves stale default', () => {
    const electronDecision = decideExistingOwnerStartup({
      home: '/tmp/home',
      lock: { ...activeLock, owner: { ...activeLock.owner, launcher: 'guardian-electron-dev' } },
      discovered: classifyGuardianRuntimeStatus('/tmp/home', {
        state: 'running',
        owner: { surface: 'electron-dev', pid: 9 },
        endpoints: { web: 'http://127.0.0.1:5173' },
        components: { alice: 'ready' },
      }),
      probeOk: true,
      canChooseAnother: true,
    })
    expect(electronDecision.kind).toBe('conflict')
    if (electronDecision.kind !== 'conflict') throw new Error('expected conflict')
    expect(dialogButtons(electronDecision)).toEqual([
      'Keep existing AliceProject',
      'Choose another data location',
      'Stop it and start this AliceProject',
    ])
    expect(dialogCancelId(electronDecision)).toBe(0)
    expect(dialogDefaultId(electronDecision)).toBe(0)

    const stale = decideExistingOwnerStartup({
      home: '/tmp/home',
      lock: { ...activeLock, heartbeatStale: true },
      discovered: null,
      probeOk: false,
      canChooseAnother: false,
    })
    expect(stale.kind).toBe('conflict')
    if (stale.kind !== 'conflict') throw new Error('expected conflict')
    expect(stale.defaultAction).toBe('takeover')
    expect(dialogButtons(stale)).toEqual([
      'Keep existing AliceProject',
      'Stop it and start this AliceProject',
    ])
    expect(dialogDefaultId(stale)).toBe(1)
    expect(dialogCancelId(stale)).toBe(0)
  })

  it('quits without takeover when Esc cancels a stale-owner dialog', async () => {
    electron.showMessageBox.mockResolvedValue({ response: 0 })
    await expect(resolveExistingOwnerStartup({
      userDataHome: '/tmp/home',
      launcherRoot: '/tmp/home/workspaces',
      canChooseAnother: false,
      takeoverRequested: false,
      dependencies: {
        inspectLocks: async () => [{ ...activeLock, heartbeatStale: true }],
        discoverRuntime: async () => null,
        probeAuth: async () => false,
        showMessageBox: electron.showMessageBox,
        openExternal: electron.openExternal,
      },
    })).resolves.toEqual({ action: 'quit' })
    expect(electron.openExternal).not.toHaveBeenCalled()
    expect(electron.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      defaultId: 1,
      cancelId: 0,
    }))
  })

  it('does not open a browser when takeover was already requested', async () => {
    await expect(resolveExistingOwnerStartup({
      userDataHome: '/tmp/home',
      launcherRoot: '/tmp/home/workspaces',
      canChooseAnother: true,
      takeoverRequested: true,
      dependencies: {
        inspectLocks: async () => [activeLock],
        discoverRuntime: async () => {
          throw new Error('should not discover during takeover')
        },
      },
    })).resolves.toEqual({ action: 'continue', takeover: true })
  })
})
