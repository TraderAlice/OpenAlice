export interface SupervisorTuiTheme {
  enabled: boolean
  accent(value: string): string
  accentStrong(value: string): string
  muted(value: string): string
  success(value: string): string
  warning(value: string): string
  danger(value: string): string
  selected(value: string): string
  brand(value: string, frame?: number): string
  busyRail(value: string): string
  infoRail(value: string): string
  successRail(value: string): string
  warningRail(value: string): string
  dangerRail(value: string): string
}

export interface SupervisorFrameStyleOptions {
  panel: string
  hoveredPanel?: string
  hoveredCommand?: { row: number; label: string }
  runtimeClass?: string
  introFrame?: number
}

const RESET = '\u001b[0m'
const BRAND_SWEEP = [
  '116;235;226',
  '92;220;211',
  '111;198;255',
  '168;166;255',
  '226;156;255',
  '255;164;210',
] as const

export function createSupervisorTuiTheme(
  env: NodeJS.ProcessEnv = process.env,
): SupervisorTuiTheme {
  const enabled = env['NO_COLOR'] === undefined
    && env['TERM'] !== 'dumb'
    && env['OPENALICE_TUI_COLOR'] !== '0'
  const style = (open: string) => (value: string): string => enabled
    ? `${open}${value}${RESET}`
    : value
  const brand = (value: string, frame?: number): string => {
    if (!enabled) return value
    if (frame === undefined) return `\u001b[1;38;2;116;235;226m${value}${RESET}`
    return `${[...value].map((character, index) => {
      const color = BRAND_SWEEP[(index + frame) % BRAND_SWEEP.length]!
      return `\u001b[1;38;2;${color}m${character}`
    }).join('')}${RESET}`
  }
  return {
    enabled,
    accent: style('\u001b[38;2;92;220;211m'),
    accentStrong: style('\u001b[1;38;2;116;235;226m'),
    muted: style('\u001b[38;2;116;132;153m'),
    success: style('\u001b[38;2;89;214;145m'),
    warning: style('\u001b[38;2;245;190;83m'),
    danger: style('\u001b[38;2;255;107;129m'),
    selected: style('\u001b[1;38;2;230;255;252;48;2;24;64;69m'),
    brand,
    busyRail: style('\u001b[1;38;2;183;255;248;48;2;12;42;45m'),
    infoRail: style('\u001b[38;2;189;229;255;48;2;17;35;52m'),
    successRail: style('\u001b[1;38;2;170;255;207;48;2;13;45;31m'),
    warningRail: style('\u001b[1;38;2;255;222;151;48;2;54;40;16m'),
    dangerRail: style('\u001b[1;38;2;255;190;201;48;2;55;20;31m'),
  }
}

export function decorateSupervisorFrame(
  lines: string[],
  theme: SupervisorTuiTheme,
  options: SupervisorFrameStyleOptions,
): string[] {
  if (!theme.enabled) return lines
  return lines.map((line, index) => {
    if (options.hoveredCommand?.row === index + 1) {
      const keycap = `[ ${options.hoveredCommand.label} ]`
      return line.replace(keycap, theme.selected(keycap))
    }
    if (/^[⠀-⣿◆]  WORKING /u.test(line)) return theme.busyRail(line)
    if (line.startsWith('✓  READY')) return theme.successRail(line)
    if (line.startsWith('!  NOTICE')) return theme.warningRail(line)
    if (line.startsWith('×  ERROR')) return theme.dangerRail(line)
    if (line.startsWith('◆  STATUS')) return theme.infoRail(line)
    if (index === 0) return decorateHeader(line, theme, options.introFrame)
    if (index === 1) return theme.accent(line)
    if (index === 2) return decorateTabs(line, theme, options.panel, options.hoveredPanel)
    if (line.startsWith('› ') || line.startsWith('▶ ') || line.includes('│ › ')) return theme.selected(line)
    if (line.includes('│ » ')) return theme.accent(line)
    if (line.includes('│ × ')) return theme.danger(line)
    if (line.includes('│ ! ')) return theme.warning(line)
    if (line.includes('│ ✓ ')) return theme.success(line)
    if (line.includes('│ NAVIGATION') || line.includes('│ RUNTIME') || line.includes('│ PROJECT') || line.includes('│ RECOVERY')) {
      return theme.accentStrong(line)
    }
    if (line.startsWith('╭')) return theme.accent(line)
    if (line.startsWith('╰')) return theme.muted(line)
    if (line.startsWith('⌂  Home')) return theme.muted(line)
    if (line.includes('[ Enter ]') || line.startsWith('◆ [')) return theme.accentStrong(line)
    if (line.includes('● RUNNING') || line.includes('◉ RUNNING')) return theme.success(line)
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

function decorateHeader(
  line: string,
  theme: SupervisorTuiTheme,
  introFrame?: number,
): string {
  const brand = line.startsWith('◆  OpenAlice Supervisor')
    ? '◆  OpenAlice Supervisor'
    : line.startsWith('◆ OpenAlice')
      ? '◆ OpenAlice'
      : line
  if (brand === line) return theme.brand(line, introFrame)
  return `${theme.brand(brand, introFrame)}${theme.muted(line.slice(brand.length))}`
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
