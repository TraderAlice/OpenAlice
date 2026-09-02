import { describe, expect, it } from 'vitest'

import {
  createSupervisorDoctorState,
  moveSupervisorDoctorSelection,
  renderSupervisorDoctor,
} from './supervisor-doctor-view.ts'
import { displayWidth } from './supervisor-display.ts'
import { supervisorCommandTargets } from './supervisor-tui-view.ts'

describe('Supervisor Doctor inspector', () => {
  const report = {
    overall: 'failure',
    summary: { passed: 1, warnings: 1, failures: 1 },
    checks: [
      { status: 'pass', summary: 'Runtime reachable', detail: 'Guardian replied.' },
      { status: 'warning', summary: 'Update available', detail: 'Install when convenient.' },
      { status: 'fail', summary: 'Port collision', detail: 'Port 47331 is already occupied.\u001b[31m' },
    ],
  }

  it('focuses the first failure, then the first warning', () => {
    expect(createSupervisorDoctorState(report)).toEqual({ selected: 2, hovered: null })
    expect(createSupervisorDoctorState({
      ...report,
      checks: report.checks.slice(0, 2),
    })).toEqual({ selected: 1, hovered: null })
  })

  it('wraps keyboard selection and clamps wheel selection', () => {
    const state = createSupervisorDoctorState(report)
    expect(moveSupervisorDoctorSelection(state, 1, report)).toEqual({ selected: 0, hovered: null })
    expect(moveSupervisorDoctorSelection(state, 1, report, false)).toEqual({ selected: 2, hovered: null })
  })

  it('composes standby and no-check reports as actionable Diagnostic Radars', () => {
    const standby = renderSupervisorDoctor(null, createSupervisorDoctorState(), 80)
    expect(standby.lines).toHaveLength(7)
    expect(standby.lines.join('\n')).toContain('Diagnostic Radar · STANDBY')
    expect(standby.lines.join('\n')).toContain('◇  DOCTOR STANDBY')
    expect(standby.lines.join('\n')).toContain('MODE       Read-only Runtime diagnostics')
    expect(standby.lines.join('\n')).toContain('WRITES     None · no repair or state mutation')
    expect(supervisorCommandTargets(standby.lines)).toEqual([
      expect.objectContaining({
        label: 'd',
        surface: '◆ [ d ] Run Runtime Doctor',
        primary: true,
      }),
    ])

    const emptyReport = {
      overall: 'unknown',
      summary: { passed: 0, warnings: 0, failures: 0 },
      checks: [],
    }
    const empty = renderSupervisorDoctor(emptyReport, createSupervisorDoctorState(emptyReport), 80)
    expect(empty.lines.join('\n')).toContain('Diagnostic Radar · NO CHECKS · 0F/0W/0P')
    expect(empty.lines.join('\n')).toContain('○  NO CHECKS')
    expect(empty.lines.join('\n')).toContain('REPORT     Loaded · UNKNOWN · 0 pass · 0 warn · 0 fail')
    expect(empty.lines.join('\n')).toContain('◆ [ d ] Rerun Runtime Doctor')

    const narrow = renderSupervisorDoctor(null, createSupervisorDoctorState(), 46)
    expect(narrow.lines.every((line) => displayWidth(line) === 46)).toBe(true)
    expect(narrow.lines.join('\n')).toContain('Mode      Read-only diagnostics')
    expect(narrow.lines.join('\n')).toContain('Writes    None')
    expect(narrow.lines.join('\n')).toContain('◆ [ d ] Run Doctor')
  })

  it('renders responsive list-detail views with full-row targets', () => {
    const state = createSupervisorDoctorState(report)
    const stacked = renderSupervisorDoctor(report, state, 80)
    const stackedText = stacked.lines.join('\n')
    expect(stackedText).toContain('Doctor · 1–3/3 · FAILURE · 1 pass · 1 warn · 1 fail')
    expect(stackedText).toContain('› × Port collision')
    expect(stackedText).toContain('Inspection · 3/3 · FAIL')
    expect(stackedText).toContain('× Resolve this condition, then rerun Doctor.')
    expect(stackedText).not.toContain('\u001b')
    expect(stacked.targets[2]).toEqual({ row: 4, startColumn: 2, endColumn: 79, index: 2 })

    const wide = renderSupervisorDoctor(report, { selected: 1, hovered: 0 }, 120)
    expect(wide.lines[0]).toContain('Doctor checks')
    expect(wide.lines[0]).toContain('Inspection')
    expect(wide.lines.join('\n')).toContain('» ✓ Runtime reachable')
    expect(wide.lines.join('\n')).toContain('› ! Update available')
    expect(wide.targets[0]?.endColumn).toBeLessThan(60)

    const narrow = renderSupervisorDoctor(report, state, 52)
    expect(narrow.lines.every((line) => [...line].length <= 52)).toBe(true)
    expect(narrow.lines.join('\n')).toContain('1F/1W/1P')
  })

  it('shows the selected check position with a proportional scroll rail', () => {
    const checks = Array.from({ length: 12 }, (_, index) => ({
      status: 'pass',
      summary: `Check ${index + 1}`,
      detail: 'Verified.',
    }))
    const rendered = renderSupervisorDoctor(
      { overall: 'pass', checks },
      { selected: 11, hovered: null },
      80,
      undefined,
      2,
    )
    const output = rendered.lines.join('\n')
    expect(output).toContain('8–12/12')
    expect(output).toContain('› ✓ Check 12')
    expect(output).toContain('█')
    expect(output).toContain('│')
    expect(rendered.railTargets).toEqual([
      { row: 2, column: 78, trackRow: 0, index: 0 },
      { row: 3, column: 78, trackRow: 1, index: 3 },
      { row: 4, column: 78, trackRow: 2, index: 6 },
      { row: 5, column: 78, trackRow: 3, index: 8 },
      { row: 6, column: 78, trackRow: 4, index: 11 },
    ])
    expect(rendered.lines[3]?.at(-3)).toBe('◆')
  })

  it('spends a wide Operational Canvas on additional real checks', () => {
    const checks = Array.from({ length: 20 }, (_, index) => ({
      status: 'pass',
      summary: `Check ${index + 1}`,
      detail: 'Verified.',
    }))
    const expanded = renderSupervisorDoctor(
      { overall: 'pass', checks },
      { selected: 19, hovered: null },
      120,
      22,
    )

    expect(expanded.lines).toHaveLength(22)
    expect(expanded.lines.join('\n')).toContain('1–20/20')
    expect(expanded.lines.join('\n')).toContain('› ✓ Check 20')
    expect(expanded.lines.join('\n')).not.toContain('█')
    expect(expanded.targets).toHaveLength(20)
    expect(expanded.railTargets).toEqual([])
    expect(expanded.targets.at(-1)).toEqual({
      row: 21,
      startColumn: 2,
      endColumn: 54,
      index: 19,
    })

    const compact = renderSupervisorDoctor(
      { overall: 'pass', checks },
      { selected: 19, hovered: null },
      80,
    )
    expect(compact.targets).toHaveLength(5)
    expect(compact.lines.join('\n')).toContain('█')
  })

  it('anchors a truthful Diagnostic Radar action at the bottom of a wide canvas', () => {
    const expanded = renderSupervisorDoctor(null, createSupervisorDoctorState(), 120, 22)
    const targets = supervisorCommandTargets(expanded.lines)

    expect(expanded.lines).toHaveLength(22)
    expect(expanded.lines[1]).toContain('◇  DOCTOR STANDBY')
    expect(expanded.lines[4]).toContain('WRITES')
    expect(expanded.lines.join('\n')).toContain('· ───── ◇ ───── ·')
    expect(expanded.lines[20]).toContain('◆ [ d ] Run Runtime Doctor')
    expect(targets).toEqual([
      expect.objectContaining({ row: 21, label: 'd', primary: true }),
    ])
  })
})
