import type { SupervisorTuiTheme } from './supervisor-tui-theme.ts'
import {
  renderSupervisorCommandBar,
  renderSupervisorPanel,
  wrapDisplayText,
} from './supervisor-tui-view.ts'

export type SupervisorConfirmation =
  | 'stop'
  | 'restart'
  | 'managed-source'
  | 'update'

export interface SupervisorConfirmationView {
  action: SupervisorConfirmation
  title: string
  meta: string
  prompt: string
  impact: string[]
  confirmLabel: string
  cancelLabel: string
}

export const SUPERVISOR_CONFIRMATION_OVERLAY_OPTIONS = {
  width: 72,
  maxHeight: '90%',
  anchor: 'center',
  margin: 1,
} as const

export function renderSupervisorConfirmation(
  view: SupervisorConfirmationView,
  width: number,
  theme: SupervisorTuiTheme,
  hoveredCommand?: string,
): string[] {
  const innerWidth = Math.max(1, width - 4)
  const destructive = view.action === 'stop' || view.action === 'restart'
  const raw = renderSupervisorPanel(view.title, view.meta, [
    `${destructive ? '!' : '◆'}  ${destructive ? 'RUNTIME MUTATION' : 'CONFIRMATION REQUIRED'}`,
    '',
    ...wrapDisplayText(view.prompt, innerWidth),
    '',
    'IMPACT',
    ...view.impact.flatMap((line) => wrapDisplayText(line, innerWidth)),
    '',
    ...renderSupervisorCommandBar([
      { key: 'Enter', label: view.confirmLabel, primary: true },
      { key: 'Esc', label: view.cancelLabel },
    ], innerWidth),
  ], width)
  return decorateConfirmation(raw, theme, destructive, hoveredCommand)
}

function decorateConfirmation(
  lines: string[],
  theme: SupervisorTuiTheme,
  destructive: boolean,
  hoveredCommand?: string,
): string[] {
  if (!theme.enabled) return lines
  return lines.map((line, index) => {
    if (hoveredCommand) {
      const keycap = `[ ${hoveredCommand} ]`
      if (line.includes(keycap)) return line.replace(keycap, theme.selected(keycap))
    }
    if (index === 0) return destructive ? theme.danger(line) : theme.accentStrong(line)
    if (index === lines.length - 1) return theme.muted(line)
    if (line.includes('RUNTIME MUTATION')) return theme.danger(line)
    if (line.includes('CONFIRMATION REQUIRED') || line.includes('│ IMPACT')) {
      return destructive ? theme.warning(line) : theme.accent(line)
    }
    if (line.includes('[ Enter ]')) return theme.accentStrong(line)
    return line
  })
}
