import { displayWidth, truncateDisplayWidth } from './supervisor-fleet.ts'

export interface SupervisorHomeView {
  projectName: string
  state: string
  home: string
  web: string
  owner: string
  provider: string
  components: string
  uptime?: string
  guidance: string
  primaryAction: string
}

export interface SupervisorCommand {
  key: string
  label: string
  primary?: boolean
}

export interface SupervisorCommandTarget {
  row: number
  startColumn: number
  endColumn: number
  label: string
}

export function renderSupervisorHeader(
  version: string,
  channel: string,
  width: number,
): string {
  const left = '◆  OpenAlice Supervisor'
  const right = `v${version} · ${channel.toUpperCase()}`
  if (width < 54) return truncateDisplayWidth(`◆ OpenAlice · ${right}`, width)
  return labelAndTail(left, right, width)
}

export function renderSupervisorHome(
  view: SupervisorHomeView,
  width: number,
): string[] {
  const cardWidth = Math.max(24, width)
  const state = stateBadge(view.state)
  const hero = renderCard('AliceProject', [
    labelAndTail(view.projectName, state, cardWidth - 4),
    view.guidance,
    `[ Enter ]  ${view.primaryAction}`,
  ], cardWidth)
  const details = [
    detailRow('Home', view.home, cardWidth - 4),
    detailRow('Web', view.web, cardWidth - 4),
    detailRow('Owner', view.owner, cardWidth - 4),
    detailRow('Provider', view.provider, cardWidth - 4),
    detailRow('Services', view.components, cardWidth - 4),
  ]
  if (view.uptime) details.push(detailRow('Uptime', view.uptime, cardWidth - 4))
  return [
    ...hero,
    '',
    ...renderCard('Runtime', details, cardWidth),
  ]
}

export function renderSupervisorCommandBar(
  commands: SupervisorCommand[],
  width: number,
): string[] {
  const rendered = commands.map((command) => `${command.primary ? '◆ ' : ''}[ ${command.key} ] ${command.label}`)
  const lines: string[] = []
  let current = ''
  for (const command of rendered) {
    const candidate = current ? `${current}   ${command}` : command
    if (current && displayWidth(candidate) > width) {
      lines.push(current)
      current = command
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : ['No actions available']
}

export function renderSupervisorPanel(
  title: string,
  meta: string,
  rows: string[],
  width: number,
): string[] {
  return renderCard(`${title}${meta ? ` · ${meta}` : ''}`, rows, Math.max(24, width))
}

export function supervisorCommandTargets(lines: string[]): SupervisorCommandTarget[] {
  const targets: SupervisorCommandTarget[] = []
  for (const [rowIndex, line] of lines.entries()) {
    for (const match of line.matchAll(/\[ ([^\]]+) \]/gu)) {
      if (match.index === undefined || !match[1]) continue
      const startColumn = displayWidth(line.slice(0, match.index)) + 1
      targets.push({
        row: rowIndex + 1,
        startColumn,
        endColumn: startColumn + displayWidth(match[0]) - 1,
        label: match[1],
      })
    }
  }
  return targets
}

function renderCard(title: string, body: string[], width: number): string[] {
  const safeWidth = Math.max(12, width)
  const innerWidth = safeWidth - 4
  const titleText = ` ${title} `
  const topFill = Math.max(0, safeWidth - displayWidth(titleText) - 2)
  return [
    `╭${titleText}${'─'.repeat(topFill)}╮`,
    ...body.map((line) => {
      const text = truncateDisplayWidth(line, innerWidth)
      return `│ ${text}${' '.repeat(Math.max(0, innerWidth - displayWidth(text)))} │`
    }),
    `╰${'─'.repeat(Math.max(0, safeWidth - 2))}╯`,
  ]
}

function detailRow(label: string, value: string, width: number): string {
  const labelWidth = width < 50 ? 9 : 12
  const safeLabel = truncateDisplayWidth(label, labelWidth)
  const valueWidth = Math.max(1, width - labelWidth - 1)
  return `${safeLabel}${' '.repeat(Math.max(1, labelWidth - displayWidth(safeLabel)))}${truncateDisplayWidth(value, valueWidth)}`
}

function labelAndTail(label: string, tail: string, width: number): string {
  const safeTail = truncateDisplayWidth(tail, Math.max(1, Math.floor(width / 2)))
  const tailWidth = displayWidth(safeTail)
  const safeLabel = truncateDisplayWidth(label, Math.max(1, width - tailWidth - 1))
  return `${safeLabel}${' '.repeat(Math.max(1, width - displayWidth(safeLabel) - tailWidth))}${safeTail}`
}

function stateBadge(state: string): string {
  if (state === 'running') return '● RUNNING'
  if (state === 'owned_elsewhere') return '● RUNNING ELSEWHERE'
  if (state === 'absent') return '○ STOPPED'
  if (state === 'incompatible') return '◆ NEEDS ATTENTION'
  if (state === 'unhealthy') return '◆ UNHEALTHY'
  if (state === 'unavailable') return '◇ UNAVAILABLE'
  return `◌ ${state.toUpperCase()}`
}
