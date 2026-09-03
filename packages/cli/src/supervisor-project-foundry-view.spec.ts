import { describe, expect, it } from 'vitest'

import { displayWidth } from './supervisor-display.ts'
import {
  decorateSupervisorProjectFoundry,
  renderSupervisorProjectFoundry,
  supervisorProjectFoundryFieldWidth,
} from './supervisor-project-foundry-view.ts'
import { createSupervisorTuiTheme } from './supervisor-tui-theme.ts'

describe('Supervisor AliceProject Foundry', () => {
  it('pairs a complete Build Path with the home Field Inspector', () => {
    const rendered = renderSupervisorProjectFoundry({
      step: 'home',
      currentProjectName: 'Default AliceProject',
      projectKey: 'research',
      fieldLines: ['> /Users/alice/.openalice-research'],
      detail: 'Use a separate complete home.',
      message: 'Existing data is never copied or deleted.',
    }, 100)
    const output = rendered.lines.join('\n')
    expect(output).toContain('Foundry · 2/2 · COMPLETE HOME')
    expect(output).toContain('Create AliceProject · research')
    expect(output).toContain('✓ 01 Identity')
    expect(output).toContain('◆ 02 Complete Home')
    expect(output).toContain('◆ [ Enter ] Create & select  │  [ Esc ] Back')
    expect(output).toContain('Foundry contract · COMPLETE HOME')
    expect(output).not.toContain('…')
    expect(rendered.lines.every((line) => displayWidth(line) <= 100)).toBe(true)
    expect(supervisorProjectFoundryFieldWidth(100)).toBe(57)
  })

  it('stacks the same identity step at the 80-column baseline', () => {
    const rendered = renderSupervisorProjectFoundry({
      step: 'identity',
      currentProjectName: 'Default AliceProject',
      fieldLines: ['> research'],
      detail: 'Use a short lowercase name.',
      message: 'Create a named AliceProject without leaving the Supervisor.',
    }, 72)
    const output = rendered.lines.join('\n')
    expect(output).toContain('AliceProject Foundry · 1/2 · IDENTITY')
    expect(output).toContain('◆ Identity  → Complete Home')
    expect(output).toContain('Create AliceProject · Project key')
    expect(output).toContain('◆ CONTRACT')
    expect(rendered.lines).toHaveLength(14)
    expect(rendered.lines.every((line) => displayWidth(line) <= 72)).toBe(true)
    expect(supervisorProjectFoundryFieldWidth(72)).toBe(68)
  })

  it('keeps whole-action hover visible with and without color', () => {
    const line = '│ ◆ [ Enter ] Continue  │  [ Esc ] Back │'
    const color = decorateSupervisorProjectFoundry(
      [line],
      createSupervisorTuiTheme({ TERM: 'xterm-256color' }),
      'Enter',
    )[0]!
    const plain = decorateSupervisorProjectFoundry(
      [line],
      createSupervisorTuiTheme({ TERM: 'xterm-256color', NO_COLOR: '1' }),
      'Enter',
    )[0]!
    expect(color).toContain('\u001b[')
    expect(color.replace(/\u001b\[[0-9;]*m/gu, '')).toContain('│ › [ Enter ] Continue')
    expect(plain).toContain('│ › [ Enter ] Continue')
  })
})
