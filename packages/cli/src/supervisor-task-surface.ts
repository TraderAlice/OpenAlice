import { truncateDisplayWidth } from './supervisor-display.ts'
import type { SupervisorOverlayOptions } from './supervisor-overlay-pointer.ts'
import type { SupervisorTuiTheme } from './supervisor-tui-theme.ts'

export type SupervisorTaskSurfaceTask = 'setup' | 'source' | 'projects' | 'release'
export type SupervisorFocusTask = SupervisorTaskSurfaceTask | 'transfer' | 'confirmation'

export interface SupervisorTaskSurfaceSize {
  width: number
  height: number
}

export const SUPERVISOR_TASK_STAGE_MIN_WIDTH = 100
export const SUPERVISOR_TASK_STAGE_MIN_HEIGHT = 28
export const SUPERVISOR_TASK_STAGE_HEADER_ROWS = 3
export const SUPERVISOR_TASK_STAGE_CONSOLE_ROWS = 3

export function supervisorUsesTaskStage(size: SupervisorTaskSurfaceSize): boolean {
  return size.width >= SUPERVISOR_TASK_STAGE_MIN_WIDTH
    && size.height >= SUPERVISOR_TASK_STAGE_MIN_HEIGHT
}

export function supervisorTaskSurfaceOptions(
  size: SupervisorTaskSurfaceSize,
  fallback: SupervisorOverlayOptions,
): SupervisorOverlayOptions {
  if (!supervisorUsesTaskStage(size)) return fallback
  return {
    width: '100%',
    maxHeight: '100%',
    anchor: 'top-left',
    margin: {
      top: SUPERVISOR_TASK_STAGE_HEADER_ROWS,
      right: 0,
      bottom: SUPERVISOR_TASK_STAGE_CONSOLE_ROWS,
      left: 0,
    },
  }
}

export function renderSupervisorTaskSurface(
  lines: string[],
  size: SupervisorTaskSurfaceSize,
  task?: SupervisorTaskSurfaceTask,
): string[] {
  if (!supervisorUsesTaskStage(size)) return lines
  const rows = Math.max(
    1,
    size.height - SUPERVISOR_TASK_STAGE_HEADER_ROWS - SUPERVISOR_TASK_STAGE_CONSOLE_ROWS,
  )
  const content = lines.slice(0, rows)
  const quietRows = Math.max(0, rows - content.length)
  const trajectory = task ? renderFocusTrajectory(task, size.width) : []
  if (trajectory.length === 0 || quietRows < trajectory.length + 2) {
    return [...content, ...blankRows(quietRows)]
  }
  const leading = Math.floor((quietRows - trajectory.length) / 2)
  return [
    ...content,
    ...blankRows(leading),
    ...trajectory,
    ...blankRows(quietRows - leading - trajectory.length),
  ]
}

export function decorateSupervisorTaskSurface(
  lines: string[],
  theme: SupervisorTuiTheme,
): string[] {
  if (!theme.enabled) return lines
  return lines.map((line) => {
    if (line.startsWith('◇  FOCUS TRAJECTORY')) return theme.accent(line)
    if (line.startsWith('   01 ')) return theme.accentStrong(line)
    if (line.startsWith('   BOUNDARY') || line.startsWith('   EXIT')) return theme.muted(line)
    return line
  })
}

function renderFocusTrajectory(task: SupervisorTaskSurfaceTask, width: number): string[] {
  const definition = TASK_TRAJECTORIES[task]
  const rail = definition.steps
    .map((step, index) => `${String(index + 1).padStart(2, '0')} ${step.toUpperCase()}`)
    .join('  ━━━  ')
  return [
    truncateDisplayWidth(`◇  FOCUS TRAJECTORY · ${task.toUpperCase()}`, width),
    truncateDisplayWidth(`   ${rail}`, width),
    truncateDisplayWidth(`   BOUNDARY  ${definition.boundary}`, width),
    truncateDisplayWidth('   EXIT      Esc returns to the previous Supervisor view.', width),
  ]
}

function blankRows(count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, () => '')
}

const TASK_TRAJECTORIES: Record<SupervisorTaskSurfaceTask, {
  steps: readonly string[]
  boundary: string
}> = {
  setup: {
    steps: ['Inspect', 'Edit', 'Validate', 'Save'],
    boundary: 'Atomic configuration only; Runtime ownership stays unchanged.',
  },
  source: {
    steps: ['Select', 'Validate', 'Save', 'Launch'],
    boundary: 'One verified checkout; launch follows a successful save.',
  },
  projects: {
    steps: ['Inspect', 'Select or create', 'Remember'],
    boundary: 'Context selection only; no Runtime is stopped, moved, or copied.',
  },
  release: {
    steps: ['Choose', 'Probe', 'Confirm', 'Install'],
    boundary: 'One channel probe; installation still requires confirmation.',
  },
}
