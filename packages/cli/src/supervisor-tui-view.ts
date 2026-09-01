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
  guidance: string[]
  primaryAction: string
  pulse?: boolean
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
  notice = '',
): string {
  const left = '◆  OpenAlice Supervisor'
  const right = `v${version} · ${channel.toUpperCase()}${notice}`
  if (width < 54) return truncateDisplayWidth(`◆ OpenAlice · ${right}`, width)
  return labelAndTail(left, right, width)
}

export function renderSupervisorHome(
  view: SupervisorHomeView,
  width: number,
): string[] {
  const cardWidth = Math.max(24, width)
  const state = stateBadge(view.state, view.pulse ?? false)
  const projectBody = [
    labelAndTail(view.projectName, state, cardWidth - 4),
    ...view.guidance,
    `[ Enter ]  ${view.primaryAction}`,
  ]
  const details = [
    detailRow('Home', view.home, cardWidth - 4),
    detailRow('Web', view.web, cardWidth - 4),
    detailRow('Owner', view.owner, cardWidth - 4),
    detailRow('Provider', view.provider, cardWidth - 4),
    detailRow('Services', view.components, cardWidth - 4),
  ]
  if (view.uptime) details.push(detailRow('Uptime', view.uptime, cardWidth - 4))

  if (width >= 100) return renderWideCockpit(view, state, width)

  return [
    ...renderCard('AliceProject', projectBody, cardWidth),
    '',
    ...renderCard('Runtime', details, cardWidth),
  ]
}

function renderWideCockpit(
  view: SupervisorHomeView,
  state: string,
  width: number,
): string[] {
  const gap = 3
  const leftWidth = Math.max(52, Math.floor(width * 0.52))
  const rightWidth = Math.max(1, width - leftWidth - gap)
  const leftInnerWidth = leftWidth - 4
  const rightInnerWidth = rightWidth - 4
  const runtimeBody = [
    labelAndTail('Process', runtimeSignal(view.state, view.pulse ?? false), rightInnerWidth),
    detailRow('Web', view.web, rightInnerWidth),
    detailRow('Owner', view.owner, rightInnerWidth),
    ...wrappedDetailRows('Provider', view.provider, rightInnerWidth),
    detailRow('Services', view.components, rightInnerWidth),
    detailRow('Uptime', view.uptime ?? 'Waiting for Runtime', rightInnerWidth),
  ]
  const projectBody = [
    labelAndTail(view.projectName, state, leftInnerWidth),
    '',
    ...view.guidance,
    '',
    `◆ [ Enter ]  ${view.primaryAction}`,
  ]
  while (projectBody.length < runtimeBody.length) projectBody.splice(-1, 0, '')
  const project = renderCard('AliceProject', projectBody, leftWidth)
  const runtime = renderCard('Runtime telemetry', runtimeBody, rightWidth)

  const cards = project.map((line, index) => joinColumns(
    line,
    runtime[index] ?? '',
    leftWidth,
    gap,
    width,
  ))
  return [...cards, ...contextRail('⌂  Home', view.home, width)]
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

function wrappedDetailRows(label: string, value: string, width: number): string[] {
  const labelWidth = width < 50 ? 9 : 12
  const chunks = wrapDisplayText(value, Math.max(1, width - labelWidth - 1))
  return chunks.map((chunk, index) => {
    const prefix = index === 0 ? truncateDisplayWidth(label, labelWidth) : ''
    return `${prefix}${' '.repeat(Math.max(1, labelWidth - displayWidth(prefix)))}${chunk}`
  })
}

function contextRail(label: string, value: string, width: number): string[] {
  const labelWidth = displayWidth(label) + 2
  const chunks = wrapDisplayText(value, Math.max(1, width - labelWidth))
  return chunks.map((chunk, index) => (
    `${index === 0 ? label : ''}${' '.repeat(index === 0 ? 2 : labelWidth)}${chunk}`
  ))
}

function wrapDisplayText(value: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of value.split(/\s+/u).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word
    if (displayWidth(candidate) <= width) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    line = ''
    let chunk = ''
    for (const character of word) {
      if (chunk && displayWidth(`${chunk}${character}`) > width) {
        lines.push(chunk)
        chunk = character
      } else {
        chunk += character
      }
    }
    line = chunk
  }
  if (line || lines.length === 0) lines.push(line)
  return lines
}

function labelAndTail(label: string, tail: string, width: number): string {
  const safeTail = truncateDisplayWidth(tail, Math.max(1, Math.floor(width / 2)))
  const tailWidth = displayWidth(safeTail)
  const safeLabel = truncateDisplayWidth(label, Math.max(1, width - tailWidth - 1))
  return `${safeLabel}${' '.repeat(Math.max(1, width - displayWidth(safeLabel) - tailWidth))}${safeTail}`
}

function joinColumns(
  left: string,
  right: string,
  leftWidth: number,
  gap: number,
  width: number,
): string {
  const safeLeft = truncateDisplayWidth(left, leftWidth)
  const combined = `${safeLeft}${' '.repeat(Math.max(0, leftWidth - displayWidth(safeLeft) + gap))}${right}`
  return truncateDisplayWidth(combined, width)
}

function stateBadge(state: string, pulse: boolean): string {
  const runningGlyph = pulse ? '◉' : '●'
  if (state === 'running') return `${runningGlyph} RUNNING`
  if (state === 'owned_elsewhere') return `${runningGlyph} RUNNING ELSEWHERE`
  if (state === 'absent') return '○ STOPPED'
  if (state === 'incompatible') return '◆ NEEDS ATTENTION'
  if (state === 'unhealthy') return '◆ UNHEALTHY'
  if (state === 'unavailable') return '◇ UNAVAILABLE'
  return `◌ ${state.toUpperCase()}`
}

function runtimeSignal(state: string, pulse: boolean): string {
  const runningGlyph = pulse ? '◉' : '●'
  if (state === 'running') return `${runningGlyph} LIVE`
  if (state === 'owned_elsewhere') return `${runningGlyph} EXTERNAL`
  if (state === 'absent') return '○ COLD'
  if (state === 'incompatible') return '◆ BLOCKED'
  if (state === 'unhealthy') return '◆ DEGRADED'
  if (state === 'unavailable') return '◇ OFFLINE'
  return `◌ ${state.toUpperCase()}`
}
