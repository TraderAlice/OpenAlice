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
  navigationRail(value: string): string
  navigationHover(value: string): string
  actionRail(value: string): string
  actionPrimary(value: string): string
  dockRail(value: string): string
  dockControl(value: string): string
  dockIdentity(value: string): string
  dockSuccess(value: string): string
  dockWarning(value: string): string
  dockDanger(value: string): string
  dockPanel(value: string): string
}

export interface SupervisorFrameStyleOptions {
  panel: string
  headerReleaseHovered?: boolean
  hoveredPanel?: string
  hoveredCommand?: { row: number; label: string }
  runtimeClass?: string
  introFrame?: number
  ambientBrandFrame?: number
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

export const SUPERVISOR_BRAND_MARK_ROWS = [
  '▄▀▄ █   ▀█▀ ▄▀▀ █▀▀',
  '█▀█ █    █  █   █▀ ',
  '▀ ▀ ▀▀▀ ▄█▄ ▀▄▄ ▀▀▀',
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
    navigationRail: style('\u001b[38;2;162;190;198;48;2;11;28;34m'),
    navigationHover: style('\u001b[1;38;2;203;250;246;48;2;19;49;55m'),
    actionRail: style('\u001b[38;2;173;202;208;48;2;13;31;38m'),
    actionPrimary: style('\u001b[1;38;2;183;255;248;48;2;18;54;59m'),
    dockRail: style('\u001b[38;2;199;235;239;48;2;10;34;39m'),
    dockControl: style('\u001b[1;38;2;183;255;248;48;2;10;34;39m'),
    dockIdentity: style('\u001b[1;38;2;240;249;255;48;2;10;34;39m'),
    dockSuccess: style('\u001b[1;38;2;145;242;187;48;2;10;34;39m'),
    dockWarning: style('\u001b[1;38;2;255;214;128;48;2;10;34;39m'),
    dockDanger: style('\u001b[1;38;2;255;151;169;48;2;10;34;39m'),
    dockPanel: style('\u001b[1;38;2;213;179;255;48;2;10;34;39m'),
  }
}

export function decorateSupervisorFrame(
  lines: string[],
  theme: SupervisorTuiTheme,
  options: SupervisorFrameStyleOptions,
): string[] {
  if (!theme.enabled) {
    return lines.map((line, index) => (
      isSupervisorActionShelf(line)
        ? decorateSupervisorActionShelf(
            line,
            theme,
            options.hoveredCommand?.row === index + 1
              ? options.hoveredCommand.label
              : undefined,
          )
        : line
    ))
  }
  return lines.map((line, index) => {
    const brandMark = decorateBrandMarkLine(
      line,
      theme,
      options.introFrame ?? options.ambientBrandFrame,
    )
    if (brandMark) return brandMark
    if (isSupervisorActionShelf(line)) {
      return decorateSupervisorActionShelf(
        line,
        theme,
        options.hoveredCommand?.row === index + 1
          ? options.hoveredCommand.label
          : undefined,
      )
    }
    if (line.startsWith('[ / ]') || line.startsWith('╰─ [ / ]')) {
      return decorateDock(line, theme, options.hoveredCommand?.row === index + 1
        ? options.hoveredCommand.label
        : undefined)
    }
    if (index === 0) return decorateHeader(
      line,
      theme,
      options.introFrame,
      options.headerReleaseHovered,
    )
    if (options.hoveredCommand?.row === index + 1) {
      const keycap = `[ ${options.hoveredCommand.label} ]`
      return line.replace(keycap, theme.selected(keycap))
    }
    if (/^[⠀-⣿◆]  WORKING /u.test(line)) return theme.busyRail(line)
    if (line.startsWith('✓  READY')) return theme.successRail(line)
    if (line.startsWith('!  NOTICE')) return theme.warningRail(line)
    if (line.startsWith('×  ERROR')) return theme.dangerRail(line)
    if (line.startsWith('◆  STATUS')) return theme.infoRail(line)
    if (index === 1) return decorateTabs(line, theme, options.panel, options.hoveredPanel)
    if (index === 2) return decorateNavigationBeaconRail(line, theme)
    if (line.startsWith('› ') || line.startsWith('▶ ') || line.includes('│ › ')) return theme.selected(line)
    if (line.includes('│ » ')) return theme.accent(line)
    if (line.includes('│ × ')) return theme.danger(line)
    if (line.includes('│ ! ')) return theme.warning(line)
    if (line.includes('│ ✓ ')) return theme.success(line)
    if (line.includes('│ ● LIVE SESSION')) return theme.successRail(line)
    if (line.includes('│ ◆ LAUNCH READY')) return theme.infoRail(line)
    if (line.includes('│ × ATTENTION')) return theme.dangerRail(line)
    if (line.includes('│ ◇ CHECKING')) return theme.warningRail(line)
    if (line.includes('│ NAVIGATION') || line.includes('│ RUNTIME') || line.includes('│ PROJECT') || line.includes('│ RECOVERY') || line.includes('│ PRIMARY') || line.includes('│ OBSERVE') || line.includes('│ MANAGE')) {
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
    return line
  })
}

function decorateBrandMarkLine(
  line: string,
  theme: SupervisorTuiTheme,
  introFrame?: number,
): string | null {
  const mark = SUPERVISOR_BRAND_MARK_ROWS.find((row) => line.includes(row))
  if (!mark) return null
  const offset = line.indexOf(mark)
  return `${line.slice(0, offset)}${theme.brand(mark, introFrame)}${line.slice(offset + mark.length)}`
}

export function decorateSupervisorActionShelf(
  line: string,
  theme: SupervisorTuiTheme,
  hoveredCommand?: string,
): string {
  const columns = splitFramedColumns(line)
  if (columns.length > 1) {
    return columns.map((column) => (
      isSingleSupervisorActionShelf(column)
        ? decorateSingleSupervisorActionShelf(column, theme, hoveredCommand)
        : column
    )).join('   ')
  }
  return decorateSingleSupervisorActionShelf(line, theme, hoveredCommand)
}

function decorateSingleSupervisorActionShelf(
  line: string,
  theme: SupervisorTuiTheme,
  hoveredCommand?: string,
): string {
  const separator = '  │  '
  const trimmed = line.trimEnd()
  const framed = trimmed.startsWith('│ ') && trimmed.endsWith(' │')
  const prefix = framed ? '│ ' : ''
  const suffix = framed ? ' │' : ''
  const rawContent = framed ? trimmed.slice(2, -2) : trimmed
  const content = rawContent.trimEnd()
  const trailing = framed
    ? rawContent.slice(content.length)
    : line.slice(trimmed.length)
  const parts = content.split(separator)
  const decorated = parts.map((part, index) => {
    const key = /^(?:[◆·] )?\[ ([^\]]+) \]/u.exec(part)?.[1]
    const hovered = Boolean(key && key === hoveredCommand)
    const semantic = hovered && index === 0
      ? `›${part.slice(1)}`
      : part
    if (hovered) return theme.selected(semantic)
    return semantic.startsWith('◆ ')
      ? theme.actionPrimary(semantic)
      : theme.actionRail(semantic)
  }).reduce((result, part, index) => {
    if (index === 0) return part
    const key = /^(?:[◆·] )?\[ ([^\]]+) \]/u.exec(parts[index] ?? '')?.[1]
    const joiner = key && key === hoveredCommand ? ' │ › ' : separator
    return `${result}${theme.actionRail(joiner)}${part}`
  }, '')
  return `${prefix}${decorated}${theme.actionRail(trailing)}${suffix}`
}

function isSupervisorActionShelf(line: string): boolean {
  return splitFramedColumns(line).some(isSingleSupervisorActionShelf)
}

function isSingleSupervisorActionShelf(line: string): boolean {
  const trimmed = line.trimEnd()
  const content = trimmed.startsWith('│ ') && trimmed.endsWith(' │')
    ? trimmed.slice(2, -2).trimEnd()
    : trimmed
  return /^[◆·] \[ [^\]]+ \] /u.test(content)
}

function splitFramedColumns(line: string): string[] {
  return line.split(/(?<=│) {3}(?=│)/u)
}

function decorateDock(
  line: string,
  theme: SupervisorTuiTheme,
  hoveredCommand?: string,
): string {
  const tokenPattern = /\[ \/ \] (?:Commands|Close)|\[ q \] Detach|\[ i \] .*?(?=  ›  )|! RECOVERY|(?:◉|●) (?:LIVE|EXTERNAL)|○ COLD|◆ (?:BLOCKED|DEGRADED)|◇ OFFLINE|◌ [A-Z][A-Z ]*?(?=  ›  | ─╯)|[◆◇≋✦?] (?:OVERVIEW|FLEET|LOGS|DOCTOR|HELP)/gu
  let output = ''
  let cursor = 0
  for (const match of line.matchAll(tokenPattern)) {
    const offset = match.index
    const token = match[0]
    output += theme.dockRail(line.slice(cursor, offset))
    output += decorateDockToken(token, theme, hoveredCommand)
    cursor = offset + token.length
  }
  output += theme.dockRail(line.slice(cursor))
  return output
}

function decorateDockToken(
  token: string,
  theme: SupervisorTuiTheme,
  hoveredCommand?: string,
): string {
  if (token.startsWith('[ / ]') || token.startsWith('[ q ]')) {
    return decorateDockKeyedToken(token, theme, theme.dockControl, hoveredCommand)
  }
  if (token.startsWith('[ i ]')) {
    return decorateDockKeyedToken(token, theme, theme.dockIdentity, hoveredCommand)
  }
  if (/^[◆◇≋✦?] (?:OVERVIEW|FLEET|LOGS|DOCTOR|HELP)$/u.test(token)) {
    return theme.dockPanel(token)
  }
  if (token.startsWith('● ') || token.startsWith('◉ ')) return theme.dockSuccess(token)
  if (token.startsWith('◆ BLOCKED')) return theme.dockDanger(token)
  if (token.startsWith('◆ ') || token.startsWith('◇ ') || token.startsWith('◌ ') || token.startsWith('! ')) {
    return theme.dockWarning(token)
  }
  if (token.startsWith('○ ')) return theme.dockRail(token)
  return theme.dockPanel(token)
}

function decorateDockKeyedToken(
  token: string,
  theme: SupervisorTuiTheme,
  style: (value: string) => string,
  hoveredCommand?: string,
): string {
  const match = /^\[ ([^\]]+) \]/u.exec(token)
  if (!match?.[1] || match[1] !== hoveredCommand) return style(token)
  return theme.selected(token)
}

function decorateHeader(
  line: string,
  theme: SupervisorTuiTheme,
  introFrame?: number,
  releaseHovered = false,
): string {
  const brands = ['◆ OpenAlice Supervisor', '◆  OpenAlice Supervisor', '◆ OpenAlice']
  const brand = brands.find((candidate) => line.includes(candidate))
  if (!brand) return theme.brand(line, introFrame)
  const brandOffset = line.indexOf(brand)
  const releaseOffset = ['[ u ]', '↗ v']
    .map((marker) => line.indexOf(marker))
    .find((offset) => offset >= 0) ?? -1
  if (releaseOffset < 0) {
    return [
      theme.accent(line.slice(0, brandOffset)),
      theme.brand(brand, introFrame),
      theme.muted(line.slice(brandOffset + brand.length)),
    ].join('')
  }
  const suffixOffset = line.lastIndexOf(' ─╮')
  const releaseEnd = suffixOffset > releaseOffset ? suffixOffset : line.length
  const release = line.slice(releaseOffset, releaseEnd)
  const releaseMarker = release.startsWith('[ u ]') ? '[ u ]' : '↗'
  const decoratedRelease = releaseHovered
    ? theme.navigationHover(release)
    : `${theme.accentStrong(releaseMarker)}${theme.muted(release.slice(releaseMarker.length))}`
  return [
    theme.accent(line.slice(0, brandOffset)),
    theme.brand(brand, introFrame),
    theme.muted(line.slice(brandOffset + brand.length, releaseOffset)),
    decoratedRelease,
    theme.muted(line.slice(releaseEnd)),
  ].join('')
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
    doctor: ['Doctor', 'Doc'],
    help: ['Help'],
  }
  const framed = line.startsWith('│ ') && line.endsWith(' │')
  const contentLine = framed ? line.slice(2, -2) : line
  const parts = contentLine.split(' │ ')
  const decorated = parts.map((part, index) => {
    const content = part.trimEnd()
    const padding = part.slice(content.length)
    const panel = Object.entries(labels).find(([, candidates]) => (
      candidates.some((label) => content.includes(label))
    ))?.[0]
    const style = panel === selectedPanel
      ? theme.selected
      : panel === hoveredPanel
        ? theme.navigationHover
        : theme.navigationRail
    const suffix = index < parts.length - 1 ? ' │ ' : ''
    return [
      style(content),
      padding ? theme.navigationRail(padding) : '',
      suffix ? theme.navigationRail(suffix) : '',
    ].join('')
  }).join('')
  return framed
    ? `${theme.navigationRail('│ ')}${decorated}${theme.navigationRail(' │')}`
    : decorated
}

function decorateNavigationBeaconRail(
  line: string,
  theme: SupervisorTuiTheme,
): string {
  const beacon = line.indexOf('┬')
  if (beacon < 0) return theme.muted(line)
  return `${theme.muted(line.slice(0, beacon))}${theme.accentStrong('┬')}${theme.muted(line.slice(beacon + 1))}`
}
