import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPiTui } from '../../../packages/cli/src/pi-tui-loader.ts'
const piTui = await loadPiTui()
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveLaunchContext } from '../../../packages/cli/src/launch-context.ts'
import type { MachineFleetEnvelope } from '../../../packages/cli/src/machine-inventory.ts'
import { createSupervisorFleetState } from '../../../packages/cli/src/supervisor-fleet.ts'
import { runSupervisorTui, SupervisorScreen } from '../../../packages/cli/src/supervisor-tui.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/** Keep real pi-tui framing, key matching, listener consumption and overlay focus. */
async function startTui() {
  const home = await mkdtemp(join(tmpdir(), 'supervisor-input-'))
  let screen: SupervisorScreen | undefined
  let terminal: BufferedTerminal | undefined
  const stopped = vi.fn()
  class BufferedTerminal extends piTui.ProcessTerminal {
    private buffer = new piTui.StdinBuffer({ timeout: 10 })
    constructor() { super(); terminal = this }
    override start(onInput: (data: string) => void): void {
      this.buffer.on('data', onInput)
      this.buffer.on('paste', text => onInput(`\x1b[200~${text}\x1b[201~`))
    }
    feed(data: string): void { this.buffer.process(data) }
    override stop(): void { this.buffer.destroy(); stopped() }
    override write(): void {}
    override hideCursor(): void {}
    override showCursor(): void {}
  }
  class QuietTui extends piTui.TUI {
    override addChild(component: Parameters<InstanceType<typeof piTui.TUI>['addChild']>[0]): void {
      super.addChild(component)
      if (component instanceof SupervisorScreen) screen = component
    }
    override requestRender(): void {}
  }
  const fleet: MachineFleetEnvelope = {
    schemaVersion: 1, generatedAt: '2026-09-30T00:00:00Z',
    machines: [{
      key: 'local', displayName: 'This computer', registered: true, connection: 'local',
      sshTarget: null, platform: 'linux', arch: 'x64', hostname: 'fixture', cliVersion: 'dev',
      defaultProject: 'default', issue: null,
      capabilities: { inspect: true, lifecycle: true, openTunnel: false, transferReceive: true, credentialReseal: true },
      projects: Array.from({ length: 5 }, (_, index) => ({
        key: index === 0 ? 'default' : `project-${index}`, id: `fixture-${index}`,
        displayName: `Project ${index}`, home: join(home, `project-${index}`), product: 'trader',
        port: 47331 + index, portAutomatic: true, isDefault: index === 0, available: true,
        runtime: { class: 'absent', state: 'absent', ownerSurface: null, uptimeSeconds: null, webEndpoint: null, components: {} },
      })),
    }],
  }
  const running = runSupervisorTui({}, {
    env: { NO_COLOR: '1', OPENALICE_TUI_BOOT: '0', OPENALICE_TUI_MOTION: '0' },
    stdin: { isTTY: true } as NodeJS.ReadStream,
    stdout: { isTTY: true, columns: 100, rows: 30, write: () => true } as unknown as NodeJS.WriteStream,
    webRelay: null,
    resolveContext: () => resolveLaunchContext({ cwd: home, homeDir: home, flags: { home, project: 'default' } }),
    inspect: async () => ({ class: 'absent', owner: null, endpoints: {} }),
    seedFleet: async () => fleet,
    inspectFleet: async () => fleet,
    discoverUpdate: async () => null,
    channel: 'dev',
    loadTui: async () => ({ ...piTui, ProcessTerminal: BufferedTerminal, TUI: QuietTui }),
    pollIntervalMs: 60_000,
  })
  cleanups.push(async () => {
    terminal?.feed('\x03')
    await running
    await rm(home, { recursive: true, force: true })
  })
  await vi.waitFor(() => expect(terminal).toBeDefined())
  await vi.waitFor(() => expect(screen).toBeDefined())
  // Use a stable explicit starting state independent of startup preference.
  screen!.update({ panel: 'fleet', activeTarget: null, fleet: createSupervisorFleetState(fleet.generatedAt, fleet.machines, 'default') })
  return { screen: screen!, feed: (data: string) => terminal!.feed(data), stopped }
}

describe('Supervisor terminal protocol input', () => {
  it('moves once on arrow press/release and keeps repeat, including batched and split input', async () => {
    const { screen, feed } = await startTui()
    const index = () => screen.snapshot.fleet!.selectedProjects.local
    feed('\x1b[B\x1b[1;1:3B')
    expect(index()).toBe(1)
    feed('\x1b[1;1:2B')
    expect(index()).toBe(2)
    feed('\x1b[1;1:3B')
    expect(index()).toBe(2)
    feed('\x1b[1;'); feed('1:1A'); feed('\x1b[1;1:'); feed('3A')
    expect(index()).toBe(1)
    feed('\x1bOA') // Legacy application-cursor mode remains supported.
    expect(index()).toBe(0)
    screen.update({ panel: 'overview' })
    for (const code of ['C', 'D']) {
      feed(`\x1b[1;1:1${code}`)
      const panel = screen.snapshot.panel
      feed(`\x1b[1;1:3${code}`)
      expect(screen.snapshot.panel).toBe(panel)
    }
  })

  it('consumes Esc release after closing Commands instead of detaching the next state', async () => {
    const { screen, feed, stopped } = await startTui()
    screen.update({ panel: 'overview' })
    feed('/')
    expect(screen.bootSequenceOwnsInput()).toBe(false)
    expect(screen.render(100).join('\n')).toContain('[ / ] Close')
    feed('\x1b[27;1:1u\x1b[27;1:3u')
    expect(stopped).not.toHaveBeenCalled()
    expect(screen.render(100).join('\n')).toContain('[ / ] Commands')
    feed('\x1b[1;1:1C')
    expect(screen.snapshot.panel).not.toBe('overview')
  })

  it('matches enhanced editing keys in command search', async () => {
    const { screen, feed } = await startTui()
    feed('/')
    const query = () => screen.renderCommandPalette(100).lines.join('\n')
    feed('abc')
    expect(query()).toContain('abc')
    feed('\x1b[127;1:1u\x1b[127;1:3u')
    expect(query()).toContain('⌕  ab▌')
    feed('\x1b[117;5u')
    expect(query()).not.toContain('⌕  ab')
  })

  it('keeps bracketed paste as single-line search text, not shortcuts', async () => {
    const { screen, feed } = await startTui()
    feed('/')
    const query = () => screen.renderCommandPalette(100).lines.join('\n')
    feed('\x1b[200~project\x1b[201~')
    expect(query()).toContain('⌕  project')
    feed('\x15')
    expect(query()).not.toContain('⌕  project')
    feed('\x1b[200~alpha\n\tbeta\x1b[201~')
    expect(query()).toContain('alpha beta')
    feed('\x15')
    feed('\x1b[200~\x1b[1;1:1B\x1b[201~')
    expect(query()).not.toContain('1;1:1B')
    // Pasted slash is search text, not the Commands toggle.
    feed('\x1b[200~/\x1b[201~')
    expect(query()).toContain('/')
  })
})
