import {
  decorateSupervisorActionShelf,
  type SupervisorTuiTheme,
} from './supervisor-tui-theme.ts'
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
    ...renderSupervisorConfirmationActionBar(view, innerWidth),
  ], width)
  return decorateConfirmation(raw, theme, destructive, hoveredCommand)
}

export function renderSupervisorConfirmationActionBar(
  view: Pick<SupervisorConfirmationView, 'confirmLabel' | 'cancelLabel'>,
  width: number,
): string[] {
  return renderSupervisorCommandBar([
    { key: 'Enter', label: view.confirmLabel, primary: true },
    { key: 'Esc', label: view.cancelLabel },
  ], width)
}

function decorateConfirmation(
  lines: string[],
  theme: SupervisorTuiTheme,
  destructive: boolean,
  hoveredCommand?: string,
): string[] {
  const decorated = lines.map((line) => (
    /^│ [◆·] \[ [^\]]+ \] /u.test(line)
      ? decorateSupervisorActionShelf(line, theme, hoveredCommand)
      : line
  ))
  if (!theme.enabled) return decorated
  return decorated.map((line, index) => {
    if (/^│ \u001b\[/u.test(line) && line.includes('[ Enter ]')) return line
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
