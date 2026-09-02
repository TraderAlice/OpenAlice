import { describe, expect, it } from 'vitest'

import type { MachineInventory } from './machine-inventory.ts'
import {
  createSupervisorFleetState,
  displayWidth,
  moveFleetSelection,
  renderSupervisorFleet,
  replaceFleetInventory,
  selectFleetIndex,
  selectedFleetProject,
  setFleetFocus,
  supervisorFleetRailTargetAt,
  supervisorFleetTargetAt,
} from './supervisor-fleet.ts'

describe('Supervisor fleet state and presentation', () => {
  it('preserves selection by Machine key across inventory refresh', () => {
    let state = createSupervisorFleetState('2026-08-23T00:00:00Z', machines())
    state = moveFleetSelection(state, 1)
    state = setFleetFocus(state, 'projects')
    state = moveFleetSelection(state, 1)
    expect(selectedFleetProject(state)?.key).toBe('nano')

    state = replaceFleetInventory(state, '2026-08-23T00:01:00Z', [
      machines()[1]!,
      machines()[0]!,
    ])
    expect(selectedFleetProject(state)?.key).toBe('nano')
  })

  it('renders a wide two-pane hierarchy within terminal width', () => {
    const lines = renderSupervisorFleet(
      createSupervisorFleetState('2026-08-23T00:00:00Z', machines()),
      80,
    )
    expect(lines.join('\n')).toContain('Machines')
    expect(lines.join('\n')).toContain('AliceProjects · This Mac')
    expect(lines.join('\n')).toContain('Default AliceProject')
    expect(lines.every((line) => displayWidth(line) <= 80)).toBe(true)
  })

  it('distinguishes active focus from the related inactive selection', () => {
    let state = createSupervisorFleetState('2026-08-23T00:00:00Z', machines())
    const machinesFocused = renderSupervisorFleet(state, 100).join('\n')
    expect(machinesFocused).toContain('╭ ◆ Machines · 1/2')
    expect(machinesFocused).toContain('╭ ◇ AliceProjects · This Mac · 1/1')
    expect(machinesFocused).toContain('│ ▶ This Mac')
    expect(machinesFocused).toContain('│ ◁ Default AliceProject')
    expect(machinesFocused).toContain('╭ Selection ')

    state = setFleetFocus(state, 'projects')
    const projectsFocused = renderSupervisorFleet(state, 100).join('\n')
    expect(projectsFocused).toContain('╭ ◇ Machines · 1/2')
    expect(projectsFocused).toContain('╭ ◆ AliceProjects · This Mac · 1/1')
    expect(projectsFocused).toContain('│ ◁ This Mac')
    expect(projectsFocused).toContain('│ ▶ Default AliceProject')
    expect(projectsFocused).not.toContain('◇ Selection')
  })

  it('uses a narrow drill-down and handles wide Unicode labels', () => {
    let state = createSupervisorFleetState('2026-08-23T00:00:00Z', machines())
    expect(renderSupervisorFleet(state, 40).join('\n')).toContain('◆ Machines · 1/2')
    expect(renderSupervisorFleet(state, 40).join('\n')).toContain('▶ This Mac')
    state = setFleetFocus(state, 'projects')
    const lines = renderSupervisorFleet(state, 40)
    expect(lines.join('\n')).toContain('◆ AliceProjects · This Mac')
    expect(lines.join('\n')).toContain('▶ Default Alice')
    expect(lines.every((line) => displayWidth(line) <= 40)).toBe(true)
  })

  it('shows independent scroll rails for overflowing Machine and AliceProject panes', () => {
    const inventory = Array.from({ length: 7 }, (_, index) => machine(
      `machine-${index}`,
      `Machine ${index + 1}`,
      index === 0 ? 'local' : 'online',
      Array.from({ length: 8 }, (_, projectIndex) => project(
        `project-${projectIndex}`,
        `Project ${projectIndex + 1}`,
      )),
    ))
    let state = createSupervisorFleetState('2026-08-23T00:00:00Z', inventory)
    const top = renderSupervisorFleet(state, 100).join('\n')
    expect(top).toContain('█')
    expect(top).toContain('│')
    expect(supervisorFleetRailTargetAt(state, 100, 34, 2)).toEqual({
      focus: 'machines', index: 0, trackRow: 0,
    })
    expect(supervisorFleetRailTargetAt(state, 100, 98, 6)).toEqual({
      focus: 'projects', index: 7, trackRow: 4,
    })
    expect(supervisorFleetRailTargetAt(state, 100, 50, 6)).toBeUndefined()
    const hoveredRail = renderSupervisorFleet(
      state,
      100,
      undefined,
      false,
      5,
      { focus: 'projects', index: 4, trackRow: 2 },
    ).join('\n')
    expect(hoveredRail).toContain('◆')

    state = selectFleetIndex(state, 'machines', 6)
    state = setFleetFocus(state, 'projects')
    state = selectFleetIndex(state, 'projects', 7)
    const bottom = renderSupervisorFleet(state, 100).join('\n')
    expect(bottom).toContain('Machine 7')
    expect(bottom).toContain('Project 8')
    expect(bottom).toContain('█')
    expect(bottom).toContain('│')
  })

  it('spends a larger viewport window on real Fleet inventory before scrolling', () => {
    const inventory = Array.from({ length: 7 }, (_, index) => machine(
      `machine-${index}`,
      `Machine ${index + 1}`,
      index === 0 ? 'local' : 'online',
      Array.from({ length: 8 }, (_, projectIndex) => project(
        `project-${projectIndex}`,
        `Project ${projectIndex + 1}`,
      )),
    ))
    const state = createSupervisorFleetState('2026-08-23T00:00:00Z', inventory)
    const expanded = renderSupervisorFleet(state, 100, undefined, false, 8)

    expect(expanded).toHaveLength(15)
    expect(expanded.join('\n')).toContain('Machine 7')
    expect(expanded.join('\n')).toContain('Project 8')
    expect(expanded.join('\n')).not.toContain('█')
    expect(supervisorFleetTargetAt(state, 100, 50, 9, 8)).toEqual({
      focus: 'projects',
      index: 7,
    })
    expect(supervisorFleetTargetAt(state, 100, 50, 10, 8)).toBeUndefined()

    const narrow = renderSupervisorFleet(state, 46, undefined, false, 8)
    expect(narrow).toHaveLength(12)
    expect(narrow.join('\n')).not.toContain('Machine 7')
    expect(supervisorFleetTargetAt(state, 46, 8, 7, 8)).toBeUndefined()
  })

  it('turns sparse wide surplus into a passive Selection Constellation', () => {
    const state = createSupervisorFleetState(
      '2026-08-23T00:00:00Z',
      [machines()[0]!],
      'default',
    )
    const expanded = renderSupervisorFleet(state, 120, undefined, false, 15)
    const output = expanded.join('\n')

    expect(expanded).toHaveLength(22)
    expect(output).toContain('Selection Constellation · AliceProject')
    expect(output).toContain('◇ CONTROL ROUTE')
    expect(output).toContain('● This Mac')
    expect(output).toContain('● running Default AliceProject')
    expect(output).toContain('↗ WEB  http://127.0.0.1:47331')
    expect(output).toContain('PRODUCT  TraderAlice')
    expect(output).toContain('PORT  47331 · AUTO')
    expect(output).toContain('OWNER    cli-server')
    expect(output).toContain('UPTIME  12s')
    expect(output).toContain('SERVICES Alice ready')
    expect(output).toContain('CAPS     inspect · lifecycle · tunnel')
    expect(expanded.every((line) => displayWidth(line) <= 120)).toBe(true)
    expect(supervisorFleetTargetAt(state, 120, 40, 14, 15)).toBeUndefined()

    expect(renderSupervisorFleet(state, 120, undefined, false, 11).join('\n'))
      .not.toContain('Selection Constellation')
    expect(renderSupervisorFleet(state, 120, undefined, false, 12).join('\n'))
      .toContain('Selection Constellation')
    expect(renderSupervisorFleet(state, 100, undefined, false, 12).join('\n'))
      .toContain('Selection Constellation')
    expect(renderSupervisorFleet(state, 99, undefined, false, 15).join('\n'))
      .not.toContain('Selection Constellation')
  })

  it('maps pointer rows to visible Machine and AliceProject selections', () => {
    let state = createSupervisorFleetState('2026-08-23T00:00:00Z', machines())
    expect(supervisorFleetTargetAt(state, 80, 4, 3)).toEqual({
      focus: 'machines',
      index: 1,
    })
    state = selectFleetIndex(state, 'machines', 1)
    expect(supervisorFleetTargetAt(state, 80, 40, 2)).toEqual({
      focus: 'projects',
      index: 0,
    })
    state = setFleetFocus(state, 'projects')
    expect(supervisorFleetTargetAt(state, 40, 8, 3)).toEqual({
      focus: 'projects',
      index: 1,
    })
  })

  it('maps pane headers and unused body space to focus-only surfaces', () => {
    let state = createSupervisorFleetState('2026-08-23T00:00:00Z', machines())
    expect(supervisorFleetTargetAt(state, 100, 4, 1)).toEqual({
      focus: 'machines',
      index: 0,
      surface: 'pane',
    })
    expect(supervisorFleetTargetAt(state, 100, 50, 1)).toEqual({
      focus: 'projects',
      index: 0,
      surface: 'pane',
    })
    expect(supervisorFleetTargetAt(state, 100, 38, 1)).toBeUndefined()
    expect(supervisorFleetTargetAt(state, 100, 4, 6)).toEqual({
      focus: 'machines',
      index: 0,
      surface: 'pane',
    })

    state = setFleetFocus(state, 'projects')
    expect(supervisorFleetTargetAt(state, 40, 8, 1)).toEqual({
      focus: 'projects',
      index: 0,
      surface: 'pane',
    })
    expect(supervisorFleetTargetAt(state, 40, 8, 6)).toEqual({
      focus: 'projects',
      index: 0,
      surface: 'pane',
    })

    const hovered = renderSupervisorFleet(
      createSupervisorFleetState('2026-08-23T00:00:00Z', machines()),
      100,
      { focus: 'projects', index: 0, surface: 'pane' },
    ).join('\n')
    expect(hovered).toContain('╭ ◆ Machines')
    expect(hovered).toContain('╭ » AliceProjects')
    expect(hovered).not.toContain('» Default AliceProject')
  })

  it('keeps unauthorized and incompatible Machines as truthful rows', () => {
    const unavailable = ['unauthorized', 'incompatible'].map((connection) => ({
      ...machines()[1]!,
      key: connection,
      displayName: connection,
      connection: connection as MachineInventory['connection'],
      projects: [],
      issue: {
        code: connection === 'unauthorized' ? 'ESSHAUTH' : 'EINCOMPATIBLE',
        message: connection === 'unauthorized'
          ? 'SSH authentication was rejected.'
          : 'Remote CLI is incompatible.',
      },
    }))
    const output = renderSupervisorFleet(
      createSupervisorFleetState('2026-08-23T00:00:00Z', [machines()[0]!, ...unavailable]),
      90,
    ).join('\n')
    expect(output).toContain('unauthorized')
    expect(output).toContain('incompatible')
  })

  it('keeps an active Runtime visible when its AliceProject home is missing', () => {
    const missingHome = {
      ...machines()[0]!,
      projects: [{
        ...machines()[0]!.projects[0]!,
        available: false,
      }],
    }
    const output = renderSupervisorFleet(
      createSupervisorFleetState('2026-08-23T00:00:00Z', [missingHome], 'default'),
      120,
      undefined,
      false,
      15,
    ).join('\n')

    expect(output).toContain('◆ running · home missing')
    expect(output).toContain('↗ WEB  http://127.0.0.1:47331')
    expect(output).not.toContain('◇ missing')
  })
})

function machines(): MachineInventory[] {
  return [
    machine('local', 'This Mac', 'local', [project('default', 'Default AliceProject')]),
    machine('cloud', '云端开发机', 'online', [
      project('research', 'Research'),
      project('nano', 'Nano Lab'),
    ]),
  ]
}

function machine(
  key: string,
  displayName: string,
  connection: MachineInventory['connection'],
  projects: MachineInventory['projects'],
): MachineInventory {
  return {
    key,
    displayName,
    registered: true,
    connection,
    sshTarget: key === 'local' ? null : `${key}.example.com`,
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
  }
}

function project(key: string, displayName: string): MachineInventory['projects'][number] {
  return {
    key,
    id: `alice-project-${key}`,
    displayName,
    home: `/home/alice/${key}`,
    port: 47_331,
    portAutomatic: true,
    product: key === 'nano' ? 'nano' : 'trader',
    isDefault: key === 'default' || key === 'research',
    available: true,
    runtime: {
      class: key === 'nano' ? 'absent' : 'running',
      state: key === 'nano' ? 'absent' : 'running',
      ownerSurface: key === 'nano' ? null : 'cli-server',
      uptimeSeconds: 12,
      webEndpoint: key === 'nano' ? null : 'http://127.0.0.1:47331',
      components: { alice: key === 'nano' ? 'disabled' : 'ready' },
    },
  }
}
