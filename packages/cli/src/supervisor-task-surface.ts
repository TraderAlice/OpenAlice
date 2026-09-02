import type { SupervisorOverlayOptions } from './supervisor-overlay-pointer.ts'

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
): string[] {
  if (!supervisorUsesTaskStage(size)) return lines
  const rows = Math.max(
    1,
    size.height - SUPERVISOR_TASK_STAGE_HEADER_ROWS - SUPERVISOR_TASK_STAGE_CONSOLE_ROWS,
  )
  return [
    ...lines.slice(0, rows),
    ...Array.from({ length: Math.max(0, rows - lines.length) }, () => ''),
  ]
}
