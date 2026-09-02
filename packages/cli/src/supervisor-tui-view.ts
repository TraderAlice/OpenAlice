import { displayWidth, truncateDisplayWidth } from './supervisor-display.ts'
import { SUPERVISOR_BRAND_MARK_ROWS } from './supervisor-tui-theme.ts'
import type { SupervisorFocusTask } from './supervisor-task-surface.ts'

const SUPERVISOR_SIGNAL_DECK_MIN_WIDTH = 72

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
  primaryHovered?: boolean
  projectHotspot?: boolean
  webHotspot?: boolean
  providerHotspot?: boolean
  hoveredHotspot?: SupervisorHomeHotspotKind
  pulse?: boolean
}

export type SupervisorHomeHotspotKind = 'project' | 'web' | 'provider'

export interface SupervisorHomeTarget {
  row: number
  startColumn: number
  endColumn: number
}

export interface SupervisorHomeHotspotTarget extends SupervisorHomeTarget {
  kind: SupervisorHomeHotspotKind
  input: 'i' | 'o' | 'c'
  surface: string
}

export interface SupervisorHomeRender {
  lines: string[]
  primaryTarget: SupervisorHomeTarget
  hotspotTargets: SupervisorHomeHotspotTarget[]
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
  surface?: string
  primary?: boolean
}

export interface SupervisorSignalScopeFact {
  label: string
  value: string
  compactValue?: string
}

export interface SupervisorSignalScopeView {
  title: string
  meta: string
  glyph: string
  state: string
  facts: readonly [
    SupervisorSignalScopeFact,
    SupervisorSignalScopeFact,
    SupervisorSignalScopeFact,
  ]
  action: {
    key: string
    label: string
    compactLabel?: string
  }
}

export interface SupervisorDockView {
  panel: string
  focusTask?: string
  focusLabel?: string
  projectName?: string
  runtimeState?: string
  pulse?: boolean
  commandPaletteOpen?: boolean
  recovery?: boolean
}

export interface SupervisorContextTipView {
  panel: string
  runtimeState?: string
  recovery?: boolean
}

export interface SupervisorHeaderRender {
  line: string
  releaseTarget?: {
    startColumn: number
    endColumn: number
  }
}

export function renderSupervisorHeader(
  version: string,
  channel: string,
  width: number,
  notice = '',
): string {
  return renderSupervisorHeaderLayout(version, channel, width, notice).line
}

export function renderSupervisorHeaderLayout(
  version: string,
  channel: string,
  width: number,
  notice = '',
  interactiveRelease = true,
): SupervisorHeaderRender {
  const prefix = '╭─ '
  const suffix = ' ─╮'
  const innerWidth = Math.max(1, width - displayWidth(prefix) - displayWidth(suffix))
  const left = width < 54 ? '◆ OpenAlice' : '◆ OpenAlice Supervisor'
  const release = `${interactiveRelease
    ? width >= 72 ? '[ u ]' : '↗'
    : width >= 72 ? '◇ BUILD' : '◇'} v${version} · ${channel.toUpperCase()}${notice}`
  const releaseBudget = width < 54
    ? Math.max(1, innerWidth - displayWidth(left) - 1)
    : Math.max(1, Math.floor(innerWidth / 2))
  const safeRight = truncateDisplayWidth(release, releaseBudget)
  const safeLeft = truncateDisplayWidth(
    left,
    Math.max(1, innerWidth - displayWidth(safeRight) - 1),
  )
  const trackWidth = Math.max(
    0,
    innerWidth - displayWidth(safeLeft) - displayWidth(safeRight),
  )
  const track = trackWidth >= 3
    ? ` ${'─'.repeat(trackWidth - 2)} `
    : ' '.repeat(trackWidth)
  const line = truncateDisplayWidth(`${prefix}${safeLeft}${track}${safeRight}${suffix}`, width)
  const startColumn = displayWidth(prefix) + displayWidth(safeLeft) + displayWidth(track) + 1
  return {
    line,
    ...(interactiveRelease
      ? {
          releaseTarget: {
            startColumn,
            endColumn: startColumn + displayWidth(safeRight) - 1,
          },
        }
      : {}),
  }
}

export function renderSupervisorHome(
  view: SupervisorHomeView,
  width: number,
  targetHeight?: number,
): SupervisorHomeRender {
  const cardWidth = Math.max(24, width)
  const state = stateBadge(view.state, view.pulse ?? false)
  const projectBody = [
    labelAndTail(homeHotspotLabel(view.projectName, 'project', view), state, cardWidth - 4),
    launchIntent(view.state),
    ...view.guidance,
    primaryLaunchRow(view),
  ]
  const details = runtimeDetailRows(view, cardWidth - 4)

  if (width >= 100) return renderWideCockpit(view, state, width, targetHeight)

  const lines = [
    ...renderCard('Launchpad · AliceProject', projectBody, cardWidth),
    '',
    ...renderCard(
      width >= SUPERVISOR_SIGNAL_DECK_MIN_WIDTH
        ? 'Runtime Signal Deck · OpenAlice'
        : 'Runtime signal',
      width >= SUPERVISOR_SIGNAL_DECK_MIN_WIDTH
        ? renderCompactSignalDeck(view, cardWidth - 4)
        : details,
      cardWidth,
    ),
  ]
  return {
    lines,
    primaryTarget: targetForLine(lines, '[ Enter ]', cardWidth),
    hotspotTargets: homeHotspotTargets(lines, view),
  }
}

function renderCompactSignalDeck(
  view: SupervisorHomeView,
  width: number,
): string[] {
  const divider = ' │ '
  const leftWidth = displayWidth(SUPERVISOR_BRAND_MARK_ROWS[0]) + 2
  const rightWidth = Math.max(1, width - leftWidth - displayWidth(divider))
  const identity = [
    ...SUPERVISOR_BRAND_MARK_ROWS.map((mark) => ` ${mark}`),
    ' ◆ LOCAL CONTROL',
    ` ${runtimeSignal(view.state, view.pulse ?? false)}`,
  ]
  const telemetry = runtimeDetailRows(view, rightWidth)
  return Array.from(
    { length: Math.max(identity.length, telemetry.length) },
    (_, index) => (
      `${fillLine(identity[index] ?? '', leftWidth)}${divider}${truncateDisplayWidth(telemetry[index] ?? '', rightWidth)}`
    ),
  )
}

function runtimeDetailRows(view: SupervisorHomeView, width: number): string[] {
  const details = [
    detailRow('Home', view.home, width),
    detailRow(homeHotspotLabel('Web', 'web', view), view.web, width),
    detailRow('Owner', view.owner, width),
    detailRow(homeHotspotLabel('Provider', 'provider', view), view.provider, width),
    detailRow('Services', view.components, width),
  ]
  if (view.uptime) details.push(detailRow('Uptime', view.uptime, width))
  return details
}

function renderWideCockpit(
  view: SupervisorHomeView,
  state: string,
  width: number,
  targetHeight?: number,
): SupervisorHomeRender {
  const gap = 3
  const leftWidth = Math.max(52, Math.floor(width * 0.52))
  const rightWidth = Math.max(1, width - leftWidth - gap)
  const leftInnerWidth = leftWidth - 4
  const rightInnerWidth = rightWidth - 4
  const runtimeBody = [
    labelAndTail('Process', runtimeSignal(view.state, view.pulse ?? false), rightInnerWidth),
    detailRow(homeHotspotLabel('Web', 'web', view), view.web, rightInnerWidth),
    detailRow('Owner', view.owner, rightInnerWidth),
    ...wrappedDetailRows(homeHotspotLabel('Provider', 'provider', view), view.provider, rightInnerWidth),
    detailRow('Services', view.components, rightInnerWidth),
    detailRow('Uptime', view.uptime ?? 'Waiting for Runtime', rightInnerWidth),
  ]
  const projectBody = renderIntegratedWideLaunchpad(view, state, leftInnerWidth)
  while (projectBody.length < runtimeBody.length) projectBody.splice(-1, 0, '')
  while (runtimeBody.length < projectBody.length) runtimeBody.splice(-1, 0, '')
  const context = contextRail('⌂  Home', view.home, width)
  const naturalHeight = projectBody.length + 2 + context.length
  const extraRows = Number.isFinite(targetHeight)
    ? Math.max(0, Math.floor(targetHeight ?? naturalHeight) - naturalHeight)
    : 0
  if (extraRows > 0) {
    const stage = renderWideControlPath(
      view,
      extraRows,
      leftInnerWidth,
      rightInnerWidth,
    )
    projectBody.splice(-1, 0, ...stage.project)
    runtimeBody.splice(-1, 0, ...stage.runtime)
  }
  const project = renderCard('Launchpad · AliceProject', projectBody, leftWidth)
  const runtime = renderCard('Runtime signal', runtimeBody, rightWidth)

  const cards = project.map((line, index) => joinColumns(
    line,
    runtime[index] ?? '',
    leftWidth,
    gap,
    width,
  ))
  const lines = [...cards, ...context]
  return {
    lines,
    primaryTarget: targetForLine(lines, '[ Enter ]', leftWidth),
    hotspotTargets: homeHotspotTargets(lines, view),
  }
}

function renderWideControlPath(
  view: SupervisorHomeView,
  height: number,
  projectWidth: number,
  runtimeWidth: number,
): { project: string[]; runtime: string[] } {
  const project = Array.from({ length: height }, () => '')
  const runtime = Array.from({ length: height }, () => '')
  if (height < 5) return { project, runtime }

  const start = Math.max(0, Math.floor((height - 5) / 2))
  const activeRuntime = view.state === 'running' || view.state === 'owned_elsewhere'
  const routeTrack = renderRouteTrack(
    Math.max(5, Math.min(13, projectWidth - 23)),
    activeRuntime,
    view.pulse ?? false,
  )
  const workspaceTrack = renderRouteTrack(5, activeRuntime, !(view.pulse ?? false))
  const workspace = view.webHotspot ? '↗ WORKSPACE READY' : '◇ WORKSPACE WAITING'
  const projectIdentity = truncateDisplayWidth(view.projectName, Math.max(1, projectWidth - 17))

  project[start] = '◇ CONTROL PATH'
  project[start + 1] = truncateDisplayWidth(`◆ ALICEPROJECT  ${projectIdentity}`, projectWidth)
  project[start + 2] = truncateDisplayWidth(
    `╰${routeTrack} ${runtimeSignal(view.state, view.pulse ?? false)}`,
    projectWidth,
  )
  project[start + 3] = truncateDisplayWidth(
    ` ${' '.repeat(Math.max(2, Math.min(8, projectWidth - 24)))}╰${workspaceTrack} ${workspace}`,
    projectWidth,
  )
  project[start + 4] = truncateDisplayWidth(
    `  PROVIDER  ${view.provider}`,
    projectWidth,
  )

  runtime[start] = '◇ SERVICE ARRAY'
  for (const [index, service] of serviceArray(view.components).entries()) {
    runtime[start + index + 1] = truncateDisplayWidth(service, runtimeWidth)
  }
  runtime[start + 4] = activeRuntime
    ? '  SIGNAL  Runtime report is live'
    : '  SIGNAL  Waiting for Runtime ownership'
  return { project, runtime }
}

function renderRouteTrack(width: number, active: boolean, pulse: boolean): string {
  const track = Array.from({ length: Math.max(3, width) }, () => '━')
  const packet = pulse
    ? Math.max(1, Math.floor(track.length * 0.7))
    : Math.max(1, Math.floor(track.length * 0.3))
  track[Math.min(track.length - 2, packet)] = active ? '◆' : '·'
  return track.join('')
}

function serviceArray(components: string): [string, string, string] {
  const reported = components === 'not reported'
    ? ['Alice not reported', 'UTA not reported', 'Connector not reported']
    : components.split(/\s+·\s+/u)
  return (['Alice', 'UTA', 'Connector'] as const).map((name, index) => {
    const value = reported[index] ?? `${name} not reported`
    const normalized = value.toLowerCase()
    const active = /\b(?:ready|running|connected|healthy)\b/u.test(normalized)
    const unavailable = /\b(?:disabled|unavailable|failed|error)\b/u.test(normalized)
    return `${active ? '◆' : unavailable ? '×' : '◇'} ${value}`
  }) as [string, string, string]
}

function renderIntegratedWideLaunchpad(
  view: SupervisorHomeView,
  state: string,
  width: number,
): string[] {
  const gap = '  '
  const brandWidth = Math.min(
    displayWidth(SUPERVISOR_BRAND_MARK_ROWS[0]) + 2,
    Math.max(1, width - displayWidth(gap) - 1),
  )
  const guidanceWidth = Math.max(1, width - brandWidth - displayWidth(gap))
  const guidance = wrapDisplayText(view.guidance.join(' '), guidanceWidth)
  const brand = [
    ...SUPERVISOR_BRAND_MARK_ROWS.map((mark) => ` ${mark}`),
  ]
  const briefing = Array.from(
    { length: Math.max(brand.length, guidance.length) },
    (_, index) => (
      `${fillLine(brand[index] ?? '', brandWidth)}${gap}${guidance[index] ?? ''}`
    ),
  )
  return [
    labelAndTail(homeHotspotLabel(view.projectName, 'project', view), state, width),
    launchIntent(view.state),
    ...briefing,
    primaryLaunchRow(view),
  ]
}

function homeHotspotLabel(
  label: string,
  kind: SupervisorHomeHotspotKind,
  view: SupervisorHomeView,
): string {
  const enabled = kind === 'project'
    ? view.projectHotspot
    : kind === 'web'
      ? view.webHotspot
      : view.providerHotspot
  if (!enabled) return label
  if (view.hoveredHotspot === kind) return `› ${label}`
  return `${kind === 'project' ? '⌂' : kind === 'web' ? '↗' : '⑂'} ${label}`
}

function homeHotspotTargets(
  lines: string[],
  view: SupervisorHomeView,
): SupervisorHomeHotspotTarget[] {
  const specs: Array<{
    kind: SupervisorHomeHotspotKind
    input: SupervisorHomeHotspotTarget['input']
    enabled: boolean | undefined
    idleMarker: string
    hoveredMarker: string
  }> = [
    {
      kind: 'project',
      input: 'i',
      enabled: view.projectHotspot,
      idleMarker: '⌂ ',
      hoveredMarker: '│ › ',
    },
    {
      kind: 'web',
      input: 'o',
      enabled: view.webHotspot,
      idleMarker: '↗ Web',
      hoveredMarker: '› Web',
    },
    {
      kind: 'provider',
      input: 'c',
      enabled: view.providerHotspot,
      idleMarker: '⑂ Provider',
      hoveredMarker: '› Provider',
    },
  ]
  return specs.flatMap((spec) => {
    if (!spec.enabled) return []
    const marker = view.hoveredHotspot === spec.kind
      ? spec.hoveredMarker
      : spec.idleMarker
    const rowIndex = lines.findIndex((line) => line.includes(marker))
    if (rowIndex < 0) return []
    const line = lines[rowIndex]!
    const markerIndex = line.indexOf(marker)
      + (spec.kind === 'project' && marker.startsWith('│ ') ? 2 : 0)
    const boundary = line.indexOf('│', markerIndex)
    const surfaceEnd = boundary >= 0 ? boundary : line.length
    const surface = line.slice(markerIndex, surfaceEnd)
    const startColumn = displayWidth(line.slice(0, markerIndex)) + 1
    return [{
      kind: spec.kind,
      input: spec.input,
      row: rowIndex + 1,
      startColumn,
      endColumn: startColumn + displayWidth(surface) - 1,
      surface,
    }]
  })
}

function launchIntent(state: string): string {
  if (state === 'running' || state === 'owned_elsewhere') return '● LIVE SESSION · OPEN THE WORKSPACE'
  if (state === 'absent') return '◆ LAUNCH READY · LOCAL RUNTIME'
  if (state === 'incompatible') return '× ATTENTION · REVIEW DOCTOR BEFORE CHANGES'
  return '◇ CHECKING · RUNTIME STATE IS SETTLING'
}

function primaryLaunchRow(view: SupervisorHomeView): string {
  return `${view.primaryHovered ? '›' : '◆'} [ Enter ]  ${view.primaryAction}`
}

function targetForLine(
  lines: string[],
  needle: string,
  endColumn: number,
): SupervisorHomeTarget {
  const index = lines.findIndex((line) => line.includes(needle))
  return {
    row: Math.max(1, index + 1),
    startColumn: 2,
    endColumn: Math.max(2, endColumn - 1),
  }
}

export function renderSupervisorCommandBar(
  commands: SupervisorCommand[],
  width: number,
): string[] {
  const lines: string[] = []
  let current = ''
  for (const command of commands) {
    const inline = `${command.primary ? '◆ ' : ''}[ ${command.key} ] ${command.label}`
    const leading = `${command.primary ? '◆' : '·'} [ ${command.key} ] ${command.label}`
    const candidate = current ? `${current}  │  ${inline}` : leading
    if (current && displayWidth(candidate) > width) {
      lines.push(fillLine(current, width))
      current = leading
    } else {
      current = candidate
    }
  }
  if (current) lines.push(fillLine(current, width))
  return lines.length > 0 ? lines : ['No actions available']
}

export function renderSupervisorFocusActionBar(
  task: Exclude<SupervisorFocusTask, 'confirmation'>,
  width: number,
): string[] {
  const labels: Record<Exclude<SupervisorFocusTask, 'confirmation'>, readonly [string, string, string]> = {
    setup: ['Edit / apply', 'Move field', 'Step back'],
    source: ['Validate / continue', 'Move cursor', 'Step back'],
    projects: ['Choose', 'Move project', 'Step back'],
    release: ['Inspect / continue', 'Move channel', 'Step back'],
    transfer: ['Continue', 'Move choice', 'Step back'],
  }
  const [primary, move, back] = labels[task]
  return renderSupervisorCommandBar([
    { key: 'Enter', label: primary, primary: true },
    { key: '↑↓', label: move },
    { key: 'Esc', label: back },
  ], width)
}

export function renderSupervisorControlConsole(
  activity: string,
  actionLines: string[],
  dock: string,
  width: number,
): string[] {
  const safeWidth = Math.max(1, width)
  const bodyWidth = Math.max(1, safeWidth - 4)
  return [
    controlConsoleCap(activity, safeWidth),
    ...actionLines.map((line) => (
      safeWidth < 4
        ? truncateDisplayWidth(line, safeWidth)
        : `│ ${fillLine(truncateDisplayWidth(line, bodyWidth), bodyWidth)} │`
    )),
    truncateDisplayWidth(dock, safeWidth),
  ]
}

function controlConsoleCap(activity: string, width: number): string {
  if (width < 8) {
    return width === 1
      ? '╭'
      : `╭${'─'.repeat(Math.max(0, width - 2))}╮`
  }
  const contentWidth = width - 4
  const rawContent = activity.trimEnd() || '◇  CONTROL CONSOLE'
  const content = truncateDisplayWidth(rawContent, Math.max(1, contentWidth - 4))
  const trackWidth = Math.max(0, contentWidth - displayWidth(content))
  const track = trackWidth > 0
    ? ` ${'─'.repeat(Math.max(0, trackWidth - 1))}`
    : ''
  return `╭─ ${content}${track}╮`
}

export function renderSupervisorDock(
  view: SupervisorDockView,
  width: number,
): string {
  const breadcrumb = '  ›  '
  const controls = view.focusTask
    ? view.focusTask === 'confirmation'
      ? '◆ DECISION GATE'
      : `◆ FOCUS WORKSPACE${breadcrumb}[ Esc ] Back`
    : view.commandPaletteOpen
      ? `[ / ] Close${breadcrumb}[ q ] Detach`
      : `[ / ] Commands${breadcrumb}[ q ] Detach`
  if (width < 60) return commandSpine(controls, '', width)

  const panel = (view.focusLabel ?? view.focusTask ?? view.panel).toUpperCase()
  const panelIdentity = view.focusLabel ? `◆ ${panel}` : panelBadge(panel)
  if (view.recovery) {
    return commandSpine(controls, `! RECOVERY${breadcrumb}${panelIdentity}`, width)
  }

  const signal = runtimeSignal(view.runtimeState ?? 'unavailable', view.pulse ?? false)
  const fullProjectName = view.projectName ?? 'AliceProject'
  const contextBudget = Math.max(1, width - 6 - displayWidth(controls) - 3)
  const panelSuffix = `${breadcrumb}${panelIdentity}`
  const projectPrefix = view.focusTask ? '⌂ ' : '[ i ] '
  const signalSuffix = `${breadcrumb}${signal}`
  const fullContext = `${projectPrefix}${fullProjectName}${signalSuffix}${panelSuffix}`
  const projectSignal = `${projectPrefix}${fullProjectName}${signalSuffix}`
  const projectNameBudget = contextBudget
    - displayWidth(projectPrefix)
    - displayWidth(signalSuffix)
  const compactProjectSignal = projectNameBudget >= 6
    ? `${projectPrefix}${truncateDisplayWidth(fullProjectName, projectNameBudget)}${signalSuffix}`
    : ''
  const signalPanel = `${signal}${panelSuffix}`
  const context = displayWidth(fullContext) <= contextBudget
    ? fullContext
    : displayWidth(projectSignal) <= contextBudget
      ? projectSignal
      : compactProjectSignal
        ? compactProjectSignal
        : displayWidth(signalPanel) <= contextBudget
          ? signalPanel
          : truncateDisplayWidth(signal, contextBudget)
  return commandSpine(controls, context, width)
}

export function renderSupervisorPanel(
  title: string,
  meta: string,
  rows: string[],
  width: number,
): string[] {
  return renderCard(`${title}${meta ? ` · ${meta}` : ''}`, rows, Math.max(24, width))
}

export function anchorSupervisorControlConsole(
  content: string[],
  consoleLines: string[],
  viewportHeight: number,
  stageContent: string[] = [],
): string[] {
  const naturalHeight = content.length + consoleLines.length
  const safeViewportHeight = Number.isFinite(viewportHeight)
    ? Math.max(0, Math.floor(viewportHeight))
    : naturalHeight
  const stageHeight = Math.max(0, safeViewportHeight - naturalHeight)
  const stage = Array.from({ length: stageHeight }, () => '')
  for (const [index, line] of stageContent.slice(0, Math.max(0, stageHeight - 1)).entries()) {
    stage[index + 1] = line
  }
  return [
    ...content,
    ...stage,
    ...consoleLines,
  ]
}

export function renderSupervisorContextTip(
  view: SupervisorContextTipView,
  width: number,
): string {
  const message = view.recovery
    ? 'Recovery exposes only safe Update and Detach routes.'
    : view.panel === 'fleet'
      ? 'First click focuses a pane; click its selection again to activate it.'
      : view.panel === 'logs'
        ? 'y copies the focused safe event; End returns to the latest.'
        : view.panel === 'doctor'
          ? 'Doctor is read-only; d refreshes checks without changing Runtime.'
          : view.panel === 'help'
            ? '/ searches every available command without leaving this view.'
            : view.runtimeState === 'absent'
              ? 'Enter starts and opens; s starts quietly inside this terminal.'
              : view.runtimeState === 'running' || view.runtimeState === 'owned_elsewhere'
                ? 'Hover an active signal to preview its consequence before clicking.'
                : 'Run Doctor before acting on an uncertain Runtime signal.'
  return truncateDisplayWidth(`◇  Tip: ${message}`, Math.max(1, width))
}

export function renderSupervisorSignalScope(
  view: SupervisorSignalScopeView,
  width: number,
  targetHeight?: number,
): string[] {
  const compact = width < 60
  const rows = [
    compact
      ? `${view.glyph}  ${view.state}`
      : signalScopeRail(view.glyph, view.state, Math.max(1, width - 4)),
    ...view.facts.map((fact) => signalScopeFact(fact, compact)),
    `◆ [ ${view.action.key} ] ${compact
      ? view.action.compactLabel ?? view.action.label
      : view.action.label}`,
  ]
  const naturalHeight = rows.length + 2
  const quietRows = width >= 100 && Number.isFinite(targetHeight)
    ? Math.max(0, Math.floor(targetHeight ?? naturalHeight) - naturalHeight)
    : 0
  if (quietRows > 0) {
    const quietField = Array.from({ length: quietRows }, () => '')
    if (!compact && quietRows >= 7) {
      const echo = signalScopeEcho(view.glyph, Math.max(1, width - 4))
      const start = Math.floor((quietRows - echo.length) / 2)
      quietField.splice(start, echo.length, ...echo)
    }
    rows.splice(-1, 0, ...quietField)
  }
  return renderSupervisorPanel(view.title, view.meta, rows, width)
}

function signalScopeEcho(glyph: string, width: number): string[] {
  return [
    centerDisplayText('·', width),
    centerDisplayText(`· ───── ${glyph} ───── ·`, width),
    centerDisplayText('·', width),
  ]
}

function centerDisplayText(value: string, width: number): string {
  const safe = truncateDisplayWidth(value, Math.max(1, width))
  return `${' '.repeat(Math.max(0, Math.floor((width - displayWidth(safe)) / 2)))}${safe}`
}

export function supervisorCommandTargets(lines: string[]): SupervisorCommandTarget[] {
  const targets: SupervisorCommandTarget[] = []
  for (const [rowIndex, line] of lines.entries()) {
    const dock = supervisorDockTargets(line, rowIndex + 1)
    if (dock.length > 0) {
      targets.push(...dock)
      continue
    }
    const shelf = supervisorActionShelfTargets(line, rowIndex + 1)
    if (shelf.length > 0) {
      targets.push(...shelf)
      continue
    }
    const embeddedShelf = embeddedSupervisorActionShelfTargets(line, rowIndex + 1)
    if (embeddedShelf.length > 0) {
      targets.push(...embeddedShelf)
      continue
    }
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

function supervisorDockTargets(
  line: string,
  row: number,
): SupervisorCommandTarget[] {
  if (!line.startsWith('╰─ ')) return []
  const targets: SupervisorCommandTarget[] = []
  const pattern = /\[ (\/) \] (?:Commands|Close)|\[ (q) \] Detach|\[ (Esc) \] Back|\[ (i) \] .*?(?=  ›  | ─╯)/gu
  for (const match of line.matchAll(pattern)) {
    if (match.index === undefined) continue
    const label = match[1] ?? match[2] ?? match[3] ?? match[4]
    if (!label) continue
    const startColumn = displayWidth(line.slice(0, match.index)) + 1
    targets.push({
      row,
      startColumn,
      endColumn: startColumn + displayWidth(match[0]) - 1,
      label,
      surface: match[0],
    })
  }
  return targets
}

function embeddedSupervisorActionShelfTargets(
  line: string,
  row: number,
): SupervisorCommandTarget[] {
  const match = /[◆·] \[ [^\]]+ \] /u.exec(line)
  if (match?.index === undefined) return []
  const panelEnd = line.lastIndexOf('│')
  if (panelEnd <= match.index) return []
  const content = line.slice(match.index, panelEnd).trimEnd()
  const offset = displayWidth(line.slice(0, match.index))
  return supervisorActionShelfTargets(content, row).map((target) => ({
    ...target,
    startColumn: target.startColumn + offset,
    endColumn: target.endColumn + offset,
  }))
}

function supervisorActionShelfTargets(
  line: string,
  row: number,
): SupervisorCommandTarget[] {
  const trimmed = line.trimEnd()
  const framed = trimmed.startsWith('│ ') && trimmed.endsWith(' │')
  const contentOffset = framed ? 2 : 0
  const body = (framed ? trimmed.slice(2, -2) : trimmed).trimEnd()
  if (!/^[◆·] \[ [^\]]+ \] /u.test(body)) return []
  const parts = body.split('  │  ')
  if (!parts.every((part) => /^(?:[◆·] )?\[ [^\]]+ \] \S/u.test(part))) return []

  const targets: SupervisorCommandTarget[] = []
  let codeUnitOffset = 0
  for (const part of parts) {
    const match = /^([◆·] )?\[ ([^\]]+) \] /u.exec(part)
    if (!match?.[2]) return []
    const startColumn = displayWidth(line.slice(0, contentOffset + codeUnitOffset)) + 1
    targets.push({
      row,
      startColumn,
      endColumn: startColumn + displayWidth(part) - 1,
      label: match[2],
      surface: part,
      primary: match[1] === '◆ ',
    })
    codeUnitOffset += part.length + '  │  '.length
  }
  return targets
}

function renderCard(title: string, body: string[], width: number): string[] {
  const safeWidth = Math.max(12, width)
  const innerWidth = safeWidth - 4
  const titleText = ` ${truncateDisplayWidth(title, Math.max(1, safeWidth - 4))} `
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

function signalScopeRail(glyph: string, state: string, width: number): string {
  const prefix = `${glyph}  ${state}`
  const remaining = Math.max(0, width - displayWidth(prefix) - 2)
  if (remaining < 7) return prefix
  const left = Math.max(1, Math.floor((remaining - 3) / 2))
  const right = Math.max(1, remaining - left - 3)
  return `${prefix}  ·${'─'.repeat(left)}◇${'─'.repeat(right)}·`
}

function signalScopeFact(
  fact: SupervisorSignalScopeView['facts'][number],
  compact: boolean,
): string {
  const labelWidth = compact ? 10 : 11
  const label = compact ? fact.label : fact.label.toUpperCase()
  const safeLabel = truncateDisplayWidth(label, Math.max(1, labelWidth - 1))
  return `${safeLabel}${' '.repeat(Math.max(1, labelWidth - displayWidth(safeLabel)))}${
    compact ? fact.compactValue ?? fact.value : fact.value
  }`
}

function detailRow(label: string, value: string, width: number): string {
  const labelWidth = Math.min(
    Math.max(width < 50 ? 9 : 12, displayWidth(label)),
    Math.max(1, width - 2),
  )
  const safeLabel = truncateDisplayWidth(label, labelWidth)
  const valueWidth = Math.max(1, width - labelWidth - 1)
  return `${safeLabel}${' '.repeat(Math.max(1, labelWidth - displayWidth(safeLabel)))}${truncateDisplayWidth(value, valueWidth)}`
}

function wrappedDetailRows(label: string, value: string, width: number): string[] {
  const labelWidth = Math.min(
    Math.max(width < 50 ? 9 : 12, displayWidth(label)),
    Math.max(1, width - 2),
  )
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

export function wrapDisplayText(value: string, width: number): string[] {
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

function commandSpine(left: string, right: string, width: number): string {
  const prefix = '╰─ '
  if (!right) {
    const suffix = '─╯'
    const innerWidth = Math.max(1, width - displayWidth(prefix) - displayWidth(suffix))
    const safeLeft = truncateDisplayWidth(left, innerWidth)
    const trackWidth = Math.max(0, innerWidth - displayWidth(safeLeft))
    const track = trackWidth >= 2
      ? ` ${'─'.repeat(trackWidth - 1)}`
      : ' '.repeat(trackWidth)
    return truncateDisplayWidth(`${prefix}${safeLeft}${track}${suffix}`, width)
  }
  const suffix = ' ─╯'
  const innerWidth = Math.max(1, width - displayWidth(prefix) - displayWidth(suffix))
  const safeLeft = truncateDisplayWidth(left, innerWidth)
  const remaining = Math.max(0, innerWidth - displayWidth(safeLeft))
  const safeRight = truncateDisplayWidth(right, Math.max(0, remaining - 1))
  const trackWidth = Math.max(0, innerWidth - displayWidth(safeLeft) - displayWidth(safeRight))
  const track = trackWidth >= 3
    ? ` ${'─'.repeat(trackWidth - 2)} `
    : ' '.repeat(trackWidth)
  return truncateDisplayWidth(`${prefix}${safeLeft}${track}${safeRight}${suffix}`, width)
}

function panelBadge(panel: string): string {
  if (panel === 'OVERVIEW') return '◆ OVERVIEW'
  if (panel === 'FLEET') return '◇ FLEET'
  if (panel === 'LOGS') return '≋ LOGS'
  if (panel === 'DOCTOR') return '✦ DOCTOR'
  if (panel === 'HELP') return '? HELP'
  if (panel === 'SETUP') return '◆ SETUP'
  if (panel === 'SOURCE') return '◆ SOURCE'
  if (panel === 'PROJECTS') return '◆ PROJECTS'
  if (panel === 'RELEASE') return '◆ RELEASE'
  if (panel === 'TRANSFER') return '◆ TRANSFER'
  if (panel === 'CONFIRMATION') return '◆ CONFIRMATION'
  return panel
}

function fillLine(value: string, width: number): string {
  const safe = truncateDisplayWidth(value, Math.max(1, width))
  return `${safe}${' '.repeat(Math.max(0, width - displayWidth(safe)))}`
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
