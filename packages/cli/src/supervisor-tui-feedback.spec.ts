import { describe, expect, it } from 'vitest'
import {
  classifySupervisorNotice,
  renderSupervisorActivitySlot,
  supervisorCommandHoverPreview,
  supervisorMotionEnabled,
} from './supervisor-tui-feedback.ts'

describe('Supervisor TUI feedback rail', () => {
  it('renders stable-width semantic feedback without depending on color', () => {
    const busy = renderSupervisorActivitySlot({ busy: 'Starting Runtime' }, 40, 0, true)
    const ready = renderSupervisorActivitySlot({ notice: 'Runtime started in the background.' }, 40)
    const warning = renderSupervisorActivitySlot({ notice: 'The selected Machine is offline.' }, 40)
    const error = renderSupervisorActivitySlot({ diagnostic: 'Start failed: timed out' }, 40)

    expect(busy).toHaveLength(40)
    expect(busy).toContain('⠋  WORKING  Starting Runtime…')
    expect(ready).toContain('✓  READY    Runtime started')
    expect(warning).toContain('!  NOTICE   The selected Machine')
    expect(error).toContain('×  ERROR    Start failed: timed out')
  })

  it('advances only the decorative spinner and supports a static motion policy', () => {
    expect(renderSupervisorActivitySlot({ busy: 'Checking' }, 30, 0, true))
      .not.toBe(renderSupervisorActivitySlot({ busy: 'Checking' }, 30, 1, true))
    expect(renderSupervisorActivitySlot({ busy: 'Checking' }, 30, 0, false))
      .toBe(renderSupervisorActivitySlot({ busy: 'Checking' }, 30, 8, false))
    expect(supervisorMotionEnabled({ TERM: 'xterm-256color' })).toBe(true)
    expect(supervisorMotionEnabled({ TERM: 'dumb' })).toBe(false)
    expect(supervisorMotionEnabled({ TERM: 'xterm-256color', OPENALICE_TUI_MOTION: '0' })).toBe(false)
  })

  it('keeps one fixed activity slot and applies deterministic priority', () => {
    expect(renderSupervisorActivitySlot({}, 32)).toBe(' '.repeat(32))
    expect(renderSupervisorActivitySlot({ preview: 'Inspect Setup.' }, 32))
      .toContain('◇  PREVIEW  Inspect Setup.')
    expect(renderSupervisorActivitySlot({
      preview: 'Inspect Setup.',
      notice: 'Runtime started.',
    }, 50)).toContain('✓  READY')
    expect(renderSupervisorActivitySlot({
      notice: 'Runtime started.',
      diagnostic: 'Previous probe failed.',
      preview: 'Inspect Setup.',
    }, 50)).toContain('×  ERROR')
    expect(renderSupervisorActivitySlot({
      busy: 'Refreshing Runtime',
      notice: 'Runtime started.',
      diagnostic: 'Previous probe failed.',
      preview: 'Inspect Setup.',
    }, 50, 0, false)).toContain('◆  WORKING')
  })

  it('describes existing pointer actions without inventing another route', () => {
    expect(supervisorCommandHoverPreview('p', 'overview'))
      .toContain('Setup Studio')
    expect(supervisorCommandHoverPreview('q', 'overview'))
      .toContain('Runtime keeps its current ownership')
    expect(supervisorCommandHoverPreview('r', 'fleet'))
      .toContain('Refresh the selected Machine inventory')
    expect(supervisorCommandHoverPreview('Enter', 'fleet', 'running', '◆ [ Enter ] Connect'))
      .toBe('Connect; activation follows the existing Enter path.')
  })

  it('classifies successful and actionable notices conservatively', () => {
    expect(classifySupervisorNotice('Runtime restarted and reconnected.')).toBe('success')
    expect(classifySupervisorNotice('The selected Machine is not online.')).toBe('warning')
    expect(classifySupervisorNotice('Stop the selected Runtime before changing its source.')).toBe('warning')
    expect(classifySupervisorNotice('Action cancelled.')).toBe('info')
  })
})
