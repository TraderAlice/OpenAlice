import { describe, expect, it, vi } from 'vitest'

import { MachineManagement } from './machine-management.ts'
import type { MachineRegistrySummary } from './machine-registry.ts'

const machine = { key: 'cloud', id: '0123456789abcdef0123456789abcdef', displayName: 'Cloud', sshTarget: 'alice@example.com', isDefault: false, enabled: true }
const registry = (): MachineRegistrySummary => ({ defaultMachine: 'local', machines: [] })
const remotePlan = () => ({
  blocker: '', mutations: ['update remote OpenAlice CLI', 'restart remote OpenAlice Server'],
  cliVersion: '0.93.1', cliPath: '/usr/bin/openalice', runtimeClass: 'running',
  runtimeOwner: 'cli-server', platform: 'Linux x64', activationRoute: 'stop-start',
  installSource: { cliVersion: '0.94.1' }, deferredCliUpdate: false,
})

describe('GUI Machine management', () => {
  it('keeps a running operation visible, then records the real failure for the UI', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const connectRemote = vi.fn(async (options: { planOnly: boolean }, deps: { onPlan(plan: ReturnType<typeof remotePlan>): void; onProgress?(stage: string): void }) => {
      deps.onPlan(remotePlan())
      if (!options.planOnly) {
        deps.onProgress?.('installing')
        await gate
        throw new Error('Remote install failed after SSH disconnected')
      }
      return 0
    })
    const management = new MachineManagement({ readRegistry: async () => registry(), connectRemote: connectRemote as never })
    const plan = await management.plan({ mode: 'add', label: 'Cloud', sshTarget: 'alice@example.com' })
    const applying = management.apply(plan.id)
    await vi.waitFor(() => expect(management.currentOperation?.stage).toBe('installing'))
    expect(management.busy).toBe(true)
    await expect(management.plan({ mode: 'add', label: 'Other', sshTarget: 'other@example.com' })).rejects.toThrow('Wait')
    release()
    await expect(applying).rejects.toThrow('Remote install failed')
    expect(management.currentOperation).toMatchObject({ phase: 'failed', stage: 'installing', error: 'Remote install failed after SSH disconnected' })
    expect(management.busy).toBe(false)
  })
  it('does not modify or register a Machine until its reviewed plan is applied', async () => {
    const register = vi.fn(async () => machine)
    const inspect = vi.fn(async () => ({ key: 'cloud', connection: 'online' }))
    const connectRemote = vi.fn(async (options: { planOnly: boolean; batchMode: boolean }, deps: {
      onPlan(plan: ReturnType<typeof remotePlan>): void
      confirmPlan(): Promise<boolean>
    }) => {
      deps.onPlan(remotePlan())
      if (!options.planOnly) expect(await deps.confirmPlan()).toBe(true)
      return 0
    })
    const management = new MachineManagement({
      readRegistry: async () => registry(),
      connectRemote: connectRemote as never,
      register: register as never,
      inspect: inspect as never,
    })
    const preview = await management.plan({ mode: 'add', label: 'Cloud', sshTarget: 'alice@example.com' })
    expect(preview.actions).toContain('restart remote OpenAlice Server')
    expect(register).not.toHaveBeenCalled()
    expect(connectRemote.mock.calls[0]?.[0]).toMatchObject({ planOnly: true, batchMode: true })
    await expect(management.apply(preview.id)).resolves.toMatchObject({ machineKey: 'cloud' })
    expect(connectRemote.mock.calls[1]?.[0]).toMatchObject({ planOnly: false, batchMode: true })
    expect(register).toHaveBeenCalledOnce()
    expect(inspect).toHaveBeenCalledWith(machine)
    await expect(management.apply(preview.id)).rejects.toThrow('expired')
  })

  it('keeps an operation running until the presentation transport is restored', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let entered!: () => void
    const callbackEntered = new Promise<void>((resolve) => { entered = resolve })
    const management = new MachineManagement({
      readRegistry: async () => registry(),
      connectRemote: (async (_options: unknown, deps: { onPlan(plan: ReturnType<typeof remotePlan>): void }) => {
        deps.onPlan(remotePlan())
        return 0
      }) as never,
      register: async () => machine,
      inspect: async () => ({ key: 'cloud', connection: 'online' }) as never,
    })
    const preview = await management.plan({ mode: 'add', label: 'Cloud', sshTarget: 'alice@example.com' })
    const applying = management.apply(preview.id, async () => { entered(); await gate })
    await callbackEntered
    expect(management.currentOperation?.phase).toBe('running')
    expect(management.busy).toBe(true)
    release()
    await applying
    expect(management.currentOperation?.phase).toBe('succeeded')
  })

  it('rejects a changed remote plan before any apply action or registry write', async () => {
    let current = remotePlan()
    const register = vi.fn(async () => machine)
    const connectRemote = vi.fn(async (_options: unknown, deps: { onPlan(plan: ReturnType<typeof remotePlan>): void }) => {
      deps.onPlan(current)
      return 0
    })
    const management = new MachineManagement({ readRegistry: async () => registry(), connectRemote: connectRemote as never, register: register as never })
    const preview = await management.plan({ mode: 'add', label: 'Cloud', sshTarget: 'alice@example.com' })
    current = { ...remotePlan(), mutations: ['take over existing Runtime'] }
    await expect(management.apply(preview.id)).rejects.toThrow('Remote state changed')
    expect(register).not.toHaveBeenCalled()
  })

  it('uses the saved SSH profile for an upgrade without adding a second Machine', async () => {
    const register = vi.fn()
    const connectRemote = vi.fn(async (options: { destination: string; planOnly: boolean }, deps: {
      onPlan(plan: ReturnType<typeof remotePlan>): void
      confirmPlan(): Promise<boolean>
    }) => {
      expect(options.destination).toBe(machine.sshTarget)
      deps.onPlan(remotePlan())
      if (!options.planOnly) await deps.confirmPlan()
      return 0
    })
    const management = new MachineManagement({
      readRegistry: async () => ({ defaultMachine: 'local', machines: [machine] }),
      connectRemote: connectRemote as never,
      register: register as never,
      inspect: async () => ({ key: 'cloud', connection: 'online' }) as never,
    })
    const preview = await management.plan({ mode: 'upgrade', machineKey: 'cloud' })
    await management.apply(preview.id)
    expect(register).not.toHaveBeenCalled()
  })

  it('targets the selected running AliceProject home and rejects a changed project before applying', async () => {
    let home = '/srv/alice/main-cloud'
    const inspect = vi.fn(async () => ({
      projects: [{ key: 'main-cloud', displayName: 'Main Cloud', home, available: true, runtime: { class: 'running' } }],
    }))
    const connectRemote = vi.fn(async (options: { remoteHome: string }, deps: { onPlan(plan: ReturnType<typeof remotePlan>): void }) => {
      expect(options.remoteHome).toBe('/srv/alice/main-cloud')
      deps.onPlan(remotePlan())
      return 0
    })
    const management = new MachineManagement({
      readRegistry: async () => ({ defaultMachine: 'local', machines: [machine] }),
      inspect: inspect as never,
      connectRemote: connectRemote as never,
    })
    const preview = await management.plan({ mode: 'upgrade', machineKey: 'cloud', projectKey: 'main-cloud' })
    expect(preview.project?.displayName).toBe('Main Cloud')
    await management.apply(preview.id)
    expect(connectRemote).toHaveBeenCalledTimes(2)
    const nextPreview = await management.plan({ mode: 'upgrade', machineKey: 'cloud', projectKey: 'main-cloud' })
    home = '/srv/alice/moved'
    await expect(management.apply(nextPreview.id)).rejects.toThrow('profile changed')
    expect(connectRemote).toHaveBeenCalledTimes(3)
  })
})
