import { describe, expect, it, vi } from 'vitest'

import { resolveLaunchContext } from './launch-context.ts'
import type { MachineFleetEnvelope, MachineInventory } from './machine-inventory.ts'
import { createSupervisorFleetState } from './supervisor-fleet.ts'
import {
  resolveSupervisorChannel,
  runSupervisorTui,
  type SupervisorAction,
  SupervisorScreen,
} from './supervisor-tui.ts'

const matchesKey = (data: string, key: string) => data === key

describe('Supervisor TUI screen', () => {
  it('labels source-run, stable, beta, and dev channels from install provenance', async () => {
    await expect(resolveSupervisorChannel({
      resolveLayout: () => null,
    })).resolves.toBe('dev')
    await expect(resolveSupervisorChannel({
      resolveLayout: () => ({}),
      readSource: async () => ({
        selector: { kind: 'branch', value: 'dev' },
      }),
    })).resolves.toBe('dev')
    await expect(resolveSupervisorChannel({
      resolveLayout: () => ({}),
      readSource: async () => ({
        updateChannel: 'beta',
        selector: { kind: 'version', value: 'v0.90.2-beta.1' },
      }),
    })).resolves.toBe('beta')
    await expect(resolveSupervisorChannel({
      resolveLayout: () => ({}),
      readSource: async () => ({
        selector: { kind: 'version', value: 'v0.87.0' },
      }),
    })).resolves.toBe('stable')
  })

  it('renders stable stopped-state application chrome', () => {
    const screen = new SupervisorScreen({
      version: '0.87.0-beta',
      channel: 'dev',
      runtime: {
        class: 'absent',
        home: '/tmp/openalice',
        owner: null,
        endpoints: {},
      },
    })

    const lines = screen.render(80)

    expect(lines).toContain('OpenAlice  0.87.0-beta  channel dev')
    expect(lines).toContain('Runtime state: absent')
    expect(lines.join('\n')).toContain('Enter Start & open · s Background · p Setup')
    expect(lines.join('\n')).toContain('i AliceProjects')
    expect(lines).toContain('d Doctor · l Logs · u Update · ? Help')
    expect(lines).toContain('q / Esc / Ctrl+C  Detach without stopping')
  })

  it('renders and navigates the Machine to AliceProject fleet', () => {
    const activated: string[] = []
    const transfers: string[] = []
    let refreshes = 0
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'development',
      runtime: { class: 'absent', endpoints: {} },
      fleet: createSupervisorFleetState(
        '2026-08-23T00:00:00Z',
        fleetMachines(),
        'default',
      ),
    }, {
      onActivateFleet: (machine, project) => activated.push(`${machine.key}/${project.key}`),
      onRefreshFleet: () => { refreshes += 1 },
      onTransferFleet: (project) => transfers.push(project.key),
    })

    const localFleet = screen.render(100).join('\n')
    expect(localFleet).toContain('AliceProjects · This computer')
    expect(localFleet.match(/m Transfer/gu)).toHaveLength(1)
    expect(localFleet).not.toContain('m Managed')
    expect(screen.handleKey('m', matchesKey)).toBe(true)
    expect(transfers).toEqual(['default'])
    expect(screen.handleKey('down', matchesKey)).toBe(true)
    expect(screen.handleKey('tab', matchesKey)).toBe(true)
    expect(screen.render(100).join('\n')).toContain('AliceProjects · Cloud')
    expect(screen.handleKey('o', matchesKey)).toBe(true)
    expect(activated).toEqual(['cloud/research'])
    expect(screen.handleKey('r', matchesKey)).toBe(true)
    expect(refreshes).toBe(1)
    expect(screen.handleKey('s', matchesKey)).toBe(true)
    expect(screen.snapshot.notice).toContain('only for a stopped remote AliceProject')
    expect(screen.handleEscape()).toBe(true)
    expect(screen.snapshot.fleet?.focus).toBe('machines')
  })

  it('offers Start for a stopped compatible remote AliceProject', () => {
    const machines = fleetMachines()
    machines[1]!.projects[0]!.runtime = {
      ...machines[1]!.projects[0]!.runtime,
      class: 'absent',
      state: 'absent',
      ownerSurface: null,
      webEndpoint: null,
    }
    const starts: string[] = []
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      runtime: { class: 'absent', endpoints: {} },
      fleet: createSupervisorFleetState('2026-08-23T00:00:00Z', machines),
    }, {
      onStartFleet: (machine, project) => starts.push(`${machine.key}/${project.key}`),
    })

    screen.handleKey('down', matchesKey)
    screen.handleKey('tab', matchesKey)

    expect(screen.render(100).join('\n')).toContain('s Start stopped AliceProject')
    expect(screen.render(50).join('\n')).toContain('s Start')
    expect(screen.handleKey('s', matchesKey)).toBe(true)
    expect(starts).toEqual(['cloud/research'])
  })

  it('uses a narrow projection and sanitizes diagnostics', () => {
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'development',
      runtime: null,
      diagnostic: 'bad\u001b[31mstate',
    })

    const lines = screen.render(40)

    expect(lines).toContain('Runtime: unavailable')
    expect(lines.join('\n')).not.toContain('\u001b')
    expect(lines.every((line) => line.length <= 40)).toBe(true)
  })

  it('shows the installed Runtime as a product identity instead of a long path', () => {
    const context = resolveLaunchContext({
      cwd: '/tmp',
      homeDir: '/home/alice',
      env: {
        OPENALICE_MANAGED_RUNTIME_PATH: '/opt/openalice/releases/runtime',
        OPENALICE_MANAGED_RUNTIME_CONTENT_IDENTITY: '1234567890abcdef',
      },
    })
    const screen = new SupervisorScreen({
      version: '0.87.0-beta',
      channel: 'stable',
      runtime: {
        class: 'absent',
        home: context.home,
        owner: null,
        endpoints: {},
        provider: { kind: 'unknown' },
      },
      context,
    })

    const output = screen.render(100).join('\n')
    expect(output).toContain('Provider: bundle (installed)')
    expect(output).toContain(
      'Runtime: OpenAlice 0.87.0-beta · bundle 1234567890abcdef',
    )
    expect(output).not.toContain('/opt/openalice/releases/runtime')
  })

  it('dispatches available actions and confirms Runtime mutations', () => {
    const actions: SupervisorAction[] = []
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'development',
      runtime: {
        class: 'running',
        home: '/tmp/openalice',
        owner: { surface: 'cli-server', pid: 42 },
        endpoints: { web: 'http://127.0.0.1:47331' },
        components: { alice: 'ready', uta: 'disabled', connector: 'disabled' },
      },
    }, {
      onAction: (action) => actions.push(action),
    })

    expect(screen.handleKey('o', matchesKey)).toBe(true)
    expect(actions).toEqual(['open'])

    expect(screen.handleKey('r', matchesKey)).toBe(true)
    expect(screen.snapshot.confirmation).toBe('restart')
    expect(screen.render(100).join('\n')).toContain('active Web/agent sessions reconnect or end')

    expect(screen.handleKey('enter', matchesKey)).toBe(true)
    expect(actions).toEqual(['open', 'restart'])
  })

  it('uses Enter as the human-first start-and-open or open action', () => {
    const actions: SupervisorAction[] = []
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'development',
      runtime: { class: 'absent', endpoints: {} },
    }, {
      onAction: (action) => actions.push(action),
    })

    expect(screen.handleKey('enter', matchesKey)).toBe(true)
    expect(actions).toEqual(['start-open'])
    expect(screen.render(100).join('\n')).toContain(
      'Enter prepares anything missing and opens the browser',
    )

    screen.update({
      runtime: {
        class: 'running',
        owner: { surface: 'cli-server', pid: 42 },
        endpoints: { web: 'http://127.0.0.1:47331' },
      },
    })
    expect(screen.handleKey('enter', matchesKey)).toBe(true)
    expect(actions).toEqual(['start-open', 'open'])
    expect(screen.render(100).join('\n')).toContain(
      'Press Enter or o to open the Web UI',
    )
  })

  it('starts the Runtime and opens the browser from one Enter key', async () => {
    const calls: string[] = []
    let runtime: {
      class: string
      owner: { surface: string; pid: number } | null
      endpoints: { web?: string }
    } = {
      class: 'absent',
      owner: null,
      endpoints: {},
    }
    let inputListener: ((data: string) => unknown) | undefined
    class FakeTui {
      addChild(): void {}
      addInputListener(listener: (data: string) => unknown): () => void {
        inputListener = listener
        return () => undefined
      }
      requestRender(): void {}
      setShowHardwareCursor(): void {}
      start(): void {
        queueMicrotask(() => inputListener?.('enter'))
      }
      stop(): void {}
    }
    const fakePiTui = {
      ProcessTerminal: class {},
      TUI: FakeTui,
      matchesKey,
    }
    const context = resolveLaunchContext({
      cwd: '/tmp',
      homeDir: '/home/alice',
      env: {
        OPENALICE_MANAGED_RUNTIME_PATH: '/opt/openalice/runtime',
        OPENALICE_MANAGED_RUNTIME_CONTENT_IDENTITY: '1234567890abcdef',
      },
    })

    await expect(runSupervisorTui({}, {
      stdin: { isTTY: true } as NodeJS.ReadStream,
      stdout: { isTTY: true } as NodeJS.WriteStream,
      resolveContext: () => context,
      inspect: async () => runtime,
      start: async () => {
        calls.push('start')
        runtime = {
          class: 'running',
          owner: { surface: 'cli-server', pid: 42 },
          endpoints: { web: 'http://127.0.0.1:47331' },
        }
      },
      open: async () => {
        calls.push('open')
        queueMicrotask(() => inputListener?.('q'))
      },
      discoverUpdate: async () => null,
      loadTui: async () => fakePiTui as never,
      version: '0.87.0-beta',
      channel: 'stable',
    })).resolves.toBe(0)

    expect(calls).toEqual(['start', 'open'])
  })

  it('aborts TUI-owned remote tunnels when the Supervisor detaches', async () => {
    let inputListener: ((data: string) => unknown) | undefined
    let tunnelAborted = false
    class FakeTui {
      addChild(): void {}
      addInputListener(listener: (data: string) => unknown): () => void {
        inputListener = listener
        return () => undefined
      }
      requestRender(): void {}
      setShowHardwareCursor(): void {}
      start(): void {
        queueMicrotask(() => {
          inputListener?.('down')
          inputListener?.('tab')
          inputListener?.('o')
        })
      }
      stop(): void {}
    }
    const fleet: MachineFleetEnvelope = {
      schemaVersion: 1,
      generatedAt: '2026-08-23T00:00:00Z',
      machines: fleetMachines(),
    }

    await expect(runSupervisorTui({}, {
      stdin: { isTTY: true } as NodeJS.ReadStream,
      stdout: { isTTY: true } as NodeJS.WriteStream,
      resolveContext: () => resolveLaunchContext({
        cwd: '/tmp',
        homeDir: '/home/alice',
      }),
      inspect: async () => ({ class: 'absent', owner: null, endpoints: {} }),
      seedFleet: async () => fleet,
      inspectFleet: async () => fleet,
      connectRemoteProject: async ({ signal, onReady }) => {
        onReady()
        queueMicrotask(() => inputListener?.('q'))
        return new Promise<number>((resolve) => {
          signal.addEventListener('abort', () => {
            tunnelAborted = true
            resolve(0)
          }, { once: true })
        })
      },
      discoverUpdate: async () => null,
      loadTui: async () => ({
        ProcessTerminal: class {},
        TUI: FakeTui,
        matchesKey,
      }) as never,
    })).resolves.toBe(0)

    expect(tunnelAborted).toBe(true)
  })

  it('re-probes and starts a selected stopped remote AliceProject', async () => {
    let inputListener: ((data: string) => unknown) | undefined
    const machines = fleetMachines()
    machines[1]!.projects[0]!.runtime = {
      ...machines[1]!.projects[0]!.runtime,
      class: 'absent',
      state: 'absent',
      ownerSurface: null,
      webEndpoint: null,
    }
    const fleet: MachineFleetEnvelope = {
      schemaVersion: 1,
      generatedAt: '2026-08-23T00:00:00Z',
      machines,
    }
    const startRemoteProject = vi.fn(async () => {
      setTimeout(() => inputListener?.('q'), 0)
    })
    const inspectFleet = vi.fn(async () => fleet)
    class FakeTui {
      addChild(): void {}
      addInputListener(listener: (data: string) => unknown): () => void { inputListener = listener; return () => undefined }
      requestRender(): void {}
      setShowHardwareCursor(): void {}
      start(): void {
        queueMicrotask(() => {
          inputListener?.('down')
          inputListener?.('tab')
          inputListener?.('s')
        })
      }
      stop(): void {}
    }

    await expect(runSupervisorTui({}, {
      stdin: { isTTY: true } as NodeJS.ReadStream,
      stdout: { isTTY: true } as NodeJS.WriteStream,
      resolveContext: () => resolveLaunchContext({ cwd: '/tmp', homeDir: '/home/alice' }),
      inspect: async () => ({ class: 'absent', owner: null, endpoints: {} }),
      seedFleet: async () => fleet,
      inspectFleet,
      loadMachineRegistry: async () => ({
        defaultMachine: 'local',
        machines: [{ key: 'cloud', displayName: 'Cloud', sshTarget: 'cloud.example.com', isDefault: false }],
      }),
      startRemoteProject,
      discoverUpdate: async () => null,
      loadTui: async () => ({ ProcessTerminal: class {}, TUI: FakeTui, matchesKey }) as never,
    })).resolves.toBe(0)

    expect(inspectFleet).toHaveBeenCalled()
    expect(startRemoteProject).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'cloud', sshTarget: 'cloud.example.com' }),
      'research',
    )
  })

  it('keeps the transfer wizard default-no and never invokes the sender', async () => {
    let inputListener: ((data: string) => unknown) | undefined
    let overlayComponent: { handleInput?(data: string): void } | undefined
    const send = vi.fn()
    const fleet: MachineFleetEnvelope = {
      schemaVersion: 1,
      generatedAt: '2026-08-23T00:00:00Z',
      machines: fleetMachines().map((machine) => machine.key === 'cloud'
        ? { ...machine, capabilities: { ...machine.capabilities, transferReceive: true, credentialReseal: true } }
        : machine),
    }
    class FakeTui {
      addChild(): void {}
      addInputListener(listener: (data: string) => unknown): () => void { inputListener = listener; return () => undefined }
      requestRender(): void {}
      setShowHardwareCursor(): void {}
      showOverlay(component: { handleInput?(data: string): void }) {
        overlayComponent = component
        return {
          hide: () => undefined,
          focus: () => {
            setTimeout(() => {
              overlayComponent?.handleInput?.('\r')
              overlayComponent?.handleInput?.('\r')
              overlayComponent?.handleInput?.('\r')
              overlayComponent?.handleInput?.('\r')
              overlayComponent?.handleInput?.('\r')
              setTimeout(() => {
                overlayComponent?.handleInput?.('n')
                inputListener?.('\u0003')
              }, 20)
            }, 0)
          },
        }
      }
      start(): void {
        queueMicrotask(() => inputListener?.('m'))
        setTimeout(() => inputListener?.('\u0003'), 100)
      }
      stop(): void {}
    }
    const realTui = await (await import('./pi-tui-loader.ts')).loadPiTui()
    await expect(runSupervisorTui({}, {
      stdin: { isTTY: true } as NodeJS.ReadStream,
      stdout: { isTTY: true } as NodeJS.WriteStream,
      resolveContext: () => resolveLaunchContext({ cwd: '/tmp', homeDir: '/home/alice' }),
      inspect: async () => ({ class: 'absent', owner: null, endpoints: {} }),
      inspectTransferSource: async () => ({ class: 'absent', owner: null, endpoints: {} }),
      seedFleet: async () => fleet,
      inspectFleet: async () => fleet,
      planProjectTransfer: async (input) => transferPlan(input.source.home, input.destinationHome, input.destinationProjectKey),
      sendProjectTransfer: send,
      discoverUpdate: async () => null,
      loadTui: async () => ({ ...realTui, TUI: FakeTui }) as never,
    })).resolves.toBe(0)
    expect(send).not.toHaveBeenCalled()
  })

  it('retries the same transfer after an injected sender failure', async () => {
    let inputListener: ((data: string) => unknown) | undefined
    let overlayComponent: { render(width: number): string[]; handleInput?(data: string): void } | undefined
    const fleet: MachineFleetEnvelope = {
      schemaVersion: 1,
      generatedAt: '2026-08-23T00:00:00Z',
      machines: fleetMachines().map((machine) => machine.key === 'cloud'
        ? { ...machine, capabilities: { ...machine.capabilities, transferReceive: true, credentialReseal: true } }
        : machine),
    }
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('synthetic checksum failure'))
      .mockResolvedValue({
        schemaVersion: 1,
        transferId: 'tui-transfer-test',
        sourceProjectId: 'alice-project-default',
        destinationProjectId: 'alice-project-tui-destination',
        destinationHome: '/home/alice/.openalice-default-copy',
        files: 0,
        bytes: 0,
        manifestSha256: 'a'.repeat(64),
        credentials: 'included',
        sessionsImported: 0,
        publishedAt: '2026-08-23T00:00:01Z',
      })
    const waitForOverlay = async (text: string) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (overlayComponent?.render(100).join('\n').includes(text)) return
        await new Promise((resolve) => setTimeout(resolve, 2))
      }
      throw new Error(`Transfer overlay did not render ${text}`)
    }
    class FakeTui {
      addChild(): void {}
      addInputListener(listener: (data: string) => unknown): () => void { inputListener = listener; return () => undefined }
      requestRender(): void {}
      setShowHardwareCursor(): void {}
      showOverlay(component: typeof overlayComponent) {
        overlayComponent = component
        return {
          hide: () => undefined,
          focus: () => { void (async () => {
            await waitForOverlay('destination Machine')
            overlayComponent?.handleInput?.('\r')
            await waitForOverlay('Destination AliceProject key')
            overlayComponent?.handleInput?.('\r')
            await waitForOverlay('Destination complete Home')
            overlayComponent?.handleInput?.('\r')
            await waitForOverlay('Credentials')
            overlayComponent?.handleInput?.('\r')
            await waitForOverlay('Exact-Session scheduled Issue owners')
            overlayComponent?.handleInput?.('\r')
            await waitForOverlay('Review AliceProject transfer')
            overlayComponent?.handleInput?.('y')
            await waitForOverlay('synthetic checksum failure')
            overlayComponent?.handleInput?.('r')
            await waitForOverlay('AliceProject transfer complete')
            overlayComponent?.handleInput?.('\r')
            inputListener?.('\u0003')
          })() },
        }
      }
      start(): void {
        queueMicrotask(() => inputListener?.('m'))
        setTimeout(() => inputListener?.('\u0003'), 1_000)
      }
      stop(): void {}
    }
    const realTui = await (await import('./pi-tui-loader.ts')).loadPiTui()

    await expect(runSupervisorTui({}, {
      stdin: { isTTY: true } as NodeJS.ReadStream,
      stdout: { isTTY: true } as NodeJS.WriteStream,
      resolveContext: () => resolveLaunchContext({ cwd: '/tmp', homeDir: '/home/alice' }),
      inspect: async () => ({ class: 'absent', owner: null, endpoints: {} }),
      inspectTransferSource: async () => ({ class: 'absent', owner: null, endpoints: {} }),
      seedFleet: async () => fleet,
      inspectFleet: async () => fleet,
      loadMachineRegistry: async () => ({
        defaultMachine: 'local',
        machines: [{ key: 'cloud', displayName: 'Cloud', sshTarget: 'cloud.example.com', isDefault: false }],
      }),
      planProjectTransfer: async (input) => transferPlan(input.source.home, input.destinationHome, input.destinationProjectKey),
      sendProjectTransfer: send,
      discoverUpdate: async () => null,
      loadTui: async () => ({ ...realTui, TUI: FakeTui }) as never,
    })).resolves.toBe(0)

    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1]?.[0].plan.transferId).toBe('tui-transfer-test')
  })

  it('aborts an active transfer from the wizard without publishing', async () => {
    let inputListener: ((data: string) => unknown) | undefined
    let overlayComponent: { render(width: number): string[]; handleInput?(data: string): void } | undefined
    let aborted = false
    const fleet: MachineFleetEnvelope = {
      schemaVersion: 1,
      generatedAt: '2026-08-23T00:00:00Z',
      machines: fleetMachines().map((machine) => machine.key === 'cloud'
        ? { ...machine, capabilities: { ...machine.capabilities, transferReceive: true, credentialReseal: true } }
        : machine),
    }
    const waitForOverlay = async (text: string) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (overlayComponent?.render(100).join('\n').includes(text)) return
        await new Promise((resolve) => setTimeout(resolve, 2))
      }
      throw new Error(`Transfer overlay did not render ${text}`)
    }
    const send = vi.fn(async (input: { signal?: AbortSignal }) => new Promise<never>((_resolve, reject) => {
      input.signal?.addEventListener('abort', () => {
        aborted = true
        reject(new Error('synthetic cancellation'))
      }, { once: true })
    }))
    class FakeTui {
      addChild(): void {}
      addInputListener(listener: (data: string) => unknown): () => void { inputListener = listener; return () => undefined }
      requestRender(): void {}
      setShowHardwareCursor(): void {}
      showOverlay(component: typeof overlayComponent) {
        overlayComponent = component
        return {
          hide: () => undefined,
          focus: () => { void (async () => {
            for (const label of [
              'destination Machine',
              'Destination AliceProject key',
              'Destination complete Home',
              'Credentials',
              'Exact-Session scheduled Issue owners',
            ]) {
              await waitForOverlay(label)
              overlayComponent?.handleInput?.('\r')
            }
            await waitForOverlay('Review AliceProject transfer')
            overlayComponent?.handleInput?.('y')
            await waitForOverlay('Transferring…')
            overlayComponent?.handleInput?.('\u001b')
            await waitForOverlay('synthetic cancellation')
            overlayComponent?.handleInput?.('\r')
            inputListener?.('\u0003')
          })() },
        }
      }
      start(): void {
        queueMicrotask(() => inputListener?.('m'))
        setTimeout(() => inputListener?.('\u0003'), 1_000)
      }
      stop(): void {}
    }
    const realTui = await (await import('./pi-tui-loader.ts')).loadPiTui()

    await expect(runSupervisorTui({}, {
      stdin: { isTTY: true } as NodeJS.ReadStream,
      stdout: { isTTY: true } as NodeJS.WriteStream,
      resolveContext: () => resolveLaunchContext({ cwd: '/tmp', homeDir: '/home/alice' }),
      inspect: async () => ({ class: 'absent', owner: null, endpoints: {} }),
      inspectTransferSource: async () => ({ class: 'absent', owner: null, endpoints: {} }),
      seedFleet: async () => fleet,
      inspectFleet: async () => fleet,
      loadMachineRegistry: async () => ({
        defaultMachine: 'local',
        machines: [{ key: 'cloud', displayName: 'Cloud', sshTarget: 'cloud.example.com', isDefault: false }],
      }),
      planProjectTransfer: async (input) => transferPlan(input.source.home, input.destinationHome, input.destinationProjectKey),
      sendProjectTransfer: send as never,
      discoverUpdate: async () => null,
      loadTui: async () => ({ ...realTui, TUI: FakeTui }) as never,
    })).resolves.toBe(0)

    expect(send).toHaveBeenCalledOnce()
    expect(aborted).toBe(true)
  })

  it('uses installed provenance to prepare missing source before Enter starts and opens', async () => {
    const calls: string[] = []
    let runtime: {
      class: string
      owner: { surface: string; pid: number } | null
      endpoints: { web?: string }
    } = {
      class: 'absent',
      owner: null,
      endpoints: {},
    }
    let inputListener: ((data: string) => unknown) | undefined
    class FakeTui {
      addChild(): void {}
      addInputListener(listener: (data: string) => unknown): () => void {
        inputListener = listener
        return () => undefined
      }
      requestRender(): void {}
      setShowHardwareCursor(): void {}
      start(): void {
        queueMicrotask(() => inputListener?.('enter'))
      }
      stop(): void {}
    }
    const fakePiTui = {
      ProcessTerminal: class {},
      TUI: FakeTui,
      matchesKey,
    }
    const initialContext = resolveLaunchContext({
      cwd: '/tmp/empty',
      homeDir: '/home/alice',
      env: {},
    })
    const preparedContext = resolveLaunchContext({
      cwd: '/tmp/empty',
      homeDir: '/home/alice',
      flags: { appDir: '/opt/openalice/managed-source' },
      env: {},
    })

    await expect(runSupervisorTui({}, {
      stdin: { isTTY: true } as NodeJS.ReadStream,
      stdout: { isTTY: true } as NodeJS.WriteStream,
      resolveContext: () => initialContext,
      inspect: async () => runtime,
      findSource: async () => {
        throw new Error('No OpenAlice checkout was found.')
      },
      inspectManagedSource: async () => {
        calls.push('inspect-managed')
        setTimeout(() => inputListener?.('enter'), 0)
        return {
          appDir: '/opt/openalice/managed-source',
          installRoot: '/opt/openalice',
          repositoryUrl: 'https://github.com/TraderAlice/OpenAlice.git',
          selector: { kind: 'branch', value: 'dev' },
          state: 'absent',
        }
      },
      prepareManagedSource: async () => {
        calls.push('prepare-managed')
        return {
          appDir: '/opt/openalice/managed-source',
          installRoot: '/opt/openalice',
          repositoryUrl: 'https://github.com/TraderAlice/OpenAlice.git',
          selector: { kind: 'branch', value: 'dev' },
          state: 'present',
          created: true,
        }
      },
      configureProject: async () => {
        calls.push('configure-project')
        return preparedContext
      },
      start: async () => {
        calls.push('start')
        runtime = {
          class: 'running',
          owner: { surface: 'cli-server', pid: 42 },
          endpoints: { web: 'http://127.0.0.1:47331' },
        }
      },
      open: async () => {
        calls.push('open')
        queueMicrotask(() => inputListener?.('q'))
      },
      discoverUpdate: async () => null,
      loadTui: async () => fakePiTui as never,
      version: '0.87.0-beta',
      channel: 'branch dev',
    })).resolves.toBe(0)

    expect(calls).toEqual([
      'inspect-managed',
      'prepare-managed',
      'configure-project',
      'start',
      'open',
    ])
  })

  it('keeps foreign-owned lifecycle mutations unavailable', () => {
    const actions: SupervisorAction[] = []
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'development',
      runtime: {
        class: 'running',
        owner: { surface: 'electron', pid: 7 },
        endpoints: { web: 'http://127.0.0.1:47331' },
      },
    }, {
      onAction: (action) => actions.push(action),
    })

    expect(screen.handleKey('x', matchesKey)).toBe(true)
    expect(actions).toEqual([])
    expect(screen.snapshot.confirmation).toBeUndefined()
    expect(screen.snapshot.notice).toContain('electron owns this Runtime')
  })

  it('changes source only while the selected Runtime is stopped', () => {
    let configureRequests = 0
    const running = new SupervisorScreen({
      version: 'dev',
      channel: 'development',
      runtime: {
        class: 'running',
        owner: { surface: 'cli-server', pid: 42 },
      },
    }, {
      onConfigureSource: () => {
        configureRequests += 1
      },
    })

    expect(running.handleKey('c', matchesKey)).toBe(true)
    expect(configureRequests).toBe(0)
    expect(running.snapshot.notice).toContain('Stop the selected Runtime')

    running.update({ runtime: { class: 'absent' } })
    expect(running.handleKey('c', matchesKey)).toBe(true)
    expect(configureRequests).toBe(1)
  })

  it('opens instance settings while stopped or running', () => {
    let settingsRequests = 0
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'development',
      runtime: { class: 'absent' },
    }, {
      onSettings: () => {
        settingsRequests += 1
      },
    })

    expect(screen.handleKey('p', matchesKey)).toBe(true)
    screen.update({
      runtime: {
        class: 'running',
        owner: { surface: 'cli-server', pid: 42 },
      },
    })
    expect(screen.handleKey('p', matchesKey)).toBe(true)
    expect(settingsRequests).toBe(2)
  })

  it('opens AliceProject selection while stopped or running', () => {
    let projectRequests = 0
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'development',
      runtime: { class: 'absent' },
    }, {
      onProjects: () => {
        projectRequests += 1
      },
    })

    expect(screen.handleKey('i', matchesKey)).toBe(true)
    screen.update({
      runtime: {
        class: 'running',
        owner: { surface: 'cli-server', pid: 42 },
      },
    })
    expect(screen.handleKey('i', matchesKey)).toBe(true)
    expect(projectRequests).toBe(2)
  })

  it('confirms managed source preparation before dispatch', () => {
    let prepareRequests = 0
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'development',
      runtime: { class: 'absent' },
    }, {
      onRequestManagedSource: () => {
        screen.update({ confirmation: 'managed-source' })
      },
      onPrepareManagedSource: () => {
        prepareRequests += 1
      },
    })

    expect(screen.handleKey('m', matchesKey)).toBe(true)
    expect(screen.snapshot.confirmation).toBe('managed-source')
    expect(screen.render(100).join('\n')).toContain(
      'branch/version paired with this CLI',
    )

    expect(screen.handleKey('enter', matchesKey)).toBe(true)
    expect(prepareRequests).toBe(1)
  })

  it('navigates detail panels and requests their read-only data', () => {
    const actions: SupervisorAction[] = []
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'development',
      runtime: { class: 'absent' },
    }, {
      onAction: (action) => actions.push(action),
    })

    expect(screen.handleKey('tab', matchesKey)).toBe(true)
    expect(screen.snapshot.panel).toBe('logs')
    expect(actions).toEqual(['logs'])

    expect(screen.handleKey('?', matchesKey)).toBe(true)
    expect(screen.snapshot.panel).toBe('help')
    expect(screen.render(100).join('\n')).toContain('Supervisor controls')
  })

  it('renders a machine-level recovery shell and gates project actions', () => {
    const actions: SupervisorAction[] = []
    let settingsRequests = 0
    let projectRequests = 0
    let sourceRequests = 0
    const screen = new SupervisorScreen({
      version: '0.89.4-beta',
      channel: 'stable',
      runtime: null,
      mode: 'config-recovery',
      recoveryReason: 'newer-schema',
      diagnostic: 'Supervisor configuration schemaVersion 3 is newer than this OpenAlice',
    }, {
      onAction: (action) => actions.push(action),
      onSettings: () => {
        settingsRequests += 1
      },
      onProjects: () => {
        projectRequests += 1
      },
      onConfigureSource: () => {
        sourceRequests += 1
      },
      onRequestManagedSource: () => {
        sourceRequests += 1
      },
    })

    const output = screen.render(100).join('\n')
    expect(output).toContain('AliceProject configuration cannot be read.')
    expect(output).toContain('requires a newer OpenAlice')
    expect(output).toContain('will not inspect, start, open, stop, restart, or configure a project')
    expect(output).toContain('u Update · ? Help')
    expect(output).not.toContain('Enter Start & open')
    expect(output).not.toContain('i AliceProjects')
    expect(output).not.toContain('Default AliceProject')

    expect(screen.handleKey('enter', matchesKey)).toBe(true)
    expect(screen.handleKey('s', matchesKey)).toBe(true)
    expect(screen.handleKey('o', matchesKey)).toBe(true)
    expect(screen.handleKey('x', matchesKey)).toBe(true)
    expect(screen.handleKey('r', matchesKey)).toBe(true)
    expect(screen.handleKey('l', matchesKey)).toBe(true)
    expect(screen.handleKey('d', matchesKey)).toBe(true)
    expect(screen.handleKey('p', matchesKey)).toBe(true)
    expect(screen.handleKey('i', matchesKey)).toBe(true)
    expect(screen.handleKey('m', matchesKey)).toBe(true)
    expect(screen.handleKey('c', matchesKey)).toBe(true)
    expect(actions).toEqual([])
    expect(settingsRequests).toBe(0)
    expect(projectRequests).toBe(0)
    expect(sourceRequests).toBe(0)
    expect(screen.snapshot.notice).toContain('will not inspect, start, open, stop, restart, or configure')

    expect(screen.handleKey('tab', matchesKey)).toBe(true)
    expect(screen.snapshot.panel).toBe('help')
    expect(screen.render(100).join('\n')).toContain('Supervisor recovery controls')
    expect(screen.render(100).join('\n')).not.toContain('i  Select or create')

    expect(screen.handleKey('u', matchesKey)).toBe(true)
    expect(actions).toEqual(['update'])
  })

  it('confirms an available update before dispatching the installer', () => {
    const actions: SupervisorAction[] = []
    const screen = new SupervisorScreen({
      version: '0.89.4-beta',
      channel: 'stable',
      runtime: { class: 'absent' },
    }, {
      onAction: (action) => actions.push(action),
    })

    expect(screen.handleKey('u', matchesKey)).toBe(true)
    expect(actions).toEqual(['update'])

    screen.update({
      update: {
        status: 'available',
        currentVersion: '0.89.4-beta',
        latestVersion: '0.90.0',
        channel: 'stable',
        sourceChannel: 'stable',
      },
      confirmation: 'update',
    })
    const confirmation = screen.render(100).join('\n')
    expect(confirmation).toContain('Install OpenAlice 0.90.0 from stable now?')
    expect(confirmation).toContain('will not reload')
    expect(confirmation).toContain('run openalice again')

    expect(screen.handleKey('n', matchesKey)).toBe(true)
    expect(actions).toEqual(['update'])
    expect(screen.snapshot.confirmation).toBeUndefined()

    screen.update({ confirmation: 'update' })
    expect(screen.handleKey('enter', matchesKey)).toBe(true)
    expect(actions).toEqual(['update', 'apply-update'])
  })

  it('opens a recovery TUI when AliceProject config is unreadable', async () => {
    const calls: string[] = []
    let inputListener: ((data: string) => unknown) | undefined
    class FakeTui {
      addChild(): void {}
      addInputListener(listener: (data: string) => unknown): () => void {
        inputListener = listener
        return () => undefined
      }
      requestRender(): void {}
      setShowHardwareCursor(): void {}
      start(): void {
        queueMicrotask(() => inputListener?.('s'))
        setTimeout(() => inputListener?.('q'), 5)
      }
      stop(): void {}
    }
    const inspect = async () => {
      calls.push('inspect')
      return { class: 'absent' }
    }
    const start = async () => {
      calls.push('start')
    }

    await expect(runSupervisorTui({}, {
      stdin: { isTTY: true } as NodeJS.ReadStream,
      stdout: { isTTY: true } as NodeJS.WriteStream,
      env: {},
      resolveContext: async () => {
        throw Object.assign(
          new Error('Supervisor configuration schemaVersion 3 is newer than this OpenAlice (supports 2).'),
          { code: 'ESUPERVISORSCHEMA', exitCode: 2 },
        )
      },
      inspect,
      start,
      discoverUpdate: async () => null,
      loadTui: async () => ({
        ProcessTerminal: class {},
        TUI: FakeTui,
        matchesKey,
      }) as never,
      version: '0.89.4-beta',
      channel: 'stable',
    })).resolves.toBe(0)

    expect(calls).toEqual([])
  })

  it('opens recovery even when OPENALICE_HOME is set in the environment', async () => {
    const inspect = async () => {
      throw new Error('must not inspect a guessed project')
    }
    let inputListener: ((data: string) => unknown) | undefined
    class FakeTui {
      addChild(): void {}
      addInputListener(listener: (data: string) => unknown): () => void {
        inputListener = listener
        return () => undefined
      }
      requestRender(): void {}
      setShowHardwareCursor(): void {}
      start(): void {
        queueMicrotask(() => inputListener?.('q'))
      }
      stop(): void {}
    }

    await expect(runSupervisorTui({}, {
      stdin: { isTTY: true } as NodeJS.ReadStream,
      stdout: { isTTY: true } as NodeJS.WriteStream,
      env: { OPENALICE_HOME: '/tmp/explicit-home' },
      resolveContext: async () => {
        throw Object.assign(
          new Error('Invalid Supervisor configuration'),
          { code: 'ESUPERVISORCONFIG', exitCode: 2 },
        )
      },
      inspect,
      discoverUpdate: async () => null,
      loadTui: async () => ({
        ProcessTerminal: class {},
        TUI: FakeTui,
        matchesKey,
      }) as never,
      version: '0.89.4-beta',
      channel: 'stable',
    })).resolves.toBe(0)
  })

  it('still fails explicit --project/--home instead of opening recovery', async () => {
    const loadTui = async () => {
      throw new Error('TUI should not start')
    }
    await expect(runSupervisorTui({ home: '/tmp/research' }, {
      stdin: { isTTY: true } as NodeJS.ReadStream,
      stdout: { isTTY: true } as NodeJS.WriteStream,
      env: {},
      resolveContext: async () => {
        throw Object.assign(
          new Error('Invalid Supervisor configuration'),
          { code: 'ESUPERVISORCONFIG', exitCode: 2 },
        )
      },
      loadTui,
    })).rejects.toMatchObject({
      code: 'ESUPERVISORCONFIG',
      exitCode: 2,
    })

    await expect(runSupervisorTui({ project: 'research' }, {
      stdin: { isTTY: true } as NodeJS.ReadStream,
      stdout: { isTTY: true } as NodeJS.WriteStream,
      resolveContext: async () => {
        throw Object.assign(
          new Error('Supervisor configuration schemaVersion 3 is newer than this OpenAlice (supports 2).'),
          { code: 'ESUPERVISORSCHEMA', exitCode: 2 },
        )
      },
      loadTui,
    })).rejects.toMatchObject({
      code: 'ESUPERVISORSCHEMA',
      exitCode: 2,
    })
  })

  it('installs an available update from the TUI after confirmation', async () => {
    const calls: string[] = []
    let inputListener: ((data: string) => unknown) | undefined
    class FakeSelectList {
      onSelect?: (item: { value: string }) => void
      onCancel?: () => void
      private index = 0

      constructor(private readonly items: Array<{ value: string }>) {}
      setSelectedIndex(index: number): void { this.index = index }
      render(): string[] { return this.items.map((item) => item.value) }
      invalidate(): void {}
      handleInput(data: string): void {
        if (data === 'down') this.index = Math.min(this.items.length - 1, this.index + 1)
        if (data === 'enter') this.onSelect?.(this.items[this.index]!)
        if (data === 'escape') this.onCancel?.()
      }
    }
    class FakeTui {
      addChild(): void {}
      addInputListener(listener: (data: string) => unknown): () => void {
        inputListener = listener
        return () => undefined
      }
      requestRender(): void {}
      setShowHardwareCursor(): void {}
      showOverlay(component: { handleInput?(data: string): void }) {
        return {
          hide: () => undefined,
          focus: () => {
            component.handleInput?.('down')
            component.handleInput?.('enter')
          },
        }
      }
      start(): void {
        queueMicrotask(() => inputListener?.('u'))
      }
      stop(): void {}
    }

    await expect(runSupervisorTui({}, {
      stdin: { isTTY: true } as NodeJS.ReadStream,
      stdout: { isTTY: true } as NodeJS.WriteStream,
      resolveContext: () => resolveLaunchContext({
        cwd: '/tmp',
        homeDir: '/home/alice',
        env: {
          OPENALICE_MANAGED_RUNTIME_PATH: '/opt/openalice/runtime',
          OPENALICE_MANAGED_RUNTIME_CONTENT_IDENTITY: '1234567890abcdef',
        },
      }),
      inspect: async () => ({ class: 'absent', owner: null, endpoints: {} }),
      start: async () => {
        calls.push('start')
      },
      checkUpdate: async (channel) => {
        calls.push(`check:${channel}`)
        setTimeout(() => inputListener?.('enter'), 0)
        return {
          status: 'available',
          currentVersion: '0.89.4-beta',
          latestVersion: '0.90.2-beta.1',
          channel,
          sourceChannel: 'stable',
          installer: {
            versionedUrl: 'https://download.openalice.ai/OpenAlice-0.90.2-beta.1-install',
            sha256: 'a'.repeat(64),
          },
        }
      },
      applyUpdate: async (result) => {
        calls.push(`apply:${result.channel}:${result.latestVersion}`)
        queueMicrotask(() => inputListener?.('q'))
        return 0
      },
      discoverUpdate: async () => null,
      loadTui: async () => ({
        ProcessTerminal: class {},
        TUI: FakeTui,
        SelectList: FakeSelectList,
        matchesKey,
      }) as never,
      version: '0.89.4-beta',
      channel: 'stable',
    })).resolves.toBe(0)

    expect(calls).toEqual(['check:beta', 'apply:beta:0.90.2-beta.1'])
  })

  it('does not replace a package-manager installation from the TUI', async () => {
    let inputListener: ((data: string) => unknown) | undefined
    const applyUpdate = vi.fn(async () => 0)
    class FakeSelectList {
      onSelect?: (item: { value: string }) => void
      constructor(private readonly items: Array<{ value: string }>) {}
      setSelectedIndex(): void {}
      render(): string[] { return [] }
      invalidate(): void {}
      handleInput(data: string): void {
        if (data === 'enter') this.onSelect?.(this.items[0]!)
      }
    }
    class FakeTui {
      addChild(): void {}
      addInputListener(listener: (data: string) => unknown): () => void { inputListener = listener; return () => undefined }
      requestRender(): void {}
      setShowHardwareCursor(): void {}
      showOverlay(component: { handleInput?(data: string): void }) {
        return { hide: () => undefined, focus: () => component.handleInput?.('enter') }
      }
      start(): void { queueMicrotask(() => inputListener?.('u')) }
      stop(): void {}
    }

    await expect(runSupervisorTui({}, {
      stdin: { isTTY: true } as NodeJS.ReadStream,
      stdout: { isTTY: true } as NodeJS.WriteStream,
      resolveContext: () => resolveLaunchContext({ cwd: '/tmp', homeDir: '/home/alice' }),
      inspect: async () => ({ class: 'absent', owner: null, endpoints: {} }),
      checkUpdate: async (channel) => {
        setTimeout(() => inputListener?.('q'), 0)
        return {
          status: 'available',
          currentVersion: '0.90.1',
          latestVersion: '0.90.2',
          channel,
          sourceChannel: 'stable',
          packageManager: { label: 'Homebrew', update: 'brew upgrade traderalice/tap/openalice' },
          installer: { versionedUrl: 'https://example.test/install', sha256: 'a'.repeat(64) },
        }
      },
      applyUpdate,
      discoverUpdate: async () => null,
      loadTui: async () => ({
        ProcessTerminal: class {},
        TUI: FakeTui,
        SelectList: FakeSelectList,
        matchesKey,
      }) as never,
      channel: 'stable',
    })).resolves.toBe(0)

    expect(applyUpdate).not.toHaveBeenCalled()
  })
})

function fleetMachines(): MachineInventory[] {
  const project = (key: string): MachineInventory['projects'][number] => ({
    key,
    id: `alice-project-${key}`,
    displayName: key === 'default' ? 'Default AliceProject' : 'Research',
    home: `/home/alice/${key}`,
    port: 47_331,
    portAutomatic: true,
    product: 'trader',
    isDefault: true,
    available: true,
    runtime: {
      class: 'running',
      state: 'running',
      ownerSurface: 'cli-server',
      uptimeSeconds: 1,
      webEndpoint: 'http://127.0.0.1:47331',
      components: { alice: 'ready' },
    },
  })
  const machine = (
    key: string,
    displayName: string,
    connection: MachineInventory['connection'],
    projects: MachineInventory['projects'],
  ): MachineInventory => ({
    key,
    displayName,
    registered: true,
    connection,
    sshTarget: key === 'local' ? null : 'cloud.example.com',
    platform: 'linux',
    arch: 'arm64',
    hostname: key,
    cliVersion: '1.0.0',
    defaultProject: projects[0]?.key ?? null,
    projects,
    capabilities: {
      inspect: true,
      lifecycle: true,
      openTunnel: true,
      transferReceive: false,
      credentialReseal: false,
    },
    issue: null,
  })
  return [
    machine('local', 'This computer', 'local', [project('default')]),
    machine('cloud', 'Cloud', 'online', [project('research')]),
  ]
}

function transferPlan(sourceHome: string, destinationHome: string, destinationKey: string) {
  return {
    schemaVersion: 1 as const,
    transferId: 'tui-transfer-test',
    generatedAt: '2026-08-23T00:00:00Z',
    source: { projectId: 'alice-project-default', key: 'default', displayName: 'Default AliceProject', home: sourceHome, product: 'trader' as const },
    destination: { machineKey: 'cloud', projectId: 'alice-project-tui-destination', key: destinationKey, displayName: 'Default AliceProject', home: destinationHome, requiredFreeBytes: 64 * 1024 * 1024 },
    policy: { credentials: 'include' as const, scheduledIssues: 'keep-blocked' as const },
    portable: { entries: [], files: 0, directories: 0, symlinks: 0, bytes: 0 },
    excluded: [],
    credentials: { ai: { count: 0, vendors: [] }, broker: { count: 0, presets: [] }, connector: { count: 0, adapters: [] }, providerKeys: { count: 0, vendors: [] } },
    scheduledIssues: [],
    blockers: [],
    readyToApply: true,
  }
}
