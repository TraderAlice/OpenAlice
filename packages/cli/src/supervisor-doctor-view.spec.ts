import { describe, expect, it } from 'vitest'

import {
  createSupervisorDoctorState,
  moveSupervisorDoctorSelection,
  renderSupervisorDoctor,
} from './supervisor-doctor-view.ts'

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
})
