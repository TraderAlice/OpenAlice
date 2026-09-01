import { describe, expect, it } from 'vitest'
import {
  classifySupervisorNotice,
  renderSupervisorFeedback,
  supervisorMotionEnabled,
} from './supervisor-tui-feedback.ts'

describe('Supervisor TUI feedback rail', () => {
  it('renders stable-width semantic feedback without depending on color', () => {
    const [busy] = renderSupervisorFeedback({ busy: 'Starting Runtime' }, 40, 0, true)
    const [ready] = renderSupervisorFeedback({ notice: 'Runtime started in the background.' }, 40)
    const [warning] = renderSupervisorFeedback({ notice: 'The selected Machine is offline.' }, 40)
    const [error] = renderSupervisorFeedback({ diagnostic: 'Start failed: timed out' }, 40)

    expect(busy).toHaveLength(40)
    expect(busy).toContain('⠋  WORKING  Starting Runtime…')
    expect(ready).toContain('✓  READY    Runtime started')
    expect(warning).toContain('!  NOTICE   The selected Machine')
    expect(error).toContain('×  ERROR    Start failed: timed out')
  })

  it('advances only the decorative spinner and supports a static motion policy', () => {
    expect(renderSupervisorFeedback({ busy: 'Checking' }, 30, 0, true)[0])
      .not.toBe(renderSupervisorFeedback({ busy: 'Checking' }, 30, 1, true)[0])
    expect(renderSupervisorFeedback({ busy: 'Checking' }, 30, 0, false)[0])
      .toBe(renderSupervisorFeedback({ busy: 'Checking' }, 30, 8, false)[0])
    expect(supervisorMotionEnabled({ TERM: 'xterm-256color' })).toBe(true)
    expect(supervisorMotionEnabled({ TERM: 'dumb' })).toBe(false)
    expect(supervisorMotionEnabled({ TERM: 'xterm-256color', OPENALICE_TUI_MOTION: '0' })).toBe(false)
  })

  it('classifies successful and actionable notices conservatively', () => {
    expect(classifySupervisorNotice('Runtime restarted and reconnected.')).toBe('success')
    expect(classifySupervisorNotice('The selected Machine is not online.')).toBe('warning')
    expect(classifySupervisorNotice('Stop the selected Runtime before changing its source.')).toBe('warning')
    expect(classifySupervisorNotice('Action cancelled.')).toBe('info')
  })
})
