import { describe, expect, it } from 'vitest'

import { displayWidth } from './supervisor-display.ts'
import {
  decorateSupervisorTaskSurface,
  renderSupervisorTaskSurface,
  supervisorTaskSurfaceOptions,
  supervisorUsesTaskStage,
} from './supervisor-task-surface.ts'
import { createSupervisorTuiTheme } from './supervisor-tui-theme.ts'
import { supervisorCommandTargets } from './supervisor-tui-view.ts'

describe('Supervisor secondary-task surface', () => {
  const sheet = {
    width: '92%',
    maxHeight: '90%',
    anchor: 'center',
    margin: 1,
  } as const

  it('turns wide tall secondary work into one header-to-console stage', () => {
    const size = { width: 120, height: 32 }
    expect(supervisorUsesTaskStage(size)).toBe(true)
    expect(supervisorTaskSurfaceOptions(size, sheet)).toEqual({
      width: '100%',
      maxHeight: '100%',
      anchor: 'top-left',
      margin: { top: 3, right: 0, bottom: 3, left: 0 },
    })
    const lines = renderSupervisorTaskSurface(['work', 'status'], size)
    expect(lines).toHaveLength(26)
    expect(lines.slice(0, 2)).toEqual(['work', 'status'])
    expect(lines.slice(2).every((line) => line === '')).toBe(true)
  })

  it('keeps the responsive task sheet below either stage boundary', () => {
    for (const size of [
      { width: 99, height: 32 },
      { width: 120, height: 27 },
      { width: 80, height: 24 },
    ]) {
      expect(supervisorUsesTaskStage(size)).toBe(false)
      expect(supervisorTaskSurfaceOptions(size, sheet)).toBe(sheet)
      expect(renderSupervisorTaskSurface(['work'], size)).toEqual(['work'])
    }
  })

  it('gives bounded focused tasks a compact Focus Workspace without widening the default surface', () => {
    const size = { width: 80, height: 24 }
    expect(supervisorUsesTaskStage(size)).toBe(false)
    expect(supervisorUsesTaskStage(size, 'setup')).toBe(true)
    expect(supervisorUsesTaskStage(size, 'source')).toBe(true)
    expect(supervisorUsesTaskStage(size, 'projects')).toBe(true)
    expect(supervisorUsesTaskStage(size, 'release')).toBe(true)
    expect(supervisorUsesTaskStage(size, 'transfer')).toBe(true)
    expect(supervisorUsesTaskStage({ width: 71, height: 24 }, 'setup')).toBe(false)
    expect(supervisorUsesTaskStage({ width: 80, height: 23 }, 'setup')).toBe(false)
    expect(supervisorTaskSurfaceOptions(size, sheet, 'setup')).toEqual({
      width: '100%',
      maxHeight: '100%',
      anchor: 'top-left',
      margin: { top: 3, right: 0, bottom: 3, left: 0 },
    })
    expect(renderSupervisorTaskSurface(['work'], size, 'setup')).toHaveLength(18)
    expect(renderSupervisorTaskSurface(['work'], size, 'source')).toHaveLength(18)
    expect(renderSupervisorTaskSurface(['work'], size, 'projects')).toHaveLength(18)
    expect(renderSupervisorTaskSurface(['work'], size, 'release')).toHaveLength(18)
    expect(renderSupervisorTaskSurface(['work'], size, 'transfer')).toHaveLength(18)
    expect(renderSupervisorTaskSurface(['work'], size)).toEqual(['work'])
  })

  it('docks a truthful task trajectory above the focused action shelf', () => {
    const lines = renderSupervisorTaskSurface(
      Array.from({ length: 12 }, (_, index) => `content ${index + 1}`),
      { width: 120, height: 32 },
      'source',
    )
    const output = lines.join('\n')

    expect(lines).toHaveLength(26)
    expect(output).toContain('◇  FOCUS TRAJECTORY · SOURCE')
    expect(output).toContain('01 SELECT  ━━━  02 VALIDATE  ━━━  03 SAVE  ━━━  04 LAUNCH')
    expect(output).toContain('One verified checkout; launch follows a successful save.')
    expect(output).toContain('Esc returns to the previous Supervisor view.')
    expect(lines.at(-4)).toContain('◇  FOCUS TRAJECTORY · SOURCE')
    expect(lines.at(-1)).toContain('Esc returns to the previous Supervisor view.')
    expect(lines.every((line) => displayWidth(line) <= 120)).toBe(true)
    expect(supervisorCommandTargets(lines)).toEqual([])
  })

  it('projects each existing task contract without inventing progress', () => {
    const expected = {
      setup: '01 INSPECT  ━━━  02 EDIT  ━━━  03 VALIDATE  ━━━  04 SAVE',
      projects: '01 INSPECT  ━━━  02 SELECT OR CREATE  ━━━  03 REMEMBER',
      release: '01 CHOOSE  ━━━  02 PROBE  ━━━  03 CONFIRM  ━━━  04 INSTALL',
    } as const
    for (const [task, route] of Object.entries(expected)) {
      const output = renderSupervisorTaskSurface(
        ['content'],
        { width: 120, height: 32 },
        task as keyof typeof expected,
      ).join('\n')
      expect(output).toContain(route)
      expect(output).not.toMatch(/CURRENT|DONE|READY/u)
    }
  })

  it('colors only the quiet-field hierarchy and preserves no-color output', () => {
    const lines = renderSupervisorTaskSurface(
      ['content'],
      { width: 120, height: 32 },
      'setup',
    )
    const color = decorateSupervisorTaskSurface(
      lines,
      createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
    )
    const plain = decorateSupervisorTaskSurface(
      lines,
      createSupervisorTuiTheme({ TERM: 'xterm-256color', NO_COLOR: '1' }),
    )
    expect(color.join('\n')).toContain('\u001b[')
    expect(plain).toEqual(lines)
  })
})
