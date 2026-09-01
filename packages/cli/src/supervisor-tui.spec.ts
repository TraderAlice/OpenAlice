import { describe, expect, it, vi } from 'vitest'

import { resolveLaunchContext } from './launch-context.ts'
import type { MachineFleetEnvelope, MachineInventory } from './machine-inventory.ts'
import { createSupervisorFleetState, displayWidth, selectedFleetProject } from './supervisor-fleet.ts'
import { createSupervisorTuiTheme } from './supervisor-tui-theme.ts'
import {
  renderSupervisorCommandBar,
  renderSupervisorDock,
  supervisorCommandTargets,
} from './supervisor-tui-view.ts'
import {
  resolveSupervisorChannel,
  runSupervisorTui,
  type SupervisorAction,
  SupervisorScreen,
} from './supervisor-tui.ts'

const matchesKey = (data: string, key: string) => data === key
const pointerClick = (col: number, row: number) => ({
  button: 0,
  col,
  row,
  release: false,
  wheel: null,
  motion: false,
  leftClick: true,
} as const)

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
    const actions: SupervisorAction[] = []
    const screen = new SupervisorScreen({
      version: '0.87.0-beta',
      channel: 'dev',
      runtime: {
        class: 'absent',
        home: '/tmp/openalice',
        owner: null,
        endpoints: {},
      },
    }, { onAction: (action) => actions.push(action) })

    const lines = screen.render(80)

    expect(lines[0]).toContain('OpenAlice Supervisor')
    expect(lines[0]).toContain('v0.87.0-beta · DEV')
    expect(lines.join('\n')).toContain('○ STOPPED')
    expect(lines.join('\n')).toContain('[ Enter ]  Start OpenAlice & open Workspace')
    expect(lines.join('\n')).toContain('◆ [ Enter ] Start & open')
    expect(lines.join('\n')).toContain('[ s ] Start quietly')
    expect(lines.join('\n')).toContain('[ ? ] More')
    expect(lines.at(-1)).toContain('[ / ] Commands   [ q ] Detach')
    expect(lines.at(-1)).toContain('[ i ] AliceProject · ○ COLD · OVERVIEW')

    const wideLines = screen.render(120)
    expect(wideLines[1]).toHaveLength(120)
    expect(wideLines[4]).toContain('AliceProject')
    expect(wideLines[4]).toContain('Runtime signal')
    expect(wideLines.join('\n')).toContain('○ COLD')
    expect(wideLines.every((line) => displayWidth(line) <= 120)).toBe(true)

    const foldedLines = screen.render(99)
    expect(foldedLines.findIndex((line) => line.includes('╭ Launchpad · AliceProject')))
      .toBeLessThan(foldedLines.findIndex((line) => line.includes('╭ Runtime signal')))
    expect(foldedLines.every((line) => displayWidth(line) <= 99)).toBe(true)

    expect(screen.handlePointer({
      button: 35, col: 60, row: 10, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
    expect(screen.render(80).join('\n')).toContain('│ › [ Enter ]  Start OpenAlice & open Workspace')
    expect(screen.handlePointer(pointerClick(60, 10))).toBe(true)
    expect(actions).toEqual(['start-open'])
    expect(screen.handleKey(']', matchesKey)).toBe(true)
    expect(screen.handleKey('[', matchesKey)).toBe(true)
    expect(screen.render(80).join('\n')).toContain('│ ◆ [ Enter ]  Start OpenAlice & open Workspace')

    screen.update({
      update: {
        status: 'available',
        currentVersion: '0.87.0-beta',
        latestVersion: '0.90.0',
        channel: 'dev',
        sourceChannel: 'dev',
      },
    })
    expect(screen.render(120)[0]).toContain('v0.87.0-beta · DEV · update 0.90.0')
  })

  it('renders a responsive persistent context ribbon without adding a row', () => {
    const full = renderSupervisorDock({
      panel: 'doctor',
      projectName: 'Default AliceProject',
      runtimeState: 'running',
      pulse: true,
    }, 100)
    expect(full).toHaveLength(100)
    expect(full).toContain('[ / ] Commands')
    expect(full).toContain('[ i ] Default AliceProject · ◉ LIVE · DOCTOR')

    const compact = renderSupervisorDock({
      panel: 'logs',
      projectName: '研究 AliceProject with a very long name',
      runtimeState: 'absent',
    }, 60)
    expect(displayWidth(compact)).toBe(60)
    expect(compact).toContain('[ i ]')
    expect(compact).toContain('○ COLD')

    const narrow = renderSupervisorDock({
      panel: 'overview',
      projectName: 'Default AliceProject',
      runtimeState: 'absent',
    }, 52)
    expect(narrow).toHaveLength(52)
    expect(narrow).toContain('[ q ] Detach')
    expect(narrow).not.toContain('[ i ]')

    const recovery = renderSupervisorDock({
      panel: 'overview',
      recovery: true,
    }, 80)
    expect(recovery).toContain('RECOVERY · OVERVIEW')
  })

  it('renders semantic activity rails and advances only enabled busy motion', () => {
    const motionDemandChanges = vi.fn()
    const animated = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      runtime: { class: 'absent' },
    }, {
      theme: createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
      motionEnabled: true,
      onMotionDemandChange: motionDemandChanges,
    })
    animated.update({ busy: 'Starting Runtime' })
    expect(motionDemandChanges).toHaveBeenCalledOnce()
    const first = animated.render(80).find((line) => line.includes('WORKING'))
    expect(first).toContain('\u001b[1;38;2;183;255;248;48;2;12;42;45m')
    expect(animated.advanceMotion()).toBe(true)
    const second = animated.render(80).find((line) => line.includes('WORKING'))
    expect(second).not.toBe(first)
    animated.update({ busy: undefined })
    expect(motionDemandChanges).toHaveBeenCalledTimes(2)

    const reduced = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      runtime: { class: 'absent' },
      busy: 'Starting Runtime',
    }, { motionEnabled: false })
    expect(reduced.advanceMotion()).toBe(false)
    expect(reduced.hasActiveMotion()).toBe(false)
    expect(reduced.render(80).join('\n')).toContain('◆  WORKING  Starting Runtime…')

    const stable = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      runtime: { class: 'absent' },
    }, { motionEnabled: false })
    const controlRows = () => {
      const lines = stable.render(80)
      return {
        height: lines.length,
        action: lines.findIndex((line) => line.includes('[ Enter ] Start & open')),
        ribbon: lines.findIndex((line) => line.includes('[ / ] Commands')),
      }
    }
    const idleRows = controlRows()
    stable.update({ notice: 'Runtime started.', diagnostic: undefined, busy: undefined })
    expect(controlRows()).toEqual(idleRows)
    stable.update({
      busy: 'Refreshing Runtime',
      notice: 'Runtime started.',
      diagnostic: 'Previous probe failed.',
    })
    expect(controlRows()).toEqual(idleRows)
    expect(stable.render(80).join('\n')).toContain('◆  WORKING  Refreshing Runtime…')
  })

  it('opens a selectable command palette without creating a second action path', () => {
    let settingsOpened = 0
    let projectsOpened = 0
    let detached = 0
    const paletteChanges: boolean[] = []
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      runtime: { class: 'absent', endpoints: {} },
    }, {
      onSettings: () => { settingsOpened += 1 },
      onProjects: () => { projectsOpened += 1 },
      onDetach: () => { detached += 1 },
      onCommandPaletteChange: (open) => paletteChanges.push(open),
    })

    expect(screen.handleKey('/', matchesKey)).toBe(true)
    expect(paletteChanges).toEqual([true])
    expect(screen.render(80).join('\n')).not.toContain('Command Palette')
    let lines = screen.renderCommandPalette(80).lines
    expect(lines.join('\n')).toContain('Command Palette · 1/9 · ABSENT')
    expect(lines.join('\n')).toContain('› ◆ Start OpenAlice & open Workspace')
    expect(screen.render(80).join('\n')).toContain('[ / ] Close palette')
    screen.moveCommandPaletteSelection(1)
    expect(screen.renderCommandPalette(80).lines.join('\n')).toContain('›   Start quietly')

    screen.selectCommandPaletteItem(5)
    expect(screen.renderCommandPalette(80).lines.join('\n')).toContain('›   Setup')
    expect(screen.activateCommandPaletteItem()).toBe(true)
    expect(settingsOpened).toBe(1)
    expect(paletteChanges).toEqual([true, false])

    screen.handleKey('/', matchesKey)
    for (let index = 0; index < 5; index += 1) {
      expect(screen.handleKey('down', matchesKey)).toBe(true)
    }
    expect(screen.renderCommandPalette(80).lines.join('\n')).toContain('›   Setup')
    expect(screen.handleKey('enter', matchesKey)).toBe(true)
    expect(settingsOpened).toBe(2)

    screen.handleKey('/', matchesKey)
    const compactDeck = screen.renderCommandPalette(52).lines
    expect(compactDeck.length).toBeLessThanOrEqual(20)
    expect(compactDeck.every((line) => displayWidth(line) <= 52)).toBe(true)
    expect(compactDeck.join('\n')).toContain('Update')
    expect(screen.handleEscape()).toBe(true)
    expect(paletteChanges.at(-1)).toBe(false)

    lines = screen.render(80)
    const projectRow = lines.findIndex((line) => line.includes('[ i ] AliceProject')) + 1
    const projectColumn = lines[projectRow - 1]!.indexOf('[ i ]') + 2
    expect(screen.handlePointer(pointerClick(projectColumn, projectRow))).toBe(true)
    expect(projectsOpened).toBe(1)

    const detachRow = lines.findIndex((line) => line.includes('[ q ] Detach')) + 1
    const detachColumn = lines[detachRow - 1]!.indexOf('[ q ]') + 2
    expect(screen.handlePointer(pointerClick(detachColumn, detachRow))).toBe(true)
    expect(detached).toBe(1)
  })

  it('settles a bounded brand entrance and pulses running state only on refresh', () => {
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      runtime: { class: 'running', endpoints: {} },
    }, {
      theme: createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
      motionEnabled: true,
    })

    expect(screen.hasActiveMotion()).toBe(true)
    const intro = screen.render(80)[0]
    expect(intro).toContain('\u001b[1;38;2;116;235;226m◆')
    screen.advanceMotion()
    expect(screen.render(80)[0]).not.toBe(intro)
    for (let frame = 0; frame < 8; frame += 1) screen.advanceMotion()
    expect(screen.hasActiveMotion()).toBe(false)
    expect(screen.render(80)[0]).toContain('\u001b[1;38;2;116;235;226m◆  OpenAlice Supervisor')

    screen.update({ runtime: { class: 'running', endpoints: {} } })
    expect(screen.render(80).join('\n')).toContain('◉ RUNNING')
    screen.update({ runtime: { class: 'running', endpoints: {} } })
    expect(screen.render(80).join('\n')).toContain('● RUNNING')

    const fleetScreen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'fleet',
      runtime: { class: 'absent', endpoints: {} },
      fleet: createSupervisorFleetState(
        '2026-08-23T00:00:00Z',
        fleetMachines(),
        'default',
      ),
    }, { motionEnabled: true })
    fleetScreen.update({ runtime: { class: 'absent', endpoints: {} } })
    expect(fleetScreen.render(100).join('\n')).toContain('◉ running')
  })

  it('describes an externally owned Runtime without offering refused mutations', () => {
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'overview',
      runtime: {
        class: 'owned_elsewhere',
        owner: { surface: 'dev', pid: 42 },
        endpoints: { web: 'http://127.0.0.1:5173' },
      },
    })

    const output = screen.render(80).join('\n')
    expect(output).toContain('● RUNNING ELSEWHERE')
    expect(output).toContain('[ Enter ] Open workspace')
    expect(output).toContain('[ d ] Doctor')
    expect(output).not.toContain('[ r ] Restart')
    expect(output).not.toContain('[ x ] Stop')
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
    expect(localFleet.match(/\[ m \] Transfer/gu)).toHaveLength(1)
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

  it('styles the application frame and routes pointer tabs and Fleet wheel input', () => {
    const actions: SupervisorAction[] = []
    const activated: string[] = []
    const requestRender = vi.fn()
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      runtime: { class: 'running', endpoints: { web: 'http://127.0.0.1:2024' } },
      fleet: createSupervisorFleetState(
        '2026-08-23T00:00:00Z',
        fleetMachines(),
        'default',
      ),
    }, {
      onAction: (action) => actions.push(action),
      onActivateFleet: (machine, project) => activated.push(`${machine.key}/${project.key}`),
      requestRender,
      theme: createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
    })

    expect(screen.render(100).join('\n')).toContain('\u001b[38;2;')
    expect(screen.render(100)[2]!.replace(/\u001b\[[0-9;]*m/gu, '')).toContain('[Machines]·2')
    expect(screen.snapshot.fleet?.selectedMachine).toBe(0)
    expect(screen.handlePointer({
      button: 65, col: 2, row: 7, release: false, wheel: 1, motion: false, leftClick: false,
    })).toBe(true)
    expect(screen.snapshot.fleet?.selectedMachine).toBe(1)
    expect(screen.handlePointer({
      button: 0, col: 8, row: 6, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
    expect(requestRender).toHaveBeenCalled()
    expect(screen.render(100).join('\n')).toContain('» This computer')
    expect(screen.handlePointer({
      button: 0, col: 8, row: 6, release: false, wheel: null, motion: false, leftClick: true,
    })).toBe(true)
    expect(screen.handlePointer({
      button: 0, col: 8, row: 7, release: false, wheel: null, motion: false, leftClick: true,
    })).toBe(true)
    expect(screen.handlePointer({
      button: 0, col: 50, row: 6, release: false, wheel: null, motion: false, leftClick: true,
    })).toBe(true)
    expect(screen.snapshot.fleet?.focus).toBe('projects')
    expect(screen.snapshot.fleet && selectedFleetProject(screen.snapshot.fleet)?.key).toBe('research')
    expect(screen.handlePointer({
      button: 0, col: 50, row: 6, release: false, wheel: null, motion: false, leftClick: true,
    })).toBe(true)
    expect(activated).toEqual(['cloud/research'])
    const logsColumn = screen.render(100)[2]!
      .replace(/\u001b\[[0-9;]*m/gu, '')
      .indexOf('Logs') + 1
    expect(screen.handlePointer({
      button: 35, col: logsColumn, row: 3, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
    expect(screen.render(100)[2]).toContain('\u001b[1;38;2;203;250;246;48;2;19;49;55m≋ Logs')
    expect(screen.handlePointer({
      button: 0, col: logsColumn, row: 3, release: false, wheel: null, motion: false, leftClick: true,
    })).toBe(true)
    expect(screen.snapshot.panel).toBe('logs')
    expect(actions).toContain('logs')
  })

  it('derives responsive keycap hit regions and clicks visible commands through keyboard semantics', () => {
    expect(supervisorCommandTargets(['界 [ p ] Setup'])).toEqual([{
      row: 1,
      startColumn: 4,
      endColumn: 8,
      label: 'p',
    }])
    expect(supervisorCommandTargets(['◆ [ Enter ] Start  │  [ p ] Setup'])).toEqual([
      {
        row: 1,
        startColumn: 1,
        endColumn: 17,
        label: 'Enter',
        surface: '◆ [ Enter ] Start',
        primary: true,
      },
      {
        row: 1,
        startColumn: 23,
        endColumn: 33,
        label: 'p',
        surface: '[ p ] Setup',
        primary: false,
      },
    ])
    expect(supervisorCommandTargets([
      '│ left pane │   │ ◆ [ Enter ] Edit value  │  [ Esc ] Done │',
    ])).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Enter', surface: '◆ [ Enter ] Edit value', primary: true }),
      expect.objectContaining({ label: 'Esc', surface: '[ Esc ] Done', primary: false }),
    ]))
    const actions: SupervisorAction[] = []
    const settings = vi.fn()
    const detach = vi.fn()
    const requestRender = vi.fn()
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'overview',
      runtime: { class: 'absent', endpoints: {} },
    }, {
      onAction: (action) => actions.push(action),
      onSettings: settings,
      onDetach: detach,
      requestRender,
      theme: createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
    })

    let lines = screen.render(80)
    let plainLines = lines.map((line) => line.replace(/\u001b\[[0-9;]*m/gu, ''))
    let row = plainLines.findIndex((line) => line.includes('[ p ] Setup')) + 1
    let col = plainLines[row - 1]!.indexOf('Setup') + 2
    expect(screen.handlePointer({
      button: 35, col, row, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
    expect(requestRender).toHaveBeenCalled()
    expect(screen.render(80)[row - 1]).toContain('\u001b[1;38;2;230;255;252;48;2;24;64;69m[ p ] Setup')
    expect(screen.render(80)[row - 1]!.replace(/\u001b\[[0-9;]*m/gu, '')).toContain('│ › [ p ] Setup')
    expect(screen.handlePointer({
      button: 0, col, row, release: false, wheel: null, motion: false, leftClick: true,
    })).toBe(true)
    expect(settings).toHaveBeenCalledOnce()

    lines = screen.render(80)
    plainLines = lines.map((line) => line.replace(/\u001b\[[0-9;]*m/gu, ''))
    row = plainLines.findIndex((line) => line.includes('[ Enter ]  Start')) + 1
    col = plainLines[row - 1]!.indexOf('[ Enter ]') + 2
    screen.handlePointer({
      button: 0, col, row, release: false, wheel: null, motion: false, leftClick: true,
    })
    expect(actions).toContain('start-open')

    screen.update({
      runtime: {
        class: 'running',
        owner: { surface: 'cli-server', pid: 42 },
        endpoints: { web: 'http://127.0.0.1:47331' },
      },
    })
    const frameBeforeConfirmation = screen.render(80)
    screen.handleKey('x', matchesKey)
    expect(screen.render(80)).toHaveLength(frameBeforeConfirmation.length)
    expect(screen.render(80).join('\n')).not.toContain('Confirm Stop')
    screen.handleKey('enter', matchesKey)
    expect(actions).toContain('stop')

    screen.update({ panel: 'help' })
    lines = screen.render(80)
    plainLines = lines.map((line) => line.replace(/\u001b\[[0-9;]*m/gu, ''))
    row = plainLines.findIndex((line) => line.includes('[ q ] Detach')) + 1
    col = plainLines[row - 1]!.indexOf('[ q ]') + 2
    screen.handlePointer({
      button: 0, col, row, release: false, wheel: null, motion: false, leftClick: true,
    })
    expect(detach).toHaveBeenCalledOnce()
  })

  it('wraps Action Shelf segments atomically at narrow widths', () => {
    const lines = renderSupervisorCommandBar([
      { key: 'Enter', label: 'Start & open', primary: true },
      { key: 's', label: 'Start quietly' },
      { key: 'p', label: 'Setup' },
      { key: '?', label: 'More' },
    ], 46)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/^◆ \[ Enter \] Start & open/u)
    expect(lines[1]).toMatch(/^· \[ s \] Start quietly  │  \[ p \] Setup/u)
    expect(lines[2]).toMatch(/^· \[ \? \] More/u)
    expect(lines.every((line) => displayWidth(line) === 46)).toBe(true)
    expect(supervisorCommandTargets(lines).map((target) => target.label)).toEqual([
      'Enter', 's', 'p', '?',
    ])
  })

  it('scrolls Logs and Doctor with keyboard and pointer while keeping contextual controls', () => {
    const requestRender = vi.fn()
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'logs',
      runtime: { class: 'running', endpoints: {} },
      logs: {
        entries: Array.from({ length: 20 }, (_, index) => ({ text: `log line ${index + 1}` })),
      },
      doctor: {
        overall: 'warning',
        summary: { passed: 1, warnings: 1, failures: 1 },
        checks: [
          { status: 'pass', summary: 'Runtime reachable' },
          { status: 'warning', summary: 'Update available', detail: 'Install when convenient.' },
          { status: 'fail', summary: 'Port collision' },
        ],
      },
    }, { requestRender })

    expect(screen.render(80).join('\n')).toContain('14–20/20 · ALL · LATEST')
    expect(screen.render(80).join('\n')).toContain('Event Lens · LINE 20 · INFO · TEXT')
    expect(screen.render(80).join('\n')).toContain('[ l ] Reload')
    expect(screen.handleKey('up', matchesKey)).toBe(true)
    expect(screen.render(80).join('\n')).toContain('Event Lens · LINE 19 · INFO · TEXT')
    expect(screen.handleKey('end', matchesKey)).toBe(true)
    expect(screen.render(80).join('\n')).toContain('14–20/20 · ALL · LATEST')
    const logLines = screen.render(80)
    const previousEventRow = logLines.findIndex((line) => line.includes('log line 19')) + 1
    expect(screen.handlePointer({
      button: 32, col: 8, row: previousEventRow, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
    expect(screen.render(80)[previousEventRow - 1]).toContain('» · 19  log line 19')
    expect(screen.handlePointer(pointerClick(8, previousEventRow))).toBe(true)
    expect(screen.render(80).join('\n')).toContain('Event Lens · LINE 19 · INFO · TEXT')

    screen.update({
      panel: 'logs',
      logs: {
        entries: [
          { text: '{"ts":"2026-09-02T03:04:05.123Z","level":"warn","msg":"Runtime probe slowed","scope":"guardian","waitMs":120}' },
          { text: 'plain adapter output' },
        ],
      },
    })
    const semanticLogs = screen.render(80).join('\n')
    expect(screen.render(80)[2]).toContain('[Logs]·2')
    expect(semanticLogs).toContain('! 1  03:04:05Z Runtime probe slowed · scope=guardian waitMs=120')
    expect(semanticLogs).toContain('· 2  plain adapter output')
    expect(semanticLogs).not.toContain('"msg"')
    expect(semanticLogs).toContain('[ f ] Show alerts')
    expect(screen.handleKey('f', matchesKey)).toBe(true)
    const attentionLogs = screen.render(80).join('\n')
    expect(attentionLogs).toContain('ATTENTION · 1/2 · LATEST')
    expect(attentionLogs).toContain('Event Lens · LINE 1 · WARNING · JSON')
    expect(attentionLogs).toContain('! 1  03:04:05Z Runtime probe slowed')
    expect(attentionLogs).not.toContain('plain adapter output')
    expect(attentionLogs).toContain('[ f ] Show errors')
    expect(screen.handleKey('f', matchesKey)).toBe(true)
    expect(screen.render(80).join('\n')).toContain('0/2 · ERRORS')
    expect(screen.handleKey('f', matchesKey)).toBe(true)
    expect(screen.render(80).join('\n')).toContain('· 2  plain adapter output')

    screen.update({ panel: 'doctor' })
    expect(screen.render(80)[2]).toContain('[Doctor]×1')
    expect(screen.render(80).join('\n')).toContain('✓ Runtime reachable')
    expect(screen.render(80).join('\n')).toContain('! Update available')
    expect(screen.render(80).join('\n')).toContain('× Port collision')
    expect(screen.render(80).join('\n')).toContain('Inspection · 3/3 · FAIL')
    expect(screen.render(80).join('\n')).toContain('[ d ] Rerun')
    expect(screen.handleKey('up', matchesKey)).toBe(true)
    expect(screen.render(80).join('\n')).toContain('Inspection · 2/3 · WARNING')
    expect(screen.render(80).join('\n')).toContain('Install when convenient.')
    expect(screen.handleKey('home', matchesKey)).toBe(true)
    expect(screen.render(80).join('\n')).toContain('Inspection · 1/3 · PASS')
    expect(screen.handleKey('end', matchesKey)).toBe(true)
    expect(screen.render(80).join('\n')).toContain('Inspection · 3/3 · FAIL')
    screen.update({ panel: 'overview' })
    const navigation = screen.render(80)[2]!
    const doctorBadgeColumn = navigation.indexOf('×1') + 2
    expect(screen.handlePointer(pointerClick(doctorBadgeColumn, 3))).toBe(true)
    expect(screen.snapshot.panel).toBe('doctor')
    const doctorLines = screen.render(80)
    const reachableRow = doctorLines.findIndex((line) => line.includes('Runtime reachable')) + 1
    expect(screen.handlePointer({
      button: 32, col: 4, row: reachableRow, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
    expect(screen.render(80)[reachableRow - 1]).toContain('» ✓ Runtime reachable')
    expect(screen.handlePointer(pointerClick(4, reachableRow))).toBe(true)
    expect(screen.render(80).join('\n')).toContain('Inspection · 1/3 · PASS')
    expect(screen.handlePointer({
      button: 65, col: 10, row: reachableRow, release: false, wheel: 1, motion: false, leftClick: false,
    })).toBe(true)
    expect(screen.render(80).join('\n')).toContain('Inspection · 2/3 · WARNING')
    expect(requestRender).toHaveBeenCalled()
  })

  it('treats keycap-like log text as an Event Lens row instead of a command', () => {
    const detach = vi.fn()
    const requestRender = vi.fn()
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'logs',
      runtime: { class: 'running', endpoints: {} },
      logs: { entries: [{ text: '[ q ] adapter emitted this text' }] },
    }, { onDetach: detach, requestRender })

    const lines = screen.render(80)
    const row = lines.findIndex((line) => line.includes('[ q ] adapter emitted')) + 1
    const col = lines[row - 1]!.indexOf('[ q ]') + 2
    expect(screen.handlePointer(pointerClick(col, row))).toBe(true)
    expect(detach).not.toHaveBeenCalled()
    expect(requestRender).toHaveBeenCalledOnce()
    expect(screen.render(80).join('\n')).toContain('Event Lens · LINE 1 · INFO · TEXT')
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

    expect(screen.render(100).join('\n')).toContain('[ s ] Start project')
    expect(screen.render(50).join('\n')).toContain('[ s ] Start project')
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

    expect(lines.join('\n')).toContain('◇ UNAVAILABLE')
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
    expect(output).toContain('Provider')
    expect(output).toContain('OpenAlice 0.87.0-beta ·')
    expect(output).toContain('bundle')
    expect(output).toContain('1234567890abcdef')
    expect(output).not.toContain('/opt/openalice/releases/runtime')
  })

  it('dispatches available actions and confirms Runtime mutations', () => {
    const actions: SupervisorAction[] = []
    const confirmations: Array<string | undefined> = []
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
      onConfirmationChange: (action) => confirmations.push(action),
    })

    expect(screen.handleKey('o', matchesKey)).toBe(true)
    expect(actions).toEqual(['open'])

    expect(screen.handleKey('r', matchesKey)).toBe(true)
    expect(screen.snapshot.confirmation).toBe('restart')
    expect(confirmations).toEqual(['restart'])
    expect(screen.render(100).join('\n')).not.toContain('Confirm Restart')

    expect(screen.handleKey('enter', matchesKey)).toBe(true)
    expect(actions).toEqual(['open', 'restart'])
    expect(screen.snapshot.confirmation).toBeUndefined()
    expect(confirmations).toEqual(['restart', undefined])
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
    expect(screen.render(100).join('\n')).toContain('[ Enter ]  Start OpenAlice & open Workspace')

    screen.update({
      runtime: {
        class: 'running',
        owner: { surface: 'cli-server', pid: 42 },
        endpoints: { web: 'http://127.0.0.1:47331' },
      },
    })
    expect(screen.handleKey('enter', matchesKey)).toBe(true)
    expect(actions).toEqual(['start-open', 'open'])
    expect(screen.render(100).join('\n')).toContain('[ Enter ]  Open Workspace')
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
          inputListener?.('tab')
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

  it('preserves remote Fleet focus while the selected local Runtime polls', async () => {
    let inputListener: ((data: string) => unknown) | undefined
    let screen: SupervisorScreen | undefined
    const fleet: MachineFleetEnvelope = {
      schemaVersion: 1,
      generatedAt: '2026-08-23T00:00:00Z',
      machines: fleetMachines(),
    }
    class FakeTui {
      addChild(component: SupervisorScreen): void { screen = component }
      addInputListener(listener: (data: string) => unknown): () => void {
        inputListener = listener
        return () => undefined
      }
      requestRender(): void {}
      setShowHardwareCursor(): void {}
      start(): void {
        queueMicrotask(() => {
          inputListener?.('tab')
          inputListener?.('down')
          inputListener?.('tab')
          setTimeout(() => inputListener?.('q'), 40)
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
      inspectFleet: async () => fleet,
      pollIntervalMs: 5,
      discoverUpdate: async () => null,
      loadTui: async () => ({ ProcessTerminal: class {}, TUI: FakeTui, matchesKey }) as never,
    })).resolves.toBe(0)

    const selectedFleet = screen?.snapshot.fleet
    expect(selectedFleet?.machines[selectedFleet.selectedMachine]?.key).toBe('cloud')
    expect(selectedFleet?.focus).toBe('projects')
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
          inputListener?.('tab')
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
        queueMicrotask(() => {
          inputListener?.('m')
        })
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
      initialPanel: 'fleet',
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
        queueMicrotask(() => {
          inputListener?.('m')
        })
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
      initialPanel: 'fleet',
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
        queueMicrotask(() => {
          inputListener?.('m')
        })
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
      initialPanel: 'fleet',
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
      showOverlay() {
        return { hide: () => undefined, focus: () => undefined }
      }
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
    const confirmations: Array<string | undefined> = []
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
      onConfirmationChange: (action) => confirmations.push(action),
    })

    expect(screen.handleKey('m', matchesKey)).toBe(true)
    expect(screen.snapshot.confirmation).toBe('managed-source')
    expect(confirmations).toEqual(['managed-source'])
    expect(screen.render(100).join('\n')).not.toContain('Confirm Managed Source')

    expect(screen.handleKey('enter', matchesKey)).toBe(true)
    expect(prepareRequests).toBe(1)
    expect(confirmations).toEqual(['managed-source', undefined])
  })

  it('navigates detail panels and requests their read-only data', () => {
    const actions: SupervisorAction[] = []
    let settingsRequests = 0
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'development',
      runtime: { class: 'absent' },
    }, {
      onAction: (action) => actions.push(action),
      onSettings: () => { settingsRequests += 1 },
    })

    expect(screen.handleKey('tab', matchesKey)).toBe(true)
    expect(screen.snapshot.panel).toBe('fleet')
    expect(actions).toEqual([])

    expect(screen.handleKey('tab', matchesKey)).toBe(true)
    expect(screen.snapshot.panel).toBe('logs')
    expect(actions).toEqual(['logs'])

    expect(screen.handleKey('?', matchesKey)).toBe(true)
    expect(screen.snapshot.panel).toBe('help')
    expect(screen.render(100).join('\n')).toContain('Control atlas · 1/3')
    expect(screen.handleKey('down', matchesKey)).toBe(true)
    expect(screen.render(100).join('\n')).toContain('› ● Runtime')
    expect(screen.handlePointer({
      button: 35, col: 8, row: 8, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
    expect(screen.render(100).join('\n')).toContain('» ◇ AliceProject')
    expect(screen.handlePointer(pointerClick(8, 8))).toBe(true)
    expect(screen.render(100).join('\n')).toContain('AliceProject · Shape the workspace')
    expect(screen.handlePointer({
      button: 64, col: 8, row: 8, release: false, wheel: -1, motion: false, leftClick: false,
    })).toBe(true)
    expect(screen.render(100).join('\n')).toContain('Runtime · Operate locally')
    expect(screen.handlePointer(pointerClick(8, 8))).toBe(true)
    const projectHelp = screen.render(100)
    const setupRow = projectHelp.findIndex((line) => line.includes('[ p ]'))
    const setupColumn = projectHelp[setupRow]!.indexOf('[ p ]') + 2
    expect(screen.handlePointer(pointerClick(setupColumn, setupRow + 1))).toBe(true)
    expect(settingsRequests).toBe(1)
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
    expect(output).toContain('[ u ] Update')
    expect(output).toContain('[ ? ] Help')
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
    expect(screen.render(100).join('\n')).toContain('Safe controls · 1/2')
    expect(screen.render(100).join('\n')).not.toContain('i  Select or create')

    expect(screen.handleKey('u', matchesKey)).toBe(true)
    expect(actions).toEqual(['update'])
  })

  it('confirms an available update before dispatching the installer', () => {
    const actions: SupervisorAction[] = []
    const confirmations: Array<string | undefined> = []
    const screen = new SupervisorScreen({
      version: '0.89.4-beta',
      channel: 'stable',
      runtime: { class: 'absent' },
    }, {
      onAction: (action) => actions.push(action),
      onConfirmationChange: (action) => confirmations.push(action),
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
    expect(confirmations).toEqual(['update'])
    expect(screen.render(100).join('\n')).not.toContain('Confirm Update')

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

  it('routes pointer selection through the centered update-channel overlay', async () => {
    let inputListener: ((data: string) => unknown) | undefined
    const checked: string[] = []
    class FakeTui {
      addChild(): void {}
      addInputListener(listener: (data: string) => unknown): () => void {
        inputListener = listener
        return () => undefined
      }
      requestRender(): void {}
      setShowHardwareCursor(): void {}
      showOverlay(component: { render(width: number): string[] }) {
        return {
          hide: () => undefined,
          focus: () => {
            const lines = component.render(72)
            const overlayRow = 1 + Math.floor((28 - lines.length) / 2)
            queueMicrotask(() => inputListener?.(`\u001b[<0;20;${overlayRow + 4}M`))
          },
        }
      }
      start(): void { queueMicrotask(() => inputListener?.('u')) }
      stop(): void {}
    }
    const realTui = await (await import('./pi-tui-loader.ts')).loadPiTui()

    await expect(runSupervisorTui({}, {
      stdin: { isTTY: true } as NodeJS.ReadStream,
      stdout: { isTTY: true, columns: 100, rows: 30 } as NodeJS.WriteStream,
      resolveContext: () => resolveLaunchContext({ cwd: '/tmp', homeDir: '/home/alice' }),
      inspect: async () => ({ class: 'absent', owner: null, endpoints: {} }),
      checkUpdate: async (channel) => {
        checked.push(channel)
        queueMicrotask(() => inputListener?.('q'))
        return { status: 'current', currentVersion: 'dev', channel, sourceChannel: channel }
      },
      discoverUpdate: async () => null,
      loadTui: async () => ({ ...realTui, TUI: FakeTui }) as never,
      channel: 'stable',
    })).resolves.toBe(0)

    expect(checked).toEqual(['dev'])
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
