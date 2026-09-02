import { displayWidth, truncateDisplayWidth } from './supervisor-display.ts'

export type SupervisorFeedbackTone = 'busy' | 'info' | 'success' | 'warning' | 'danger' | 'preview'

export interface SupervisorFeedback {
  tone: SupervisorFeedbackTone
  icon: string
  label: string
  message: string
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

export function supervisorMotionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['TERM'] !== 'dumb'
    && env['OPENALICE_TUI_MOTION'] !== '0'
}

export function renderSupervisorActivitySlot(
  input: { busy?: string; notice?: string; diagnostic?: string; preview?: string },
  width: number,
  frame = 0,
  motion = true,
): string {
  const feedback = collectFeedback(input, frame, motion)
  const selected = feedback.find((item) => item.tone === 'busy')
    ?? feedback.find((item) => item.tone === 'danger')
    ?? feedback.find((item) => item.tone !== 'preview')
    ?? feedback.find((item) => item.tone === 'preview')
  if (selected) return renderFeedbackRail(selected, width)
  return ' '.repeat(Math.max(1, width))
}

export function supervisorCommandHoverPreview(
  label: string,
  panel: string,
  runtimeClass = 'unavailable',
  surface?: string,
): string {
  const action = surface
    ?.replace(/^(?:[◆·] )?\[ [^\]]+ \] /u, '')
    .trim()
  if (label === '/') return 'Search and run actions without leaving the current view.'
  if (label === 'q' || label === 'q / Esc') {
    return 'Detach from the Supervisor and restore terminal modes; the Runtime keeps its current ownership.'
  }
  if (label === 'i') return 'Choose or create the complete AliceProject home used by future bare starts.'
  if (label === 's') {
    return panel === 'fleet'
      ? 'Start the selected remote AliceProject on its owning Machine.'
      : 'Start the selected Runtime without opening a browser.'
  }
  if (label === 'p') return 'Review AliceProject and Machine defaults in Setup Studio.'
  if (label === 'c') return 'Choose, validate, save, and launch a Runtime source checkout.'
  if (label === '?') return 'Open contextual controls and the complete keyboard reference.'
  if (label === 'l') return 'Inspect the bounded, redacted Runtime log snapshot.'
  if (label === 'd') return 'Run read-only Runtime ownership and readiness checks.'
  if (label === 'u') return 'Choose a release lane and inspect the available update.'
  if (label === 'r') {
    return panel === 'fleet'
      ? 'Refresh the selected Machine inventory without changing Runtime state.'
      : 'Review impact before restarting the CLI-owned Runtime.'
  }
  if (label === 'x') return 'Review impact before stopping the CLI-owned Runtime.'
  if (label === 'm') return 'Prepare transfer of the selected AliceProject to another Machine.'
  if (label === 'f') return 'Cycle the visible Runtime log severity filter.'
  if (label === '↑↓') return 'Move the current selection without activating it.'
  if (label === '←') return 'Return focus to the Machine list.'
  if (label === 'Home') return 'Jump to the first item in this operational view.'
  if (label === 'End') {
    return panel === 'logs'
      ? 'Return to the latest Runtime log entries.'
      : 'Jump to the last item in this operational view.'
  }
  if (label === 'Enter') {
    if (action) return `${action}; activation follows the existing Enter path.`
    return runtimeClass === 'absent'
      ? 'Start the selected AliceProject and open its Workspace.'
      : 'Open the selected AliceProject Workspace.'
  }
  return action
    ? `${action}; activation follows the existing ${label} key path.`
    : `Run the existing ${label} action for this view.`
}

export function classifySupervisorNotice(message: string): SupervisorFeedbackTone {
  if (/\b(no|not|failed|offline|unavailable|blocked|locked|conflict|required|cannot|nothing changed)\b/iu.test(message)
    || /\bstop\b.*\bbefore\b/iu.test(message)) {
    return 'warning'
  }
  if (/\b(started|opened|stopped|restarted|connected|refreshed|saved|selected|installed|created|transferred)\b/iu.test(message)) {
    return 'success'
  }
  return 'info'
}

function collectFeedback(
  input: { busy?: string; notice?: string; diagnostic?: string; preview?: string },
  frame: number,
  motion: boolean,
): SupervisorFeedback[] {
  const rows: SupervisorFeedback[] = []
  if (input.busy) {
    rows.push({
      tone: 'busy',
      icon: motion ? SPINNER_FRAMES[Math.abs(frame) % SPINNER_FRAMES.length]! : '◆',
      label: 'WORKING',
      message: `${input.busy}…`,
    })
  }
  if (input.notice) {
    const tone = classifySupervisorNotice(input.notice)
    rows.push({
      tone,
      icon: tone === 'success' ? '✓' : tone === 'warning' ? '!' : '◆',
      label: tone === 'success' ? 'READY' : tone === 'warning' ? 'NOTICE' : 'STATUS',
      message: input.notice,
    })
  }
  if (input.diagnostic) {
    rows.push({
      tone: 'danger',
      icon: '×',
      label: 'ERROR',
      message: input.diagnostic,
    })
  }
  if (input.preview) {
    rows.push({
      tone: 'preview',
      icon: '◇',
      label: 'PREVIEW',
      message: input.preview,
    })
  }
  return rows
}

function renderFeedbackRail(feedback: SupervisorFeedback, width: number): string {
  const safeWidth = Math.max(1, width)
  const content = truncateDisplayWidth(
    `${feedback.icon}  ${feedback.label.padEnd(7)}  ${feedback.message}`,
    safeWidth,
  )
  return `${content}${' '.repeat(Math.max(0, safeWidth - displayWidth(content)))}`
}
