import { describe, expect, it, vi } from 'vitest'

import { resolveLaunchContext } from './launch-context.ts'
import type { MachineFleetEnvelope, MachineInventory } from './machine-inventory.ts'
import {
  createSupervisorFleetState,
  displayWidth,
  selectedFleetProject,
  setFleetFocus,
} from './supervisor-fleet.ts'
import {
  createSupervisorTuiTheme,
  decorateSupervisorActionShelf,
  decorateSupervisorFramedColumns,
  decorateSupervisorFramedHeaders,
  decorateSupervisorFrame,
} from './supervisor-tui-theme.ts'
import {
  anchorSupervisorControlConsole,
  renderSupervisorCommandBar,
  renderSupervisorControlConsole,
  renderSupervisorContextTip,
  renderSupervisorDock,
  renderSupervisorFocusActionBar,
  supervisorCommandTargets,
} from './supervisor-tui-view.ts'
import {
  resolveSupervisorChannel,
  runSupervisorTui,
  type SupervisorAction,
  SupervisorScreen,
} from './supervisor-tui.ts'
import { renderSupervisorConfirmationActionBar } from './supervisor-confirmation.ts'

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
  it('makes the disconnected surface a three-step OpenAlice Launcher', () => {
    const activated: string[] = []
    const originalLocal = fleetMachines()[0]!
    const local = {
      ...originalLocal,
      projects: originalLocal.projects.map((project) => ({
        ...project,
        runtime: {
          ...project.runtime,
          class: 'absent',
          state: 'absent',
          ownerSurface: null,
          webEndpoint: null,
        },
      })),
    }
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'fleet',
      runtime: { class: 'absent', endpoints: {} },
      activeTarget: null,
      fleet: createSupervisorFleetState('2026-09-02T00:00:00Z', [local], 'default'),
    }, {
      motionEnabled: false,
      onActivateFleet: (machine, project) => activated.push(`${machine.key}/${project.key}`),
    })

    const frame = screen.render(140).join('\n')
    expect(frame).toContain('◆ [Connect]·1')
    expect(frame).toContain('OPENALICE LAUNCH · SELECT → START → CONNECT')
    expect(frame).toContain('1 MACHINE ✓ This computer')
    expect(frame).toContain('2 ALICEPROJECT ✓ Default AliceProject')
    expect(frame).toContain('3 RUNTIME ○ READY · ENTER TO START')
    expect(frame).toContain('[ Enter ] Start OpenAlice')
    expect(frame).not.toContain('Inbox')

    expect(screen.handleKey('enter', matchesKey)).toBe(true)
    expect(activated).toEqual(['local/default'])
  })

  it('turns a connected target into a bounded workbench with Inbox attention', () => {
    const toggled: string[] = []
    const runtime = { class: 'running', endpoints: { web: 'http://127.0.0.1:2026' } }
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'inbox',
      runtime,
      activeTarget: {
        kind: 'local',
        machineKey: 'local',
        machineName: 'This computer',
        projectKey: 'default',
        projectName: 'Default AliceProject',
        home: '/tmp/openalice',
        transport: 'loopback',
        endpoint: 'http://127.0.0.1:2026',
        runtime,
      },
      inbox: {
        endpoint: 'http://127.0.0.1:2026/',
        refreshedAt: Date.now(),
        hasMore: false,
        entries: [{ id: 'hello', ts: Date.now(), workspaceId: 'ws', comments: 'Agent report ready.' }],
      },
    }, {
      motionEnabled: false,
      onToggleInboxRead: (entry) => toggled.push(entry.id),
    })

    const frame = screen.render(100).join('\n')
    expect(frame).toContain('● [Inbox]·1')
    expect(frame).toContain('Agent report ready.')
    expect(frame).toContain('[ Enter ] Mark read')
    expect(screen.handleKey('enter', matchesKey)).toBe(true)
    expect(toggled).toEqual(['hello'])
  })

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

    expect(lines[0]).toMatch(/^╭─ /u)
    expect(lines[0]).toContain('OpenAlice Supervisor')
    expect(lines[0]).toContain('v0.87.0-beta · DEV')
    expect(lines[0]).toContain('[ u ]')
    expect(lines[1]).toMatch(/^│ .+ │$/u)
    expect(lines[2]).toMatch(/^╰[─┬]+╯$/u)
    expect(lines[2].match(/┬/gu)).toHaveLength(1)
    expect(lines.slice(0, 3).every((line) => displayWidth(line) === 80)).toBe(true)
    expect(lines.join('\n')).toContain('○ STOPPED')
    expect(lines.join('\n')).toContain('Runtime Signal Deck · OpenAlice')
    expect(lines.join('\n')).toContain('▄▀▄ █   ▀█▀ ▄▀▀ █▀▀')
    expect(lines.join('\n')).toContain('◆ LOCAL CONTROL')
    expect(lines.length).toBeLessThanOrEqual(24)
    expect(lines.join('\n')).toContain('[ Enter ]  Start OpenAlice & open Workspace')
    expect(lines.join('\n')).not.toContain('◆ [ Enter ] Start & open')
    expect(lines.join('\n')).toContain('[ s ] Start quietly')
    expect(lines.join('\n')).toContain('[ c ] Source')
    expect(lines.join('\n')).toContain('[ ? ] More')
    expect(lines.at(-1)).toContain('╰─ [ / ] Commands  ›  [ q ] Detach')
    expect(lines.at(-1)).toContain('[ i ] AliceProject  ›  ○ COLD')
    expect(lines.at(-1)).toMatch(/─╯$/u)

    screen.update({ focusTask: 'setup' })
    const focusLines = screen.render(80)
    expect(focusLines[0]).toContain('◇ BUILD v0.87.0-beta · DEV')
    expect(focusLines[0]).not.toContain('[ u ]')
    expect(screen.handlePointer(pointerClick(70, 1))).toBe(false)
    expect(actions).toEqual([])
    screen.update({ focusTask: undefined })

    const wideLines = screen.render(120)
    expect(wideLines[1]).toHaveLength(120)
    expect(wideLines.join('\n')).not.toContain('OpenAlice · launch system')
    expect(wideLines.join('\n')).toContain('▄▀▄ █   ▀█▀ ▄▀▀ █▀▀')
    expect(wideLines.join('\n')).not.toContain('ALICEPROJECT')
    expect(wideLines.filter((line) => line.includes('○ STOPPED'))).toHaveLength(1)
    expect(wideLines.join('\n')).toContain('OpenAlice is ready to start.')
    expect(wideLines.join('\n')).toContain('prepares anything missing and opens')
    expect(wideLines.join('\n')).toContain('the browser; c chooses a checkout.')
    const wideCockpitHeader = wideLines.find((line) => (
      line.includes('Launchpad · AliceProject') && line.includes('Runtime Telemetry · OpenAlice')
    ))
    expect(wideCockpitHeader).toBeDefined()
    expect(wideLines.find((line) => line.includes('[ Enter ]'))).toContain('Uptime')
    expect(wideLines.join('\n')).toContain('○ COLD')
    expect(wideLines.every((line) => displayWidth(line) <= 120)).toBe(true)

    const foldedLines = screen.render(99)
    expect(foldedLines.findIndex((line) => line.includes('╭ Launchpad · AliceProject')))
      .toBeLessThan(foldedLines.findIndex((line) => line.includes('╭ Runtime Signal Deck')))
    expect(foldedLines.join('\n')).toContain('Runtime Signal Deck · OpenAlice')
    expect(foldedLines.join('\n')).toContain('▄▀▄ █   ▀█▀ ▄▀▀ █▀▀')
    expect(foldedLines.join('\n')).toContain('◆ LOCAL CONTROL')
    expect(foldedLines.every((line) => displayWidth(line) <= 99)).toBe(true)

    const compactLines = screen.render(71)
    expect(compactLines.join('\n')).toContain('╭ Runtime signal')
    expect(compactLines.join('\n')).not.toContain('▄▀▄ █   ▀█▀ ▄▀▀ █▀▀')
    expect(compactLines.every((line) => displayWidth(line) <= 71)).toBe(true)

    const narrowHeader = screen.render(46)[0]!
    expect(narrowHeader).toContain('↗ v0.87.0-beta · DEV')
    expect(displayWidth(narrowHeader)).toBe(46)
    screen.render(80)

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

  it('uses wide surplus height for a bounded, bottom-aligned Overview stage', () => {
    let viewportHeight = 32
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      runtime: {
        class: 'absent',
        home: '/tmp/openalice',
        owner: null,
        endpoints: {},
      },
    }, {
      getViewportHeight: () => viewportHeight,
      motionEnabled: false,
    })

    const tall = screen.render(120).map((line) => line.replace(/\u001b\[[0-9;]*m/gu, ''))
    const cockpitRow = tall.findIndex((line) => (
      line.includes('Launchpad · AliceProject') && line.includes('Runtime Telemetry · OpenAlice')
    ))
    const actionRow = tall.findIndex((line) => line.includes('[ Enter ]'))
    const uptimeRow = tall.findIndex((line) => line.includes('Uptime'))
    const cardBottomRow = tall.findIndex((line, index) => (
      index > cockpitRow && line.startsWith('╰') && line.includes('   ╰')
    ))
    const homeRow = tall.findIndex((line) => line.startsWith('⌂  Home'))
    const tipRow = tall.findIndex((line) => line.startsWith('◇  Tip:'))

    expect(tall).toHaveLength(32)
    expect(cockpitRow).toBe(4)
    expect(actionRow).toBe(18)
    expect(uptimeRow).toBe(actionRow)
    expect(cardBottomRow).toBe(actionRow + 1)
    expect(homeRow).toBe(cardBottomRow + 1)
    expect(tipRow).toBeGreaterThan(homeRow)
    expect(tall.join('\n')).toContain('◇ CONTROL PATH')
    expect(tall.join('\n')).toContain('◆ ALICEPROJECT')
    expect(tall.join('\n')).toContain('◇ WORKSPACE WAITING')
    expect(tall.join('\n')).toContain('◇ COMPONENT TELEMETRY')
    expect(tall.join('\n')).toContain('· AVAILABLE AFTER LAUNCH')
    expect(tall.join('\n')).toContain('Alice · UTA · Connector')
    expect(tall.join('\n')).not.toContain('Alice not reported')
    const quietStageRows = tall.slice(cockpitRow + 1, actionRow).map((line) => (
      /^│\s+│ {3}│\s+│$/u.test(line)
    ))
    expect(quietStageRows.filter(Boolean).length).toBeLessThanOrEqual(3)
    expect(quietStageRows.some((quiet, index) => (
      quiet && quietStageRows[index + 1] && quietStageRows[index + 2]
    ))).toBe(false)
    expect(tall.at(-3)).toContain('CONTROL CONSOLE')
    expect(tall.at(-2)).toContain('[ s ] Start quietly')
    expect(tall.at(-1)).toContain('[ / ] Commands')

    viewportHeight = 48
    const capped = screen.render(120).map((line) => line.replace(/\u001b\[[0-9;]*m/gu, ''))
    expect(capped).toHaveLength(48)
    expect(capped.findIndex((line) => line.includes('[ Enter ]'))).toBe(actionRow)

    const folded = screen.render(99).map((line) => line.replace(/\u001b\[[0-9;]*m/gu, ''))
    expect(folded.findIndex((line) => line.includes('Runtime Signal Deck'))).toBeLessThan(20)
    expect(folded.join('\n')).not.toContain('CONTROL PATH')
    expect(folded.join('\n')).not.toContain(
      `│${' '.repeat(97)}│\n│${' '.repeat(97)}│`,
    )
  })

  it('maps reported component truth into the wide Service Array', () => {
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      runtime: {
        class: 'running',
        owner: null,
        endpoints: { web: 'http://127.0.0.1:47331' },
        components: { alice: 'ready', uta: 'disabled', connector: 'connected' },
      },
    }, {
      getViewportHeight: () => 32,
      motionEnabled: false,
    })

    const wide = screen.render(120).join('\n')
    expect(wide).toContain('↗ WORKSPACE READY')
    expect(wide).toContain('◇ SERVICE ARRAY')
    expect(wide).toContain('◆ Alice ready')
    expect(wide).toContain('× UTA disabled')
    expect(wide).toContain('◆ Connector connected')
    expect(screen.render(99).join('\n')).not.toContain('SERVICE ARRAY')
  })

  it('renders one honest pending cluster for a live Runtime without telemetry', () => {
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      runtime: {
        class: 'running',
        owner: { surface: 'cli-server', pid: 42 },
        endpoints: { web: 'http://127.0.0.1:47331' },
      },
    }, {
      getViewportHeight: () => 32,
      motionEnabled: false,
    })

    const wide = screen.render(120).join('\n')
    expect(wide).toContain('Runtime Telemetry · OpenAlice')
    expect(wide).toContain('Telemetry   Component snapshot pending')
    expect(wide).toContain('Uptime      Live · not reported')
    expect(wide).toContain('◇ COMPONENT TELEMETRY')
    expect(wide).toContain('· SNAPSHOT PENDING')
    expect(wide).toContain('Runtime live · states unavailable')
    expect(wide).not.toContain('Alice not reported')
    expect(wide).not.toContain('Waiting for Runtime')
  })

  it('renders a responsive OMP-style Command Spine without adding a row', () => {
    const full = renderSupervisorDock({
      panel: 'doctor',
      projectName: 'Default AliceProject',
      runtimeState: 'running',
      pulse: true,
    }, 100)
    expect(full).toHaveLength(100)
    expect(full).toContain('[ / ] Commands')
    expect(full).toContain('[ i ] Default AliceProject  ›  ◉ LIVE  ›  ✦ DOCTOR')
    expect(full).toMatch(/^╰─ .* ─╯$/u)
    const themed = decorateSupervisorFrame([
      'header',
      'divider',
      'tabs',
      full,
    ], createSupervisorTuiTheme({ TERM: 'xterm-256color' }), {
      panel: 'doctor',
      runtimeClass: 'running',
    })[3]!
    expect(themed).toContain('\u001b[1;38;2;183;255;248;48;2;10;34;39m[ / ] Commands')
    expect(themed).toContain('\u001b[1;38;2;240;249;255;48;2;10;34;39m[ i ] Default AliceProject')
    expect(themed).toContain('\u001b[1;38;2;145;242;187;48;2;10;34;39m◉ LIVE')
    expect(themed).toContain('\u001b[1;38;2;213;179;255;48;2;10;34;39m✦ DOCTOR')
    expect(themed.replace(/\u001b\[[0-9;]*m/gu, '')).toBe(full)
    expect(decorateSupervisorFrame([
      'header',
      'divider',
      'tabs',
      full,
    ], createSupervisorTuiTheme({ TERM: 'xterm-256color', NO_COLOR: '1' }), {
      panel: 'doctor',
      runtimeClass: 'running',
    })[3]).toBe(full)
    expect(supervisorCommandTargets([full])).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '/', surface: '[ / ] Commands' }),
      expect.objectContaining({ label: 'q', surface: '[ q ] Detach' }),
      expect.objectContaining({
        label: 'i',
        surface: '[ i ] Default AliceProject',
      }),
    ]))

    const missingHome = renderSupervisorDock({
      panel: 'fleet',
      projectName: 'Default AliceProject',
      runtimeState: 'running',
      projectAvailable: false,
    }, 120)
    expect(missingHome).toContain('◆ LIVE · HOME MISSING  ›  ◇ FLEET')
    expect(missingHome).not.toContain('● LIVE')
    const themedMissingHome = decorateSupervisorFrame([
      'header',
      'divider',
      'tabs',
      missingHome,
    ], createSupervisorTuiTheme({ TERM: 'xterm-256color' }), {
      panel: 'fleet',
      runtimeClass: 'running',
    })[3]!
    expect(themedMissingHome).toContain(
      '\u001b[1;38;2;255;214;128;48;2;10;34;39m◆ LIVE · HOME MISSING',
    )
    expect(themedMissingHome.replace(/\u001b\[[0-9;]*m/gu, '')).toBe(missingHome)

    const focus = renderSupervisorDock({
      panel: 'overview',
      focusTask: 'setup',
      projectName: 'Default AliceProject',
      runtimeState: 'absent',
    }, 100)
    expect(focus).toContain('◆ FOCUS WORKSPACE  ›  [ Esc ] Back')
    expect(focus).toContain('⌂ Default AliceProject  ›  ○ COLD  ›  ◆ SETUP')
    expect(focus).not.toContain('[ / ] Commands')
    expect(focus).not.toContain('◆ OVERVIEW')
    expect(supervisorCommandTargets([focus]).map((target) => target.label)).toEqual(['Esc'])

    const transferFocus = renderSupervisorDock({
      panel: 'fleet',
      focusTask: 'transfer',
      projectName: 'Default AliceProject',
      runtimeState: 'absent',
    }, 100)
    expect(transferFocus).toContain('⌂ Default AliceProject  ›  ○ COLD  ›  ◆ TRANSFER')
    expect(transferFocus).not.toContain('◇ FLEET')

    const confirmationFocus = renderSupervisorDock({
      panel: 'overview',
      focusTask: 'confirmation',
      focusLabel: 'Stop Runtime',
      projectName: 'Default AliceProject',
      runtimeState: 'absent',
    }, 100)
    expect(confirmationFocus).toContain('◆ DECISION GATE')
    expect(confirmationFocus).toContain('◆ STOP RUNTIME')
    expect(confirmationFocus).not.toContain('[ Esc ] Cancel')
    expect(confirmationFocus).not.toContain('[ / ] Commands')

    const compact = renderSupervisorDock({
      panel: 'logs',
      projectName: '研究 AliceProject with a very long name',
      runtimeState: 'absent',
    }, 60)
    expect(displayWidth(compact)).toBe(60)
    expect(compact).toContain('○ COLD')
    expect(compact).toContain('≋ LOGS')

    const palette = renderSupervisorDock({
      panel: 'overview',
      projectName: 'Default AliceProject',
      runtimeState: 'absent',
      commandPaletteOpen: true,
    }, 80)
    expect(palette).toContain('[ / ] Close  ›  [ q ] Detach')
    expect(palette).toContain('[ i ] Default AliceProject  ›  ○ COLD')
    expect(palette).not.toContain('◆ OVERVIEW')
    const overview = renderSupervisorDock({
      panel: 'overview',
      projectName: 'Default AliceProject',
      runtimeState: 'absent',
    }, 100)
    const themedOverview = decorateSupervisorFrame([
      'header',
      'divider',
      'tabs',
      overview,
    ], createSupervisorTuiTheme({ TERM: 'xterm-256color' }), {
      panel: 'overview',
      runtimeClass: 'absent',
    })[3]!
    expect(themedOverview).toContain(
      '\u001b[1;38;2;213;179;255;48;2;10;34;39m◆ OVERVIEW',
    )

    const narrow = renderSupervisorDock({
      panel: 'overview',
      projectName: 'Default AliceProject',
      runtimeState: 'absent',
    }, 52)
    expect(narrow).toHaveLength(52)
    expect(narrow).toContain('[ q ] Detach')
    expect(narrow).not.toContain('[ i ]')
    expect(narrow).toMatch(/\[ q \] Detach ─+╯$/u)
    expect(narrow).not.toContain('  ─╯')
    expect(displayWidth(narrow)).toBe(52)
    expect(supervisorCommandTargets([narrow])).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '/', surface: '[ / ] Commands' }),
      expect.objectContaining({ label: 'q', surface: '[ q ] Detach' }),
    ]))
    expect(decorateSupervisorFrame([
      'header',
      'divider',
      'tabs',
      narrow,
    ], createSupervisorTuiTheme({ TERM: 'xterm-256color', NO_COLOR: '1' }), {
      panel: 'overview',
      runtimeClass: 'absent',
    })[3]).toBe(narrow)

    const narrowPalette = renderSupervisorDock({
      panel: 'overview',
      commandPaletteOpen: true,
    }, 46)
    expect(narrowPalette).toMatch(/\[ \/ \] Close  ›  \[ q \] Detach ─+╯$/u)
    expect(narrowPalette).not.toContain('  ─╯')
    expect(displayWidth(narrowPalette)).toBe(46)

    const recovery = renderSupervisorDock({
      panel: 'overview',
      recovery: true,
    }, 80)
    expect(recovery).toContain('! RECOVERY  ›  ◆ OVERVIEW')
  })

  it('anchors the Control Console to the live viewport without clipping content', () => {
    let viewportHeight = 32
    const paletteChanges: boolean[] = []
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      runtime: { class: 'running', endpoints: {} },
    }, {
      getViewportHeight: () => viewportHeight,
      onCommandPaletteChange: (open) => paletteChanges.push(open),
      motionEnabled: false,
    })

    const tall = screen.render(80)
    expect(tall).toHaveLength(32)
    expect(tall.at(-3)).toContain('CONTROL CONSOLE')
    expect(tall.at(-2)).toContain('[ l ] Logs')
    expect(tall.at(-1)).toContain('╰─ [ / ] Commands')
    expect(tall.join('\n')).toContain(
      '◇  Tip: Hover an active signal to preview its consequence before clicking.',
    )
    expect(tall.findIndex((line) => line.includes('Runtime Signal Deck'))).toBeLessThan(20)
    expect(screen.handlePointer(pointerClick(6, 32))).toBe(true)
    expect(paletteChanges).toEqual([true])
    expect(screen.render(80).at(-1)).toContain('[ / ] Close')

    viewportHeight = 24
    const resized = screen.render(80)
    expect(resized).toHaveLength(24)
    expect(resized.at(-3)).toContain('CONTROL CONSOLE')
    expect(resized.at(-2)).toContain('[ l ] Logs')
    expect(resized.at(-1)).toContain('[ / ] Close')
    expect(resized.at(-6)?.trim()).toBe('')
    expect(resized.at(-5)).toContain('◇  Tip: Hover an active signal')
    expect(resized.at(-4)?.trim()).toBe('')
    expect(screen.handlePointer(pointerClick(6, 24))).toBe(true)
    expect(paletteChanges).toEqual([true, false])

    viewportHeight = 10
    const short = screen.render(80)
    expect(short.length).toBeGreaterThan(10)
    expect(short.join('\n')).toContain('Runtime Signal Deck')
    expect(short.join('\n')).not.toContain('◇  Tip:')
    expect(short.at(-1)).toContain('╰─ [ / ] Commands')

    expect(anchorSupervisorControlConsole(
      ['content'],
      ['activity', 'actions', 'spine'],
      7,
      ['tip'],
    )).toEqual(['content', '', 'tip', '', 'activity', 'actions', 'spine'])
  })

  it('renders contextual OMP-style Tips without creating an action target', () => {
    const fleet = renderSupervisorContextTip({ panel: 'fleet' }, 100)
    const logs = renderSupervisorContextTip({ panel: 'logs' }, 100)
    const emptyLogs = renderSupervisorContextTip({ panel: 'logs', itemCount: 0 }, 100)
    const doctor = renderSupervisorContextTip({ panel: 'doctor' }, 100)
    const emptyDoctor = renderSupervisorContextTip({ panel: 'doctor', itemCount: 0 }, 100)
    const help = renderSupervisorContextTip({ panel: 'help' }, 100)
    const stopped = renderSupervisorContextTip({ panel: 'overview', runtimeState: 'absent' }, 100)
    const recovery = renderSupervisorContextTip({ panel: 'overview', recovery: true }, 100)

    expect(fleet).toContain('First click focuses a pane')
    expect(logs).toContain('y copies the focused safe event')
    expect(emptyLogs).toContain('No Runtime events in this lens')
    expect(doctor).toContain('Doctor is read-only')
    expect(emptyDoctor).toContain('No diagnostic checks in this report')
    expect(help).toContain('/ searches every available command')
    expect(stopped).toContain('s starts quietly')
    expect(recovery).toContain('only safe Update and Detach routes')
    expect(supervisorCommandTargets([
      fleet,
      logs,
      emptyLogs,
      doctor,
      emptyDoctor,
      help,
      stopped,
      recovery,
    ])).toEqual([])

    const compact = renderSupervisorContextTip({ panel: 'fleet' }, 46)
    expect(displayWidth(compact)).toBeLessThanOrEqual(46)
    expect(compact).toMatch(/…$/u)
    const themed = decorateSupervisorFrame(
      ['header', 'navigation', 'rail', fleet],
      createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
      { panel: 'fleet' },
    )[3]!
    expect(themed).toContain('\u001b[1;38;2;116;235;226m◇  Tip:')
    expect(themed).toContain('\u001b[38;2;116;132;153m First click focuses a pane')
    expect(themed.replace(/\u001b\[[0-9;]*m/gu, '')).toBe(fleet)
    expect(decorateSupervisorFrame(
      ['header', 'navigation', 'rail', fleet],
      createSupervisorTuiTheme({ TERM: 'xterm-256color', NO_COLOR: '1' }),
      { panel: 'fleet' },
    )[3]).toBe(fleet)
  })

  it('exposes only recovery actions when Logs or Doctor have no objects', () => {
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'logs',
      runtime: { class: 'running', endpoints: {} },
      logs: { entries: [] },
      doctor: { overall: 'unknown', checks: [] },
    }, {
      getViewportHeight: () => 32,
      motionEnabled: false,
    })

    const emptyLogs = screen.render(120)
    expect(emptyLogs.at(-2)).toContain('◆ [ l ] Reload snapshot')
    expect(emptyLogs.at(-2)).toContain('[ f ] Show alerts')
    expect(emptyLogs.at(-2)).toContain('[ ? ] More')
    expect(emptyLogs.at(-2)).not.toContain('[ ↑↓ ] Scroll')
    expect(emptyLogs.at(-2)).not.toContain('[ y ] Copy event')
    expect(emptyLogs.at(-2)).not.toContain('[ End ] Latest')
    expect(emptyLogs.join('\n')).toContain('No Runtime events in this lens')

    screen.update({ logs: { entries: [{ text: 'Runtime ready' }] } })
    expect(screen.render(120).at(-2)).toContain('[ ↑↓ ] Scroll')
    expect(screen.render(120).at(-2)).toContain('[ y ] Copy event')
    expect(screen.render(120).at(-2)).toContain('[ End ] Latest')

    screen.update({ panel: 'doctor' })
    const emptyDoctor = screen.render(120)
    expect(emptyDoctor.at(-2)).toContain('◆ [ d ] Rerun Doctor')
    expect(emptyDoctor.at(-2)).toContain('[ ? ] More')
    expect(emptyDoctor.at(-2)).not.toContain('[ ↑↓ ] Inspect')
    expect(emptyDoctor.at(-2)).not.toContain('[ Home ] First')
    expect(emptyDoctor.at(-2)).not.toContain('[ End ] Last')
    expect(emptyDoctor.join('\n')).toContain('No diagnostic checks in this report')
    expect(emptyDoctor[1]).not.toContain('Doctor✓')

    screen.update({ doctor: null })
    expect(screen.render(120).at(-2)).toContain('◆ [ d ] Run Doctor')

    screen.update({
      doctor: {
        overall: 'pass',
        checks: [{ status: 'pass', summary: 'Runtime reachable' }],
      },
    })
    expect(screen.render(120).at(-2)).toContain('[ ↑↓ ] Inspect')
    expect(screen.render(120).at(-2)).toContain('[ Home ] First')
    expect(screen.render(120).at(-2)).toContain('[ End ] Last')
    expect(screen.render(120)[1]).not.toContain('Doctor')
  })

  it('keeps the narrow Command Spine closed while Commands and Close remain clickable', () => {
    const paletteChanges: boolean[] = []
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'overview',
      runtime: { class: 'absent', endpoints: {} },
    }, {
      onCommandPaletteChange: (open) => paletteChanges.push(open),
      theme: createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
      motionEnabled: false,
    })

    let lines = screen.render(46)
    let spineRow = lines.findIndex((line) => line.includes('[ / ] Commands')) + 1
    expect(spineRow).toBeGreaterThan(0)
    let plainSpine = lines[spineRow - 1]?.replace(/\u001b\[[0-9;]*m/gu, '') ?? ''
    expect(plainSpine).toMatch(/^╰─ \[ \/ \] Commands  ›  \[ q \] Detach ─+╯$/u)
    expect(displayWidth(plainSpine)).toBe(46)
    expect(screen.handlePointer(pointerClick(6, spineRow))).toBe(true)
    expect(paletteChanges).toEqual([true])

    lines = screen.render(46)
    spineRow = lines.findIndex((line) => line.includes('[ / ] Close')) + 1
    plainSpine = lines[spineRow - 1]?.replace(/\u001b\[[0-9;]*m/gu, '') ?? ''
    expect(plainSpine).toMatch(/^╰─ \[ \/ \] Close  ›  \[ q \] Detach ─+╯$/u)
    expect(displayWidth(plainSpine)).toBe(46)
    expect(screen.handleCommandSpinePointer(pointerClick(6, spineRow))).toBe(true)
    expect(paletteChanges).toEqual([true, false])
  })

  it('routes only persistent Command Spine targets while the Command Dock is open', () => {
    const paletteChanges: boolean[] = []
    const actions: SupervisorAction[] = []
    const onProjects = vi.fn()
    const onDetach = vi.fn()
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'overview',
      runtime: { class: 'absent', endpoints: {} },
    }, {
      onAction: (action) => actions.push(action),
      onCommandPaletteChange: (open) => paletteChanges.push(open),
      onProjects,
      onDetach,
      theme: createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
      motionEnabled: false,
    })

    let lines = screen.render(80)
    let spineRow = lines.findIndex((line) => line.includes('[ / ] Commands')) + 1
    expect(screen.handlePointer(pointerClick(6, spineRow))).toBe(true)
    lines = screen.render(80)

    const actionRow = lines.findIndex((line) => line.includes('[ s ] Start quietly')) + 1
    const actionLine = lines[actionRow - 1]?.replace(/\u001b\[[0-9;]*m/gu, '') ?? ''
    const actionCol = actionLine.indexOf('[ s ]') + 3
    expect(actionRow).toBeGreaterThan(0)
    expect(actionCol).toBeGreaterThan(2)
    expect(screen.handleCommandSpinePointer(pointerClick(actionCol, actionRow))).toBe(false)
    expect(actions).toEqual([])
    expect(paletteChanges).toEqual([true])

    const projectRow = lines.findIndex((line) => line.includes('[ i ]')) + 1
    const projectLine = lines[projectRow - 1]?.replace(/\u001b\[[0-9;]*m/gu, '') ?? ''
    const projectCol = projectLine.indexOf('[ i ]') + 3
    expect(projectRow).toBe(lines.length)
    expect(projectCol).toBeGreaterThan(2)
    expect(screen.handleCommandSpinePointer(pointerClick(projectCol, projectRow))).toBe(true)
    expect(paletteChanges).toEqual([true, false])
    expect(onProjects).toHaveBeenCalledTimes(1)

    lines = screen.render(80)
    spineRow = lines.findIndex((line) => line.includes('[ / ] Commands')) + 1
    expect(screen.handlePointer(pointerClick(6, spineRow))).toBe(true)
    lines = screen.render(80)
    const detachRow = lines.findIndex((line) => line.includes('[ q ] Detach')) + 1
    const detachLine = lines[detachRow - 1]?.replace(/\u001b\[[0-9;]*m/gu, '') ?? ''
    const detachCol = detachLine.indexOf('[ q ]') + 3
    expect(detachRow).toBe(lines.length)
    expect(screen.handleCommandSpinePointer(pointerClick(detachCol, detachRow))).toBe(true)
    expect(onDetach).toHaveBeenCalledTimes(1)
  })

  it('turns Overview identity and actionable telemetry into direct pointer hotspots', () => {
    const actions: SupervisorAction[] = []
    let projectOpens = 0
    let sourceOpens = 0
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      runtime: {
        class: 'absent',
        owner: null,
        endpoints: {},
      },
    }, {
      onAction: (action) => actions.push(action),
      onProjects: () => { projectOpens += 1 },
      onConfigureSource: () => { sourceOpens += 1 },
      motionEnabled: false,
    })

    let lines = screen.render(80)
    const projectRow = lines.findIndex((line) => line.includes('⌂ Default AliceProject')) + 1
    const providerRow = lines.findIndex((line) => line.includes('⑂ Provider')) + 1
    expect(projectRow).toBeGreaterThan(0)
    expect(providerRow).toBeGreaterThan(0)
    expect(lines.join('\n')).not.toContain('↗ Web')

    expect(screen.handlePointer({
      button: 35, col: 70, row: projectRow, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
    expect(screen.render(80).join('\n')).toContain('› Default AliceProject')
    expect(screen.render(80).join('\n')).toContain(
      '◇  PREVIEW  Open the AliceProject Switchboard',
    )
    expect(screen.handlePointer(pointerClick(70, projectRow))).toBe(true)
    expect(projectOpens).toBe(1)

    expect(screen.handlePointer({
      button: 35, col: 70, row: providerRow, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
    expect(screen.render(80).join('\n')).toContain('› Provider')
    expect(screen.render(80).join('\n')).toContain(
      '◇  PREVIEW  Choose and validate the source checkout',
    )
    expect(screen.handlePointer(pointerClick(70, providerRow))).toBe(true)
    expect(sourceOpens).toBe(1)
    expect(screen.handlePointer({
      button: 35, col: 40, row: 4, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)

    lines = screen.render(100)
    const wideProviderRow = lines.findIndex((line) => line.includes('⑂ Provider')) + 1
    expect(wideProviderRow).toBeGreaterThan(0)
    expect(screen.handlePointer({
      button: 35, col: 95, row: wideProviderRow, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
    expect(screen.render(100).join('\n')).toContain('› Provider')
    expect(screen.handlePointer(pointerClick(95, wideProviderRow))).toBe(true)
    expect(sourceOpens).toBe(2)

    lines = screen.render(46)
    const narrowProjectRow = lines.findIndex((line) => line.includes('⌂ Default AliceProject')) + 1
    expect(narrowProjectRow).toBeGreaterThan(0)
    expect(lines.every((line) => displayWidth(line) <= 46)).toBe(true)
    expect(screen.handlePointer({
      button: 35, col: 40, row: narrowProjectRow, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
    expect(screen.render(46).join('\n')).toContain('› Default AliceProject')
    expect(screen.handlePointer(pointerClick(40, narrowProjectRow))).toBe(true)
    expect(projectOpens).toBe(2)

    screen.update({
      runtime: {
        class: 'running',
        owner: { surface: 'cli-server', pid: 42 },
        endpoints: { web: 'http://127.0.0.1:47331' },
      },
    })
    lines = screen.render(80)
    const webRow = lines.findIndex((line) => line.includes('↗ Web')) + 1
    expect(webRow).toBeGreaterThan(0)
    expect(lines.join('\n')).not.toContain('⑂ Provider')

    expect(screen.handlePointer({
      button: 35, col: 70, row: webRow, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
    expect(screen.render(80).join('\n')).toContain('› Web')
    expect(screen.render(80).join('\n')).toContain(
      '◇  PREVIEW  Open the verified Web UI for this running Runtime.',
    )
    expect(screen.handlePointer(pointerClick(70, webRow))).toBe(true)
    expect(actions).toEqual(['open'])

    expect(screen.handlePointer({
      button: 35, col: 40, row: 4, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
    expect(screen.render(80).join('\n')).not.toContain('PREVIEW')
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
        action: lines.findIndex((line) => line.includes('[ s ] Start quietly')),
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

  it('opens a selectable bottom command dock without creating a second action path', () => {
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
    expect(screen.render(80).join('\n')).not.toContain('Command Dock')
    let lines = screen.renderCommandPalette(80).lines
    expect(lines.join('\n')).toContain('Command Dock · 1/10 · ABSENT')
    expect(lines).toHaveLength(9)
    expect(lines.join('\n')).toContain('› ◆ Start OpenAlice & open Workspace')
    expect(screen.render(80).join('\n')).toContain('[ / ] Close  ›  [ q ] Detach')
    screen.moveCommandPaletteSelection(1)
    expect(screen.renderCommandPalette(80).lines.join('\n')).toContain('›   Start quietly')

    expect(screen.handleKey('\x15', matchesKey)).toBe(true)
    for (const character of 'setup') {
      expect(screen.handleKey(character, matchesKey)).toBe(true)
    }
    const searched = screen.renderCommandPalette(80).lines.join('\n')
    expect(searched).toContain('⌕  setup▌')
    expect(searched).toContain('Command Dock · 1/1 · MATCH “setup” · ABSENT')
    expect(searched).toContain('›   Setup')
    expect(searched).not.toContain('Runtime logs')
    expect(screen.commandPaletteItemCount()).toBe(1)
    expect(screen.handleKey('enter', matchesKey)).toBe(true)
    expect(settingsOpened).toBe(1)
    expect(paletteChanges).toEqual([true, false])

    screen.handleKey('/', matchesKey)
    for (let index = 0; index < 6; index += 1) {
      expect(screen.handleKey('down', matchesKey)).toBe(true)
    }
    expect(screen.renderCommandPalette(80).lines.join('\n')).toContain('›   Setup')
    expect(screen.handleKey('enter', matchesKey)).toBe(true)
    expect(settingsOpened).toBe(2)

    screen.handleKey('/', matchesKey)
    screen.handleKey('z', matchesKey)
    screen.handleKey('z', matchesKey)
    expect(screen.commandPaletteItemCount()).toBe(0)
    expect(screen.renderCommandPalette(80).lines.join('\n')).toContain('No commands match “zz”')
    expect(screen.handleKey('\x7f', matchesKey)).toBe(true)
    expect(screen.handleKey('\x15', matchesKey)).toBe(true)
    const compactDeck = screen.renderCommandPalette(52).lines
    expect(compactDeck.length).toBeLessThanOrEqual(20)
    expect(compactDeck.every((line) => displayWidth(line) <= 52)).toBe(true)
    expect(compactDeck.join('\n')).not.toContain('Update')
    expect(compactDeck).toHaveLength(9)
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

  it('settles the brand entrance into an overlay-aware ambient prism', () => {
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
    const integratedMarkIntro = screen.render(120).find((line) => (
      line.includes('OpenAlice is ready.')
    ))
    expect(integratedMarkIntro).toContain('\u001b[1;38;2;')
    expect(intro).toContain('\u001b[1;38;2;116;235;226m◆')
    screen.advanceMotion()
    expect(screen.render(80)[0]).not.toBe(intro)
    expect(screen.render(120).find((line) => line.includes('OpenAlice is ready.')))
      .not.toBe(integratedMarkIntro)
    for (let frame = 0; frame < 8; frame += 1) screen.advanceMotion()
    expect(screen.hasActiveMotion()).toBe(true)
    expect(screen.render(80)[0]).toContain('\u001b[1;38;2;116;235;226m◆ OpenAlice Supervisor')
    const settledHeader = screen.render(80)[0]
    const settledMark = screen.render(80).find((line) => line.includes('│ Home'))
    expect(screen.hasActiveMotion(false)).toBe(false)
    for (let frame = 0; frame < 6; frame += 1) {
      expect(screen.advanceMotion(false)).toBe(false)
    }
    expect(screen.render(80)[0]).toBe(settledHeader)
    expect(screen.render(80).find((line) => line.includes('│ Home')))
      .toBe(settledMark)
    for (let frame = 0; frame < 3; frame += 1) screen.advanceMotion()
    expect(screen.render(80)[0]).toBe(settledHeader)
    expect(screen.render(80).find((line) => line.includes('│ Home')))
      .not.toBe(settledMark)

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

    const reduced = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      runtime: { class: 'absent', endpoints: {} },
    }, {
      theme: createSupervisorTuiTheme({ TERM: 'xterm-256color', NO_COLOR: '1' }),
      motionEnabled: false,
    })
    const plainBeacon = reduced.render(120).join('\n')
    expect(plainBeacon).toContain('▄▀▄ █   ▀█▀ ▄▀▀ █▀▀')
    expect(plainBeacon).toContain('Default AliceProject')
    expect(plainBeacon).not.toContain('\u001b[')
    expect(reduced.render(99).join('\n')).toContain('Runtime Signal Deck · OpenAlice')
    expect(reduced.render(99).join('\n')).toContain('▄▀▄ █   ▀█▀ ▄▀▀ █▀▀')
    expect(reduced.render(71).join('\n')).not.toContain('▄▀▄ █   ▀█▀ ▄▀▀ █▀▀')
    expect(reduced.hasActiveMotion()).toBe(false)
  })

  it('owns startup input with a skippable full-viewport Boot Sequence', () => {
    const actions: SupervisorAction[] = []
    const motionDemand = vi.fn()
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      runtime: { class: 'running', endpoints: {} },
    }, {
      onAction: (action) => actions.push(action),
      theme: createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
      motionEnabled: true,
      bootSequence: true,
      getViewportHeight: () => 32,
      onMotionDemandChange: motionDemand,
    })

    expect(screen.bootSequenceActive()).toBe(true)
    const splash = screen.render(120)
    expect(splash).toHaveLength(32)
    expect(splash.join('\n')).toContain('O P E N A L I C E')
    expect(splash.join('\n')).not.toContain('OpenAlice Supervisor')
    expect(screen.handlePointer({
      button: 35,
      col: 60,
      row: 16,
      release: false,
      wheel: null,
      motion: true,
      leftClick: false,
    })).toBe(true)
    expect(screen.bootSequenceActive()).toBe(true)

    expect(screen.handleKey('o', matchesKey)).toBe(true)
    expect(screen.bootSequenceActive()).toBe(false)
    expect(actions).toEqual([])
    expect(screen.render(120).join('\n').replace(/\u001b\[[0-9;]*m/gu, ''))
      .toContain('OpenAlice Supervisor')
    expect(motionDemand).toHaveBeenCalledTimes(1)

    const clicked = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      runtime: { class: 'running', endpoints: {} },
    }, {
      onAction: (action) => actions.push(action),
      theme: createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
      bootSequence: true,
    })
    expect(clicked.handlePointer(pointerClick(40, 12))).toBe(true)
    expect(clicked.bootSequenceActive()).toBe(false)
    expect(actions).toEqual([])

    const automatic = new SupervisorScreen({ version: 'dev', channel: 'dev', runtime: null }, {
      theme: createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
      bootSequence: true,
    })
    for (let frame = 0; frame <= 15; frame += 1) {
      expect(automatic.advanceMotion()).toBe(true)
    }
    expect(automatic.bootSequenceActive()).toBe(false)
    expect(automatic.bootSequenceOwnsInput()).toBe(true)
    expect(automatic.handleKey('o', matchesKey)).toBe(true)
    expect(automatic.advanceMotion()).toBe(false)
    expect(automatic.bootSequenceOwnsInput()).toBe(false)

    const reduced = new SupervisorScreen({ version: 'dev', channel: 'dev', runtime: null }, {
      theme: createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
      motionEnabled: false,
      bootSequence: true,
    })
    expect(reduced.bootSequenceActive()).toBe(false)
    expect(reduced.render(80)[0]).toContain('OpenAlice Supervisor')
  })

  it('slides the Mission Header view beacon while reduced motion lands immediately', () => {
    const animated = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      runtime: { class: 'absent', endpoints: {} },
    }, { motionEnabled: true })
    for (let frame = 0; frame < 9; frame += 1) animated.advanceMotion()
    const overviewColumn = animated.render(80)[2]!.indexOf('┬')
    expect(animated.handleKey(']', matchesKey)).toBe(true)
    expect(animated.snapshot.panel).toBe('inbox')
    expect(animated.hasActiveMotion()).toBe(true)
    expect(animated.render(80)[2]!.indexOf('┬')).toBe(overviewColumn)
    animated.advanceMotion()
    const movingColumn = animated.render(80)[2]!.indexOf('┬')
    expect(movingColumn).toBeGreaterThan(overviewColumn)
    expect(animated.handleKey(']', matchesKey)).toBe(true)
    expect(animated.snapshot.panel).toBe('fleet')
    expect(animated.render(80)[2]!.indexOf('┬')).toBe(movingColumn)
    for (let frame = 0; frame < 4; frame += 1) animated.advanceMotion()
    const fleetColumn = animated.render(80)[2]!.indexOf('┬')
    expect(fleetColumn).toBeGreaterThan(movingColumn)
    expect(animated.hasActiveMotion()).toBe(false)

    const reduced = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      runtime: { class: 'absent', endpoints: {} },
    }, { motionEnabled: false })
    const reducedOverview = reduced.render(80)[2]!.indexOf('┬')
    expect(reduced.handleKey(']', matchesKey)).toBe(true)
    expect(reduced.render(80)[2]!.indexOf('┬')).toBeGreaterThan(reducedOverview)
    expect(reduced.hasActiveMotion()).toBe(false)
  })

  it('accepts Unicode Command Palette queries and edits them by code point', () => {
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      runtime: { class: 'running', endpoints: {} },
    }, { motionEnabled: false })
    expect(screen.handleKey('/', matchesKey)).toBe(true)
    expect(screen.renderCommandPalette(76).lines.join('\n')).toContain('⌕  ▌ Type to filter commands')
    expect(screen.handleKey('日志', matchesKey)).toBe(true)
    expect(screen.renderCommandPalette(76).lines.join('\n')).toContain('MATCH “日志”')
    expect(screen.renderCommandPalette(76).lines.join('\n')).toContain('›   Runtime logs')
    expect(screen.handleKey('\x7f', matchesKey)).toBe(true)
    expect(screen.renderCommandPalette(76).lines.join('\n')).toContain('MATCH “日”')
    expect(screen.handleKey('\x15', matchesKey)).toBe(true)
    expect(screen.renderCommandPalette(76).lines.join('\n')).toContain('⌕  ▌ Type to filter commands')
    expect(screen.handleKey('🧭', matchesKey)).toBe(true)
    expect(screen.renderCommandPalette(76).lines.join('\n')).toContain('MATCH “🧭”')
    expect(screen.handleKey('\x7f', matchesKey)).toBe(true)
    expect(screen.renderCommandPalette(76).lines.join('\n')).toContain('⌕  ▌ Type to filter commands')
    expect(screen.handleEscape()).toBe(true)
    expect(screen.hasActiveMotion()).toBe(false)
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
    expect(output).toContain('[ Enter ]  Open Workspace')
    expect(output).not.toContain('[ Enter ] Open workspace')
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

  it('keeps Transfer out of the action shelf when the local Project home is missing', () => {
    const transfers: string[] = []
    const local = fleetMachines()[0]!
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'development',
      runtime: { class: 'running', endpoints: { web: 'http://127.0.0.1:47331' } },
      context: resolveLaunchContext({
        cwd: '/tmp',
        homeDir: '/home/alice',
        flags: { project: 'default', home: '/home/alice/default' },
      }),
      panel: 'fleet',
      fleet: setFleetFocus(createSupervisorFleetState(
        '2026-08-23T00:00:00Z',
        [{
          ...local,
          projects: [{ ...local.projects[0]!, available: false }],
        }],
        'default',
      ), 'projects'),
    }, {
      onTransferFleet: (project) => transfers.push(project.key),
    })

    const output = screen.render(120).join('\n')
    expect(output).toContain('◆ running · home missing')
    expect(output).toContain('◆ LIVE · HOME MISSING')
    expect(output).toContain('[ Enter ] Use AliceProject')
    expect(output).not.toContain('[ m ] Transfer')
    expect(screen.handleKey('m', matchesKey)).toBe(true)
    expect(transfers).toEqual([])
    expect(screen.snapshot.notice).toBe('Transfer requires an available AliceProject home.')

    expect(screen.handleKey('[', matchesKey)).toBe(true)
    expect(screen.handleKey('[', matchesKey)).toBe(true)
    const overview = screen.render(120).join('\n')
    expect(overview).toContain('◆ RUNNING · HOME MISSING')
    expect(overview).toContain('◆ LIVE RUNTIME · PROJECT HOME MISSING')
    expect(overview).toContain('Runtime is live, but the')
    expect(overview).toContain('AliceProject home is missing. Open')
    expect(overview).toContain('still uses the verified Web route.')
    expect(overview).toContain('◆  HOME MISSING  /home/alice/default')
    expect(overview).not.toContain('● LIVE SESSION · OPEN THE WORKSPACE')
  })

  it('gives wide Fleet real inventory rows from the live viewport budget', () => {
    let viewportHeight = 32
    const inventory = fleetMachines()
    const template = inventory[0]!.projects[0]!
    inventory[0] = {
      ...inventory[0]!,
      projects: Array.from({ length: 6 }, (_, index) => ({
        ...template,
        key: index === 0 ? 'default' : `local-${index + 1}`,
        id: `alice-project-local-${index + 1}`,
        displayName: index === 0 ? 'Default AliceProject' : `Local Project ${index + 1}`,
        home: `/home/alice/local-${index + 1}`,
        isDefault: index === 0,
      })),
    }
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'fleet',
      runtime: { class: 'absent', endpoints: {} },
      fleet: createSupervisorFleetState(
        '2026-08-23T00:00:00Z',
        inventory,
        'default',
      ),
    }, {
      getViewportHeight: () => viewportHeight,
      motionEnabled: false,
    })

    const expanded = screen.render(120).map((line) => line.replace(/\u001b\[[0-9;]*m/gu, ''))
    expect(expanded).toHaveLength(32)
    expect(expanded.join('\n')).toContain('Local Project 6')
    expect(expanded.join('\n')).not.toContain('█')
    expect(expanded.at(-3)).toContain('CONTROL CONSOLE')

    viewportHeight = 20
    const constrained = screen.render(120).map((line) => line.replace(/\u001b\[[0-9;]*m/gu, ''))
    expect(constrained).toHaveLength(20)
    expect(constrained.join('\n')).not.toContain('Local Project 6')
    expect(constrained.join('\n')).toContain('█')
  })

  it('gives wide Logs and Doctor an owned Operational Canvas', () => {
    let viewportHeight = 32
    const logsScreen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'logs',
      runtime: { class: 'running', endpoints: {} },
      logs: {
        entries: Array.from({ length: 20 }, (_, index) => ({ text: `event ${index + 1}` })),
      },
    }, {
      getViewportHeight: () => viewportHeight,
      motionEnabled: false,
    })
    const expandedLogs = logsScreen.render(120).map((line) => line.replace(/\u001b\[[0-9;]*m/gu, ''))
    expect(expandedLogs).toHaveLength(32)
    expect(expandedLogs.join('\n')).toContain('1–20/20 · ALL · LATEST')
    expect(expandedLogs.join('\n')).not.toContain('█')
    expect(expandedLogs.at(-3)).toContain('CONTROL CONSOLE')

    viewportHeight = 20
    const constrainedLogs = logsScreen.render(120).map((line) => line.replace(/\u001b\[[0-9;]*m/gu, ''))
    expect(constrainedLogs).toHaveLength(20)
    expect(constrainedLogs.join('\n')).toContain('11–20/20 · ALL · LATEST')
    expect(constrainedLogs.join('\n')).toContain('█')

    viewportHeight = 32
    const doctorScreen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'doctor',
      runtime: { class: 'running', endpoints: {} },
      doctor: null,
    }, {
      getViewportHeight: () => viewportHeight,
      motionEnabled: false,
    })
    const standbyDoctor = doctorScreen.render(120).map((line) => line.replace(/\u001b\[[0-9;]*m/gu, ''))
    expect(standbyDoctor).toHaveLength(32)
    expect(standbyDoctor[24]).toContain('◆ [ d ] Run Runtime Doctor')
    expect(standbyDoctor[25]).toContain('╰')
    expect(standbyDoctor.at(-3)).toContain('CONTROL CONSOLE')
  })

  it('scrubs Logs, Doctor, and Fleet rails without activating operations', () => {
    const actions: SupervisorAction[] = []
    const activated: string[] = []
    const logsScreen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'logs',
      runtime: { class: 'running', endpoints: {} },
      logs: {
        entries: Array.from({ length: 20 }, (_, index) => ({ text: `event ${index + 1}` })),
      },
    }, {
      onAction: (action) => actions.push(action),
      motionEnabled: false,
    })
    logsScreen.render(80)
    expect(logsScreen.handlePointer({
      button: 35, col: 78, row: 6, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
    expect(logsScreen.render(80).join('\n')).toContain('Runtime event 1/20')
    expect(logsScreen.handlePointer({
      button: 0, col: 78, row: 6, release: false, wheel: null, motion: false, leftClick: true,
    })).toBe(true)
    expect(logsScreen.render(80).join('\n')).toContain('Event Lens · LINE 1')
    expect(logsScreen.handlePointer({
      button: 32,
      col: 78,
      row: 12,
      release: false,
      wheel: null,
      motion: true,
      leftClick: false,
      leftDrag: true,
    })).toBe(true)
    expect(logsScreen.render(80).join('\n')).toContain('Event Lens · LINE 20')
    expect(logsScreen.handlePointer({
      button: 0, col: 78, row: 12, release: true, wheel: null, motion: false, leftClick: false,
    })).toBe(true)

    const checks = Array.from({ length: 12 }, (_, index) => ({
      status: 'pass',
      summary: `Check ${index + 1}`,
      detail: 'Verified.',
    }))
    const doctorScreen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'doctor',
      runtime: { class: 'running', endpoints: {} },
      doctor: { overall: 'pass', checks },
    }, { motionEnabled: false })
    doctorScreen.render(80)
    expect(doctorScreen.handlePointer({
      button: 0, col: 78, row: 10, release: false, wheel: null, motion: false, leftClick: true,
    })).toBe(true)
    expect(doctorScreen.render(80).join('\n')).toContain('Inspection · 12/12')
    expect(doctorScreen.handlePointer({
      button: 32,
      col: 78,
      row: 6,
      release: false,
      wheel: null,
      motion: true,
      leftClick: false,
      leftDrag: true,
    })).toBe(true)
    expect(doctorScreen.render(80).join('\n')).toContain('Inspection · 1/12')
    doctorScreen.handlePointer({
      button: 0, col: 78, row: 6, release: true, wheel: null, motion: false, leftClick: false,
    })

    const seedMachines = fleetMachines()
    const machineTemplate = seedMachines[0]!
    const projectTemplate = machineTemplate.projects[0]!
    const inventory = Array.from({ length: 7 }, (_, machineIndex) => ({
      ...machineTemplate,
      key: machineIndex === 0 ? 'local' : `machine-${machineIndex + 1}`,
      displayName: `Machine ${machineIndex + 1}`,
      projects: Array.from({ length: 8 }, (_, projectIndex) => ({
        ...projectTemplate,
        key: `project-${projectIndex + 1}`,
        id: `alice-project-${machineIndex + 1}-${projectIndex + 1}`,
        displayName: `Project ${projectIndex + 1}`,
        home: `/fixture/${machineIndex + 1}/${projectIndex + 1}`,
        isDefault: projectIndex === 0,
      })),
    }))
    const fleetScreen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'fleet',
      runtime: { class: 'running', endpoints: {} },
      fleet: createSupervisorFleetState('2026-09-02T00:00:00Z', inventory, 'project-1'),
    }, {
      onActivateFleet: (machine, project) => activated.push(`${machine.key}/${project.key}`),
      motionEnabled: false,
    })
    fleetScreen.render(100)
    expect(fleetScreen.handlePointer({
      button: 35, col: 98, row: 8, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
    expect(fleetScreen.render(100).join('\n')).toContain('AliceProject 5/8')
    expect(fleetScreen.handlePointer({
      button: 0, col: 98, row: 10, release: false, wheel: null, motion: false, leftClick: true,
    })).toBe(true)
    expect(fleetScreen.render(100).join('\n')).toContain('AliceProjects · Machine 1 · 8/8')
    expect(fleetScreen.handlePointer({
      button: 32,
      col: 98,
      row: 6,
      release: false,
      wheel: null,
      motion: true,
      leftClick: false,
      leftDrag: true,
    })).toBe(true)
    expect(fleetScreen.render(100).join('\n')).toContain('AliceProjects · Machine 1 · 1/8')
    fleetScreen.handlePointer({
      button: 0, col: 98, row: 6, release: true, wheel: null, motion: false, leftClick: false,
    })
    expect(fleetScreen.handlePointer({
      button: 0, col: 34, row: 10, release: false, wheel: null, motion: false, leftClick: true,
    })).toBe(true)
    expect(fleetScreen.render(100).join('\n')).toContain('Machines · 7/7')
    expect(actions).toEqual([])
    expect(activated).toEqual([])
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
    expect(screen.render(100)[2]).toContain('\u001b[1;38;2;116;235;226m┬')
    expect(screen.render(100)[1]!.replace(/\u001b\[[0-9;]*m/gu, '')).toContain('[Connections]·2')
    const releaseColumn = screen.render(100)[0]!
      .replace(/\u001b\[[0-9;]*m/gu, '')
      .indexOf('[ u ]') + 3
    expect(screen.handlePointer({
      button: 35, col: releaseColumn, row: 1, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
    expect(screen.render(100)[0]).toContain('\u001b[1;38;2;203;250;246;48;2;19;49;55m[ u ] vdev · DEV')
    expect(screen.render(100).join('\n')).toContain('◇  PREVIEW  Inspect the dev release lane and available update.')
    expect(screen.handlePointer(pointerClick(releaseColumn, 1))).toBe(true)
    expect(actions).toContain('update')
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
    const logsColumn = screen.render(100)[1]!
      .replace(/\u001b\[[0-9;]*m/gu, '')
      .indexOf('Runtime') + 3
    expect(screen.handlePointer({
      button: 35, col: logsColumn, row: 2, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
    expect(screen.handlePointer({
      button: 0, col: logsColumn, row: 2, release: false, wheel: null, motion: false, leftClick: true,
    })).toBe(true)
    expect(screen.snapshot.panel).toBe('logs')
    expect(actions).toContain('logs')
  })

  it('focuses an inactive Fleet pane before activating its selected row', () => {
    const activated: string[] = []
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'fleet',
      runtime: { class: 'absent', endpoints: {} },
      fleet: createSupervisorFleetState(
        '2026-09-02T00:00:00Z',
        fleetMachines(),
        'default',
      ),
    }, {
      onActivateFleet: (machine, project) => activated.push(`${machine.key}/${project.key}`),
      theme: createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
    })

    screen.render(100)
    expect(screen.snapshot.fleet?.focus).toBe('machines')

    expect(screen.handlePointer(pointerClick(50, 6))).toBe(true)
    expect(screen.snapshot.fleet?.focus).toBe('projects')
    expect(activated).toEqual([])
    expect(screen.render(100).join('\n')).toContain('▶ Default AliceProject')

    expect(screen.handlePointer(pointerClick(8, 6))).toBe(true)
    expect(screen.snapshot.fleet?.focus).toBe('machines')
    expect(activated).toEqual([])
    expect(screen.render(100).join('\n')).toContain('▶ This computer')

    expect(screen.handlePointer(pointerClick(8, 6))).toBe(true)
    expect(screen.snapshot.fleet?.focus).toBe('projects')
    expect(activated).toEqual([])

    expect(screen.handlePointer(pointerClick(50, 6))).toBe(true)
    expect(activated).toEqual(['local/default'])
  })

  it('focuses Fleet panes from headers and unused space without activating rows', () => {
    const activated = vi.fn()
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'fleet',
      runtime: { class: 'absent', endpoints: {} },
      fleet: createSupervisorFleetState(
        '2026-09-02T00:00:00Z',
        fleetMachines(),
        'default',
      ),
    }, {
      onActivateFleet: activated,
      theme: createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
    })

    screen.render(100)
    expect(screen.handlePointer({
      button: 35, col: 50, row: 5, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
    expect(screen.render(100).join('\n').replace(/\u001b\[[0-9;]*m/gu, ''))
      .toContain('╭ » AliceProjects')

    expect(screen.handlePointer(pointerClick(50, 5))).toBe(true)
    expect(screen.snapshot.fleet?.focus).toBe('projects')
    expect(activated).not.toHaveBeenCalled()

    expect(screen.handlePointer(pointerClick(50, 5))).toBe(true)
    expect(screen.snapshot.fleet?.focus).toBe('projects')
    expect(activated).not.toHaveBeenCalled()

    expect(screen.handlePointer(pointerClick(8, 10))).toBe(true)
    expect(screen.snapshot.fleet?.focus).toBe('machines')
    expect(activated).not.toHaveBeenCalled()

    expect(screen.handlePointer(pointerClick(38, 5))).toBe(false)
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
    expect(screen.render(80).join('\n').replace(/\u001b\[[0-9;]*m/gu, ''))
      .toContain('◇  PREVIEW  Review AliceProject and Machine defaults in Setup Studio.')
    expect(screen.handlePointer({
      button: 35, col: 40, row: row - 1, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
    expect(screen.render(80).join('\n')).not.toContain('PREVIEW')
    expect(screen.handlePointer({
      button: 35, col, row, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
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
    screen.handleKey('x', matchesKey)
    const decisionFrame = screen.render(80)
    const plainDecisionFrame = decisionFrame.join('\n').replace(/\u001b\[[0-9;]*m/gu, '')
    expect(plainDecisionFrame).toContain('◆ FOCUS · STOP RUNTIME')
    expect(plainDecisionFrame).toContain('DECISION GATE')
    expect(plainDecisionFrame).toContain('[ Esc ] Keep running')
    expect(plainDecisionFrame).toContain('◇ BUILD vdev · DEV')
    expect(plainDecisionFrame).toContain('◆ [ Enter ] Stop Runtime')
    expect(plainDecisionFrame).toContain('[ Esc ] Keep running')
    expect(plainDecisionFrame).not.toContain('Launchpad')
    expect(plainDecisionFrame).not.toContain('[ / ] Commands')
    expect(plainDecisionFrame).not.toContain('[ p ] Setup')
    expect(plainDecisionFrame).not.toContain('Confirm Stop')
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

  it('gives each Focus Workspace an honest task-owned Action Shelf', () => {
    expect(renderSupervisorFocusActionBar('setup', 96)[0]).toContain(
      '◆ [ Enter ] Edit / apply  │  [ ↑↓ ] Move field  │  [ Esc ] Step back',
    )
    expect(renderSupervisorFocusActionBar('source', 96)[0]).toContain(
      '◆ [ Enter ] Validate / continue  │  [ ↑↓ ] Move cursor',
    )
    expect(renderSupervisorFocusActionBar('projects', 96)[0]).toContain(
      '◆ [ Enter ] Choose  │  [ ↑↓ ] Move project',
    )
    expect(renderSupervisorFocusActionBar('release', 96)[0]).toContain(
      '◆ [ Enter ] Inspect / continue  │  [ ↑↓ ] Move channel',
    )
    expect(renderSupervisorFocusActionBar('transfer', 96)[0]).toContain(
      '◆ [ Enter ] Continue  │  [ ↑↓ ] Move choice',
    )
    expect(renderSupervisorConfirmationActionBar({
      confirmLabel: 'Stop Runtime',
      cancelLabel: 'Keep running',
    }, 96)[0]).toContain(
      '◆ [ Enter ] Stop Runtime  │  [ Esc ] Keep running',
    )
  })

  it('frames feedback, actions, and Command Spine as one same-height Control Console', () => {
    const actionLines = renderSupervisorCommandBar([
      { key: 's', label: 'Start quietly' },
      { key: 'p', label: 'Setup' },
    ], 76)
    const dock = renderSupervisorDock({
      panel: 'overview',
      projectName: 'Default AliceProject',
      runtimeState: 'absent',
    }, 80)
    const idle = renderSupervisorControlConsole(' '.repeat(80), actionLines, dock, 80)

    expect(idle).toHaveLength(3)
    expect(idle.every((line) => displayWidth(line) === 80)).toBe(true)
    expect(idle[0]).toMatch(/^╭─ ◇  CONTROL CONSOLE ─+╮$/u)
    expect(idle[1]).toMatch(/^│ · \[ s \] Start quietly  │  \[ p \] Setup +│$/u)
    expect(idle[2]).toBe(dock)
    const targets = supervisorCommandTargets(idle)
    expect(targets.map((target) => target.label)).toEqual(['s', 'p', '/', 'q', 'i'])
    expect(targets.find((target) => target.label === 's')?.startColumn).toBe(3)

    const ready = renderSupervisorControlConsole(
      '✓  READY    Runtime started in the background.',
      actionLines,
      dock,
      80,
    )
    expect(ready[0]).toMatch(/^╭─ ✓  READY +Runtime started in the background\. ─+╮$/u)
    const colorTheme = createSupervisorTuiTheme({ TERM: 'xterm-256color' })
    const decorated = decorateSupervisorFrame(ready, colorTheme, { panel: 'overview' })
    expect(decorated[0]).toContain('\u001b[1;38;2;170;255;207;48;2;13;45;31m')
    expect(decorated.map((line) => line.replace(/\u001b\[[0-9;]*m/gu, ''))).toEqual(ready)
    expect(decorateSupervisorFrame(
      ready,
      createSupervisorTuiTheme({ TERM: 'xterm-256color', NO_COLOR: '1' }),
      { panel: 'overview' },
    )).toEqual(ready)
  })

  it('contains Action Shelf color inside its framed column', () => {
    const line = '│ ◆ [ Enter ]  Start OpenAlice & open Workspace │   │ Uptime      Waiting for Runtime │'
    const colorTheme = createSupervisorTuiTheme({ TERM: 'xterm-256color' })
    const decorated = decorateSupervisorActionShelf(line, colorTheme)
    const rightColumn = decorated.slice(decorated.indexOf('   │ Uptime'))

    expect(decorated).toContain('\u001b[1;38;2;183;255;248;48;2;18;54;59m')
    expect(rightColumn).toBe('   │ Uptime      Waiting for Runtime │')
    expect(decorateSupervisorActionShelf(
      line,
      createSupervisorTuiTheme({ TERM: 'xterm-256color', NO_COLOR: '1' }),
    )).toBe(line)
  })

  it('contains split-pane semantic focus inside each framed column', () => {
    const theme = createSupervisorTuiTheme({ TERM: 'xterm-256color' })
    const selected = '│ › ! Runtime ownership needs review   │   │ Evidence remains neutral           │'
    const hovered = '│ » · 19  Runtime event                  │   │ Raw event remains neutral          │'
    const intent = '│ ◆ LAUNCH READY · LOCAL RUNTIME         │   │ Process                       ○ COLD │'

    for (const [line, escape] of [
      [selected, '\u001b[1;38;2;230;255;252;48;2;24;64;69m'],
      [hovered, '\u001b[38;2;92;220;211m'],
      [intent, '\u001b[38;2;189;229;255;48;2;17;35;52m'],
    ] as const) {
      const decorated = decorateSupervisorFramedColumns(line, theme)
      const [left, right] = decorated.split(/(?<=│) {3}(?=│)/u)
      expect(left).toContain(escape)
      expect(right).not.toContain('\u001b[')
      expect(decorated.replace(/\u001b\[[0-9;]*m/gu, '')).toBe(line)
    }

    expect(decorateSupervisorFramedColumns(
      selected,
      createSupervisorTuiTheme({ TERM: 'xterm-256color', NO_COLOR: '1' }),
    )).toBe(selected)
  })

  it('styles active and contextual Fleet pane headers independently', () => {
    const theme = createSupervisorTuiTheme({ TERM: 'xterm-256color' })
    const line = '╭ ◆ Machines · 1/2 ─────────╮   ╭ ◇ AliceProjects · This Mac · 1/1 ─────╮'
    const decorated = decorateSupervisorFramedHeaders(line, theme)

    expect(decorated).toContain('\u001b[1;38;2;116;235;226m╭ ◆ Machines')
    expect(decorated).toContain('\u001b[38;2;116;132;153m╭ ◇ AliceProjects')
    expect(decorated.replace(/\u001b\[[0-9;]*m/gu, '')).toBe(line)
    expect(decorateSupervisorFramedHeaders(
      line,
      createSupervisorTuiTheme({ TERM: 'xterm-256color', NO_COLOR: '1' }),
    )).toBe(line)
  })

  it('keeps wide Overview, Fleet, Logs, Doctor, and Help focus inside its owning pane', () => {
    const theme = createSupervisorTuiTheme({ TERM: 'xterm-256color' })
    const selectedEscape = '\u001b[1;38;2;230;255;252;48;2;24;64;69m'
    const columnsFor = (line: string) => line.split(/(?<=│) {3}(?=│)/u)
    const plain = (line: string) => line.replace(/\u001b\[[0-9;]*m/gu, '')
    const expectNeutralInspector = (lines: string[], marker: string, escape: string) => {
      const row = lines.find((line) => plain(line).includes(marker))
      expect(row).toBeDefined()
      const [owner, inspector] = columnsFor(row!)
      expect(owner).toContain(escape)
      expect(inspector).not.toContain('\u001b[')
    }

    const overview = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      runtime: { class: 'absent', endpoints: {} },
    }, { theme, motionEnabled: false }).render(100)
    expectNeutralInspector(
      overview,
      '◆ LAUNCH READY · LOCAL RUNTIME',
      '\u001b[38;2;189;229;255;48;2;17;35;52m',
    )

    const fleet = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      runtime: { class: 'absent', endpoints: {} },
      fleet: createSupervisorFleetState('2026-09-02T00:00:00Z', fleetMachines(), 'default'),
    }, { theme, motionEnabled: false }).render(100)
    const fleetRow = fleet.find((line) => plain(line).includes('▶ This computer'))
    expect(fleetRow).toBeDefined()
    const fleetColumns = columnsFor(fleetRow!)
    expect(fleetColumns).toHaveLength(2)
    expect(fleetColumns[0]).toContain(selectedEscape)
    expect(plain(fleetColumns[1]!)).toContain('◁ Default AliceProject')
    expect(fleetColumns[1]).toContain('\u001b[1;38;2;116;235;226m')
    expect(fleetColumns[1]).not.toContain('48;2;24;64;69m')
    expect(fleetRow).toContain('\u001b[0m │   │ ')

    const logs = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'logs',
      runtime: { class: 'running', endpoints: {} },
      logs: { entries: [{ text: 'first' }, { text: 'second' }] },
    }, { theme, motionEnabled: false }).render(100)
    expectNeutralInspector(logs, '› · 2', selectedEscape)

    const doctor = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'doctor',
      runtime: { class: 'running', endpoints: {} },
      doctor: {
        overall: 'warning',
        summary: { passed: 1, warnings: 1, failures: 0 },
        checks: [
          { status: 'warning', summary: 'Runtime ownership needs review', detail: 'Evidence stays readable.' },
          { status: 'pass', summary: 'Runtime reachable' },
        ],
      },
    }, { theme, motionEnabled: false }).render(100)
    expectNeutralInspector(doctor, '› ! Runtime ownership', selectedEscape)

    const help = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'help',
      runtime: { class: 'running', endpoints: {} },
    }, { theme, motionEnabled: false }).render(100)
    expectNeutralInspector(help, '› ◆ Navigation', selectedEscape)
  })

  it('scrolls Logs and Doctor with keyboard and pointer while keeping contextual controls', () => {
    const requestRender = vi.fn()
    const copied: Array<{ number: number; text: string }> = []
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
    }, {
      requestRender,
      onCopyLog: (entry) => {
        copied.push(entry)
        return { emitted: true, truncated: false }
      },
    })

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
    const copyLines = screen.render(80)
    const copyRow = copyLines.findIndex((line) => line.includes('[ y ] Copy event')) + 1
    const copyColumn = copyLines[copyRow - 1]!.indexOf('Copy event') + 2
    expect(screen.handlePointer(pointerClick(copyColumn, copyRow))).toBe(true)
    expect(copied).toEqual([{ number: 19, text: 'log line 19' }])
    expect(screen.snapshot.notice).toBe('Sent Runtime event 19 to the terminal clipboard.')

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
    expect(screen.render(80)[1]).toContain('[Runtime]·2')
    expect(semanticLogs).toContain('! 1  03:04:05Z Runtime probe slowed · scope=guardian waitMs=120')
    expect(semanticLogs).toContain('· 2  plain adapter output')
    expect(semanticLogs).not.toContain('"msg"')
    expect(semanticLogs).toContain('[ f ] Show alerts')
    expect(semanticLogs).toContain('[ y ] Copy event')
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
    expect(screen.render(80)[1]).not.toContain('Doctor')
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
    screen.update({ panel: 'doctor' })
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

  it('routes Signal Scope action segments through the existing Logs keys', () => {
    const onAction = vi.fn()
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'logs',
      runtime: { class: 'absent', endpoints: {} },
      logs: null,
    }, {
      onAction,
      theme: createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
      motionEnabled: false,
    })

    let lines = screen.render(80)
    let actionRow = lines.findIndex((line) => line.includes('[ l ] Load bounded Runtime tail')) + 1
    expect(actionRow).toBeGreaterThan(0)
    expect(screen.handlePointer({
      button: 35, col: 30, row: actionRow, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
    expect(screen.render(80)[actionRow - 1]).toContain('› [ l ] Load bounded Runtime tail')
    expect(screen.handlePointer(pointerClick(30, actionRow))).toBe(true)
    expect(onAction).toHaveBeenCalledWith('logs')

    screen.update({ logs: { entries: [{ text: 'all good' }] } })
    expect(screen.handleKey('f', matchesKey)).toBe(true)
    expect(screen.handleKey('f', matchesKey)).toBe(true)
    lines = screen.render(80)
    actionRow = lines.findIndex((line) => line.includes('[ f ] Change severity lens')) + 1
    expect(actionRow).toBeGreaterThan(0)
    expect(screen.handlePointer(pointerClick(28, actionRow))).toBe(true)
    expect(screen.render(80).join('\n')).toContain('Event Lens · LINE 1 · INFO · TEXT')

    const noColor = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'logs',
      runtime: { class: 'absent', endpoints: {} },
      logs: null,
    }, {
      theme: createSupervisorTuiTheme({ TERM: 'xterm-256color', NO_COLOR: '1' }),
      motionEnabled: false,
    }).render(46)
    expect(noColor.join('\n')).toContain('◇  SIGNAL STANDBY')
    expect(noColor.join('\n')).toContain('◆ [ l ] Load Runtime tail')
    expect(noColor.join('\n')).not.toContain('\u001b[')
  })

  it('routes Diagnostic Radar action segments through the existing Doctor key', () => {
    const onAction = vi.fn()
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'doctor',
      runtime: { class: 'absent', endpoints: {} },
      doctor: null,
    }, {
      onAction,
      theme: createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
      motionEnabled: false,
    })

    let lines = screen.render(80)
    let actionRow = lines.findIndex((line) => line.includes('[ d ] Run Runtime Doctor')) + 1
    expect(actionRow).toBeGreaterThan(0)
    expect(screen.handlePointer({
      button: 35, col: 24, row: actionRow, release: false, wheel: null, motion: true, leftClick: false,
    })).toBe(true)
    expect(screen.render(80)[actionRow - 1]).toContain('› [ d ] Run Runtime Doctor')
    expect(screen.handlePointer(pointerClick(24, actionRow))).toBe(true)
    expect(onAction).toHaveBeenLastCalledWith('doctor')

    screen.update({
      doctor: {
        overall: 'unknown',
        summary: { passed: 0, warnings: 0, failures: 0 },
        checks: [],
      },
    })
    lines = screen.render(80)
    actionRow = lines.findIndex((line) => line.includes('[ d ] Rerun Runtime Doctor')) + 1
    expect(actionRow).toBeGreaterThan(0)
    expect(screen.handlePointer(pointerClick(24, actionRow))).toBe(true)
    expect(onAction).toHaveBeenCalledTimes(2)

    const noColor = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      panel: 'doctor',
      runtime: { class: 'absent', endpoints: {} },
      doctor: null,
    }, {
      theme: createSupervisorTuiTheme({ TERM: 'xterm-256color', NO_COLOR: '1' }),
      motionEnabled: false,
    }).render(46)
    expect(noColor.join('\n')).toContain('◇  DOCTOR STANDBY')
    expect(noColor.join('\n')).toContain('◆ [ d ] Run Doctor')
    expect(noColor.join('\n')).not.toContain('\u001b[')
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

    expect(screen.render(100).join('\n')).toContain('[ Enter ] Start OpenAlice')
    expect(screen.render(50).join('\n')).toContain('[ Enter ] Start OpenAlice')
    expect(screen.handleKey('enter', matchesKey)).toBe(true)
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
    const restartFrame = screen.render(100).join('\n')
    expect(restartFrame).not.toContain('Confirm Restart')
    expect(restartFrame).toContain('FOCUS · RESTART RUNTIME')
    expect(restartFrame).toContain('◆ RESTART RUNTIME')
    expect(restartFrame).toContain('[ Esc ] Keep running')

    expect(screen.handleKey('enter', matchesKey)).toBe(true)
    expect(actions).toEqual(['open', 'restart'])
    expect(screen.snapshot.confirmation).toBeUndefined()
    expect(confirmations).toEqual(['restart', undefined])

    screen.update({ focusTask: 'release', confirmation: 'update' })
    expect(screen.activeFocusTask()).toBe('confirmation')
    const updateFrame = screen.render(100).join('\n')
    expect(updateFrame).toContain('DECISION GATE')
    expect(updateFrame).toContain('FOCUS · INSTALL UPDATE')
    expect(updateFrame).toContain('◆ INSTALL UPDATE')
    expect(updateFrame).toContain('[ Esc ] Not now')
  })

  it('turns the degraded Launchpad promise into the existing Doctor action', () => {
    const actions: SupervisorAction[] = []
    const screen = new SupervisorScreen({
      version: 'dev',
      channel: 'dev',
      runtime: {
        class: 'incompatible',
        owner: null,
        endpoints: {},
      },
    }, {
      onAction: (action) => actions.push(action),
    })

    let lines = screen.render(80)
    expect(lines.join('\n')).toContain('◆ [ Enter ]  Run Runtime Doctor')
    expect(lines.join('\n')).toContain('· [ l ] Logs  │  [ u ] Update  │  [ ? ] More')
    expect(lines.join('\n')).not.toContain('[ d ] Review Doctor')
    const row = lines.findIndex((line) => line.includes('[ Enter ]  Run Runtime Doctor')) + 1
    expect(screen.handlePointer(pointerClick(60, row))).toBe(true)
    expect(actions).toEqual(['doctor'])

    expect(screen.handleKey('enter', matchesKey)).toBe(true)
    expect(actions).toEqual(['doctor', 'doctor'])
    lines = screen.render(80)
    expect(lines.join('\n')).not.toContain('No primary action is available')
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

  it('starts the Runtime from the Launcher and stays in the TUI', async () => {
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
        queueMicrotask(() => inputListener?.('q'))
      },
      open: async () => {
        calls.push('open')
      },
      discoverUpdate: async () => null,
      loadTui: async () => fakePiTui as never,
      version: '0.87.0-beta',
      channel: 'stable',
    })).resolves.toBe(0)

    expect(calls).toEqual(['start'])
  })

  it('aborts TUI-owned remote tunnels when the Supervisor detaches', async () => {
    let inputListener: ((data: string) => unknown) | undefined
    let tunnelAborted = false
    let screen: SupervisorScreen | undefined
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
        onReady({
          localPort: 45454,
          localUrl: 'http://127.0.0.1:45454',
          clientUrl: 'http://127.0.0.1:45454',
        })
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
    expect(screen?.snapshot.activeTarget).toMatchObject({
      kind: 'ssh',
      machineKey: 'cloud',
      projectKey: 'research',
      endpoint: 'http://127.0.0.1:45454',
      transport: 'ssh-forward',
    })
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
            await waitForOverlay('◆ Transfer manifest · READY')
            overlayComponent?.handleInput?.('y')
            await waitForOverlay('synthetic checksum failure')
            overlayComponent?.handleInput?.('r')
            await waitForOverlay('✓ AliceProject arrived · PUBLISHED')
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
            await waitForOverlay('◆ Transfer manifest · READY')
            overlayComponent?.handleInput?.('y')
            await waitForOverlay('◈ Transfer in flight · STREAMING')
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

  it('uses installed provenance to prepare missing source before Launcher Enter starts', async () => {
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
        queueMicrotask(() => inputListener?.('q'))
      },
      open: async () => {
        calls.push('open')
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
    expect(screen.snapshot.panel).toBe('inbox')
    expect(actions).toEqual([])

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

  it('routes pointer selection through the focused update-channel stage', async () => {
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
            component.render(100)
            queueMicrotask(() => {
              inputListener?.('\u001b[<0;20;7M')
              setTimeout(() => inputListener?.('\u001b[<0;65;10M'), 0)
            })
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
