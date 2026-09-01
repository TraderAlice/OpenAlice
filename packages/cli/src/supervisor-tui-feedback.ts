import { displayWidth, truncateDisplayWidth } from './supervisor-fleet.ts'

export type SupervisorFeedbackTone = 'busy' | 'info' | 'success' | 'warning' | 'danger'

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

export function renderSupervisorFeedback(
  input: { busy?: string; notice?: string; diagnostic?: string },
  width: number,
  frame = 0,
  motion = true,
): string[] {
  const feedback = collectFeedback(input, frame, motion)
  return feedback.map((item) => renderFeedbackRail(item, width))
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
  input: { busy?: string; notice?: string; diagnostic?: string },
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
