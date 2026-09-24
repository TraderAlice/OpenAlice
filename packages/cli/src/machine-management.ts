/** Local GUI control for read-only Machine plans and explicitly approved apply. */
import { randomUUID } from 'node:crypto'

import { connectRemote, parseRemoteArgs } from './remote.mjs'
import { inspectRegisteredMachine } from './machine-inventory.ts'
import {
  readMachineRegistrySummary,
  registerMachineProfile,
  requireMachineEnabled,
  validateMachineProfile,
  type RegisterMachineProfileInput,
  type RegisteredMachine,
} from './machine-registry.ts'

type PlanMode = 'add' | 'upgrade'
type PlanInput = { mode: PlanMode; sshTarget?: string; label?: string; sshPort?: number; identityFile?: string; machineKey?: string; projectKey?: string }
type ResolvedInput = { mode: PlanMode; profile: RegisterMachineProfileInput; machine?: RegisteredMachine; project?: { key: string; displayName: string; home: string } }
type RemotePlan = {
  blocker: string
  mutations: string[]
  cliVersion: string
  cliPath: string
  runtimeClass: string
  runtimeOwner: string
  platform: string
  activationRoute: string
  installSource: { cliVersion: string }
  deferredCliUpdate: boolean
}

export interface MachinePlanPreview {
  id: string
  mode: PlanMode
  machine: { key: string | null; label: string; sshTarget: string }
  project: { key: string; displayName: string } | null
  platform: string
  installedVersion: string
  targetVersion: string
  runtime: string
  actions: string[]
  blocker: string | null
  deferredUpdate: boolean
  expiresAt: string
}

export interface MachineOperation {
  id: string
  planId: string
  mode: PlanMode
  phase: 'running' | 'succeeded' | 'failed'
  stage: 'checking' | 'installing' | 'verifying-install' | 'preparing-source' | 'restarting' | 'verifying'
  startedAt: string
  error: string | null
}

const NULL_OUTPUT = { write: (_chunk: string): void => undefined }
const PLAN_TTL_MS = 5 * 60_000

export interface MachineManagementOptions {
  connectRemote?: typeof connectRemote
  readRegistry?: typeof readMachineRegistrySummary
  register?: typeof registerMachineProfile
  inspect?: typeof inspectRegisteredMachine
}

export class MachineManagement {
  private readonly plans = new Map<string, { input: ResolvedInput; fingerprint: string; expiresAt: number }>()
  private applying = false
  private operation: MachineOperation | null = null
  private readonly options: MachineManagementOptions

  constructor(options: MachineManagementOptions = {}) { this.options = options }

  get busy(): boolean { return this.applying }
  get currentOperation(): MachineOperation | null { return this.operation && { ...this.operation } }

  async plan(input: PlanInput): Promise<MachinePlanPreview> {
    if (this.applying) throw new Error('Wait for the current Machine operation to finish.')
    const resolved = await this.resolve(input)
    let captured: RemotePlan | null = null
    try {
      await (this.options.connectRemote ?? connectRemote)(this.remoteOptions(resolved, true), {
        stdout: NULL_OUTPUT,
        connectTunnel: async () => 0,
        onPlan: (plan: RemotePlan) => { captured = plan },
      })
    } catch (error) {
      if (!captured || !(captured as RemotePlan).blocker) throw error
    }
    if (!captured) throw new Error('The remote probe did not produce a plan.')
    const plan = captured as RemotePlan
    const id = randomUUID()
    const expiresAt = Date.now() + PLAN_TTL_MS
    this.plans.set(id, { input: resolved, fingerprint: JSON.stringify(plan), expiresAt })
    for (const [key, entry] of this.plans) if (entry.expiresAt < Date.now()) this.plans.delete(key)
    while (this.plans.size > 32) this.plans.delete(this.plans.keys().next().value!)
    return {
      id,
      mode: resolved.mode,
      machine: { key: resolved.machine?.key ?? null, label: resolved.profile.label, sshTarget: resolved.profile.sshTarget },
      project: resolved.project ? { key: resolved.project.key, displayName: resolved.project.displayName } : null,
      platform: plan.platform,
      installedVersion: plan.cliVersion,
      targetVersion: plan.installSource.cliVersion,
      runtime: `${plan.runtimeClass} · ${plan.runtimeOwner}`,
      actions: plan.mutations,
      blocker: plan.blocker || null,
      deferredUpdate: plan.deferredCliUpdate,
      expiresAt: new Date(expiresAt).toISOString(),
    }
  }

  async apply(
    id: string,
    afterApply?: (result: { machineKey: string; inventory: Awaited<ReturnType<typeof inspectRegisteredMachine>> }) => Promise<void>,
  ): Promise<{ machineKey: string; inventory: Awaited<ReturnType<typeof inspectRegisteredMachine>> }> {
    if (this.applying) throw new Error('Another Machine operation is in progress.')
    const saved = this.plans.get(id)
    if (!saved || saved.expiresAt < Date.now()) throw new Error('This Machine plan expired. Probe again before applying changes.')
    this.plans.delete(id)
    this.applying = true
    this.operation = { id: randomUUID(), planId: id, mode: saved.input.mode, phase: 'running', stage: 'checking', startedAt: new Date().toISOString(), error: null }
    try {
      const current = await this.resolve({
        mode: saved.input.mode,
        ...(saved.input.mode === 'add' ? saved.input.profile : { machineKey: saved.input.machine?.key, projectKey: saved.input.project?.key }),
      })
      if (JSON.stringify(current) !== JSON.stringify(saved.input)) {
        throw new Error('The Machine profile changed. Probe again before applying changes.')
      }
      let confirmations = 0
      await (this.options.connectRemote ?? connectRemote)(this.remoteOptions(current, false), {
        stdout: NULL_OUTPUT,
        connectTunnel: async () => 0,
        onProgress: (stage: MachineOperation['stage']) => {
          if (this.operation) this.operation = { ...this.operation, stage }
        },
        onPlan: (plan: RemotePlan) => {
          if (JSON.stringify(plan) !== saved.fingerprint) {
            throw new Error('Remote state changed since the probe. Review a fresh plan before applying changes.')
          }
        },
        confirmPlan: async () => {
          if (confirmations++ > 0) throw new Error('The remote plan changed during the update. Probe again before continuing.')
          return true
        },
      })
      const machine = current.mode === 'add'
        ? await (this.options.register ?? registerMachineProfile)(current.profile)
        : current.machine!
      const inventory = await (this.options.inspect ?? inspectRegisteredMachine)(machine)
      await afterApply?.({ machineKey: machine.key, inventory })
      if (this.operation) this.operation = { ...this.operation, phase: 'succeeded', stage: 'verifying' }
      return { machineKey: machine.key, inventory }
    } catch (error) {
      if (this.operation) this.operation = { ...this.operation, phase: 'failed', error: error instanceof Error ? error.message : String(error) }
      throw error
    } finally {
      this.applying = false
    }
  }

  private async resolve(input: PlanInput): Promise<ResolvedInput> {
    const registry = await (this.options.readRegistry ?? readMachineRegistrySummary)()
    if (input.mode === 'upgrade') {
      const machine = registry.machines.find((entry) => entry.key === input.machineKey)
      if (!machine) throw new Error('The selected Machine is no longer registered.')
      requireMachineEnabled(machine)
      let project: ResolvedInput['project']
      if (input.projectKey !== undefined) {
        const inventory = await (this.options.inspect ?? inspectRegisteredMachine)(machine)
        const selected = inventory.projects.find((entry) => entry.key === input.projectKey)
        if (!selected || !selected.available || selected.runtime.class !== 'running') {
          throw new Error('The selected AliceProject is no longer running on this Machine. Refresh and probe again.')
        }
        project = { key: selected.key, displayName: selected.displayName, home: selected.home }
      }
      return { mode: 'upgrade', machine, project, profile: {
        label: machine.displayName, sshTarget: machine.sshTarget,
        ...(machine.sshPort === undefined ? {} : { sshPort: machine.sshPort }),
        ...(machine.identityFile === undefined ? {} : { identityFile: machine.identityFile }),
      } }
    }
    if (input.mode !== 'add' || typeof input.sshTarget !== 'string' || typeof input.label !== 'string') {
      throw new Error('Enter an SSH target and Machine label.')
    }
    const profile: RegisterMachineProfileInput = {
      label: input.label, sshTarget: input.sshTarget,
      ...(input.sshPort === undefined ? {} : { sshPort: input.sshPort }),
      ...(input.identityFile === undefined ? {} : { identityFile: input.identityFile }),
    }
    validateMachineProfile(profile, registry)
    return { mode: 'add', profile }
  }

  private remoteOptions(input: ResolvedInput, planOnly: boolean) {
    const argv = [input.profile.sshTarget, '--no-open']
    if (input.profile.sshPort !== undefined) argv.push('--ssh-port', String(input.profile.sshPort))
    if (input.profile.identityFile !== undefined) argv.push('--identity', input.profile.identityFile)
    if (input.project) argv.push('--home', input.project.home)
    const options = parseRemoteArgs(argv)
    return { ...options, batchMode: true, planOnly }
  }
}
