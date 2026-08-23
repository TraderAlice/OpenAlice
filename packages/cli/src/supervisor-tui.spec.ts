import { describe, expect, it } from 'vitest'

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
  it('labels source-run, branch, and version channels from install provenance', async () => {
    await expect(resolveSupervisorChannel({
      resolveLayout: () => null,
    })).resolves.toBe('development')
    await expect(resolveSupervisorChannel({
      resolveLayout: () => ({}),
      readSource: async () => ({
        selector: { kind: 'branch', value: 'dev' },
      }),
    })).resolves.toBe('branch dev')
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

    expect(lines).toContain('OpenAlice  0.87.0-beta  dev')
    expect(lines).toContain('Runtime state: absent')
    expect(lines.join('\n')).toContain('Enter Start & open · s Background · p Setup')
    expect(lines.join('\n')).toContain('i AliceProjects')
    expect(lines).toContain('d Doctor · l Logs · u Update · ? Help')
    expect(lines).toContain('q / Esc / Ctrl+C  Detach without stopping')
  })

  it('renders and navigates the Machine to AliceProject fleet', () => {
    const activated: string[] = []
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
    })

    expect(screen.render(100).join('\n')).toContain('AliceProjects · This computer')
    expect(screen.handleKey('down', matchesKey)).toBe(true)
    expect(screen.handleKey('tab', matchesKey)).toBe(true)
    expect(screen.render(100).join('\n')).toContain('AliceProjects · Cloud')
    expect(screen.handleKey('o', matchesKey)).toBe(true)
    expect(activated).toEqual(['cloud/research'])
    expect(screen.handleKey('r', matchesKey)).toBe(true)
    expect(refreshes).toBe(1)
    expect(screen.handleKey('s', matchesKey)).toBe(true)
    expect(screen.snapshot.notice).toContain('not available for a remote selection')
    expect(screen.handleEscape()).toBe(true)
    expect(screen.snapshot.fleet?.focus).toBe('machines')
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
      },
      confirmation: 'update',
    })
    const confirmation = screen.render(100).join('\n')
    expect(confirmation).toContain('Install OpenAlice 0.90.0 now?')
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
    class FakeTui {
      addChild(): void {}
      addInputListener(listener: (data: string) => unknown): () => void {
        inputListener = listener
        return () => undefined
      }
      requestRender(): void {}
      setShowHardwareCursor(): void {}
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
      checkUpdate: async () => {
        calls.push('check')
        setTimeout(() => inputListener?.('enter'), 0)
        return {
          status: 'available',
          currentVersion: '0.89.4-beta',
          latestVersion: '0.90.0',
          installer: {
            versionedUrl: 'https://download.openalice.ai/OpenAlice-0.90.0-install',
            sha256: 'a'.repeat(64),
          },
        }
      },
      applyUpdate: async (result) => {
        calls.push(`apply:${result.latestVersion}`)
        queueMicrotask(() => inputListener?.('q'))
        return 0
      },
      discoverUpdate: async () => null,
      loadTui: async () => ({
        ProcessTerminal: class {},
        TUI: FakeTui,
        matchesKey,
      }) as never,
      version: '0.89.4-beta',
      channel: 'stable',
    })).resolves.toBe(0)

    expect(calls).toEqual(['check', 'apply:0.90.0'])
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
