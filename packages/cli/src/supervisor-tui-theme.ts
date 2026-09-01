export interface SupervisorTuiTheme {
  enabled: boolean
  accent(value: string): string
  accentStrong(value: string): string
  muted(value: string): string
  success(value: string): string
  warning(value: string): string
  danger(value: string): string
  selected(value: string): string
}

export interface SupervisorFrameStyleOptions {
  panel: string
  hoveredPanel?: string
  runtimeClass?: string
}

const RESET = '\u001b[0m'

export function createSupervisorTuiTheme(
  env: NodeJS.ProcessEnv = process.env,
): SupervisorTuiTheme {
  const enabled = env['NO_COLOR'] === undefined
    && env['TERM'] !== 'dumb'
    && env['OPENALICE_TUI_COLOR'] !== '0'
  const style = (open: string) => (value: string): string => enabled
    ? `${open}${value}${RESET}`
    : value
  return {
    enabled,
    accent: style('\u001b[38;2;92;220;211m'),
    accentStrong: style('\u001b[1;38;2;116;235;226m'),
    muted: style('\u001b[38;2;116;132;153m'),
    success: style('\u001b[38;2;89;214;145m'),
    warning: style('\u001b[38;2;245;190;83m'),
    danger: style('\u001b[38;2;255;107;129m'),
    selected: style('\u001b[1;38;2;230;255;252;48;2;24;64;69m'),
  }
}

export function decorateSupervisorFrame(
  lines: string[],
  theme: SupervisorTuiTheme,
  options: SupervisorFrameStyleOptions,
): string[] {
  if (!theme.enabled) return lines
  return lines.map((line, index) => {
    if (index === 0) return theme.accentStrong(line)
    if (index === 1) return theme.accent(line)
    if (index === 2) return decorateTabs(line, theme, options.panel, options.hoveredPanel)
    if (line.startsWith('› ') || line.startsWith('▶ ') || line.includes('│ › ')) return theme.selected(line)
    if (line.includes('│ » ')) return theme.accent(line)
    if (line.startsWith('╭')) return theme.accent(line)
    if (line.startsWith('╰')) return theme.muted(line)
    if (line.includes('[ Enter ]') || line.startsWith('◆ [')) return theme.accentStrong(line)
    if (line.includes('● RUNNING')) return theme.success(line)
    if (line.includes('◆ NEEDS ATTENTION')) return theme.danger(line)
    if (line.includes('◇ UNAVAILABLE')) return theme.warning(line)
    if (line.startsWith('Working:')) return theme.accent(line)
    if (line.startsWith('Notice:')) return theme.warning(line)
    if (line.startsWith('Diagnostic:')) return theme.danger(line)
    if (line.startsWith('Doctor:')) {
      return line.includes(' fail') && !line.includes(' 0 fail')
        ? theme.danger(line)
        : line.includes(' warn') && !line.includes(' 0 warn')
          ? theme.warning(line)
          : theme.success(line)
    }
    if (line.startsWith('Runtime state:') || line.startsWith('Runtime:')) {
      if (options.runtimeClass === 'running') return theme.success(line)
      if (options.runtimeClass === 'absent') return theme.muted(line)
      if (options.runtimeClass === 'incompatible') return theme.danger(line)
      return theme.warning(line)
    }
    if (
      line === 'Machines'
      || line.startsWith('Machines ')
      || line.startsWith('AliceProjects')
      || line.startsWith('Runtime logs')
      || line.startsWith('Supervisor controls')
      || line.startsWith('Supervisor recovery controls')
    ) return theme.accentStrong(line)
    if (line.startsWith('q / Esc / Ctrl+C')) return theme.muted(line)
    return line
  })
}

function decorateTabs(
  line: string,
  theme: SupervisorTuiTheme,
  selectedPanel: string,
  hoveredPanel?: string,
): string {
  const labels: Record<string, string[]> = {
    fleet: ['Machines', 'Fleet'],
    overview: ['Overview', 'Home'],
    logs: ['Logs'],
    doctor: ['Doctor'],
    help: ['Help'],
  }
  let output = line
  for (const [panel, candidates] of Object.entries(labels)) {
    for (const label of candidates) {
      const active = `[${label}]`
      if (output.includes(active)) output = output.replace(active, theme.selected(` ${label} `))
      else if (panel === hoveredPanel && panel !== selectedPanel) output = output.replace(label, theme.accent(label))
    }
  }
  return output
}
