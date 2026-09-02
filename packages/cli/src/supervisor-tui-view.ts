import { displayWidth, truncateDisplayWidth } from './supervisor-display.ts'
import { SUPERVISOR_BRAND_MARK_ROWS } from './supervisor-tui-theme.ts'
import type { SupervisorFocusTask } from './supervisor-task-surface.ts'

export interface SupervisorHomeView {
  projectName: string
  machineName?: string
  targetKind?: 'local' | 'ssh'
  transport?: 'loopback' | 'ssh-forward'
  state: string
  connectionHealth?: 'connected' | 'checking' | 'degraded' | 'unreachable'
  projectAvailable?: boolean
  guidance: string[]
  primaryAction: string
  inboxPrimary?: boolean
  inboxUnread?: number
  recentActivity?: string[]
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
  launcher?: boolean
  focusTask?: string
  focusLabel?: string
  projectName?: string
  machineName?: string
  targetKind?: 'local' | 'ssh'
  transport?: 'loopback' | 'ssh-forward'
  connectionHealth?: 'connected' | 'checking' | 'degraded' | 'unreachable'
  runtimeState?: string
  projectAvailable?: boolean
  pulse?: boolean
  commandPaletteOpen?: boolean
  inputLocked?: boolean
  recovery?: boolean
}

export interface SupervisorContextTipView {
  panel: string
  runtimeState?: string
  targetKind?: 'local' | 'ssh'
  launcher?: boolean
  activeSelection?: boolean
  switchSelection?: boolean
  inputLocked?: boolean
  launchFailure?: boolean
  recovery?: boolean
  itemCount?: number
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
  const state = homeStateBadge(view)
  const lines = width >= 100
    ? renderWideSessionStage(view, state, cardWidth, targetHeight)
    : renderCompactSessionStage(view, state, cardWidth)
  return {
    lines,
    primaryTarget: targetForLine(lines, '[ Enter ]', cardWidth),
    hotspotTargets: homeHotspotTargets(lines, view),
  }
}

function renderWideSessionStage(
  view: SupervisorHomeView,
  state: string,
  width: number,
  targetHeight?: number,
): string[] {
  const innerWidth = width - 4
  const gutter = '    '
  const identityWidth = Math.min(29, Math.max(22, Math.floor(innerWidth * 0.25)))
  const taskWidth = Math.max(1, innerWidth - identityWidth - displayWidth(gutter))
  const identity = wideSessionIdentity(view, state, identityWidth)
  const task = sessionTaskRows(view, taskWidth)
  const naturalBodyHeight = Math.max(identity.length, task.length)
  const requestedBodyHeight = Number.isFinite(targetHeight)
    ? Math.max(naturalBodyHeight, Math.floor(targetHeight ?? 0) - 2)
    : naturalBodyHeight
  const bodyHeight = Math.min(17, requestedBodyHeight)
  const left = centerSessionRows(identity, bodyHeight)
  const right = centerSessionRows(task, bodyHeight)
  const body = Array.from({ length: bodyHeight }, (_, index) => (
    `${fillLine(left[index] ?? '', identityWidth)}${gutter}${truncateDisplayWidth(right[index] ?? '', taskWidth)}`
  ))
  return renderCard('Alice Session · OpenAlice', body, width)
}

function renderCompactSessionStage(
  view: SupervisorHomeView,
  state: string,
  width: number,
): string[] {
  const innerWidth = width - 4
  const guidance = wrapDisplayText(homeGuidance(view).join(' '), innerWidth).slice(0, 2)
  const recent = homeRecentRows(view, innerWidth).slice(0, 1)
  return renderCard('Alice Session · OpenAlice', [
    labelAndTail(homeHotspotLabel(view.projectName, 'project', view), state, innerWidth),
    sessionRoute(view),
    '',
    `NOW  ${homeNowHeadline(view)}`,
    ...guidance,
    '',
    primaryLaunchRow(view),
    '',
    `SIGNALS  ${homeAttentionRow(view)}`,
    `         ${homeConnectionRow(view)}`,
    '',
    `RECENT   ${recent[0] ?? 'No connection changes in this TUI session'}`,
  ], width)
}

function wideSessionIdentity(
  view: SupervisorHomeView,
  state: string,
  width: number,
): string[] {
  const markWidth = displayWidth(SUPERVISOR_BRAND_MARK_ROWS[0])
  const markInset = ' '.repeat(Math.max(0, Math.floor((width - markWidth) / 2)))
  return [
    labelAndTail('ALICEPROJECT', state, width),
    '',
    ...SUPERVISOR_BRAND_MARK_ROWS.map((row) => `${markInset}${row}`),
    '',
    truncateDisplayWidth(homeHotspotLabel(view.projectName, 'project', view), width),
    truncateDisplayWidth(sessionRoute(view), width),
    truncateDisplayWidth(sessionIdentityState(view), width),
  ]
}

function sessionTaskRows(view: SupervisorHomeView, width: number): string[] {
  const guidance = wrapDisplayText(homeGuidance(view).join(' '), width).slice(0, 2)
  const recent = homeRecentRows(view, width).slice(0, 2)
  return [
    'NOW',
    homeNowHeadline(view),
    ...guidance,
    '',
    primaryLaunchRow(view),
    '',
    'SIGNALS',
    homeAttentionRow(view),
    homeConnectionRow(view),
    '',
    'RECENT',
    ...recent,
  ]
}

function homeNowHeadline(view: SupervisorHomeView): string {
  if (view.connectionHealth === 'checking') return 'Checking the active endpoint'
  if (view.connectionHealth === 'degraded') return 'Connection needs a retry'
  if (view.connectionHealth === 'unreachable') return 'Active endpoint is unreachable'
  if (view.inboxPrimary) {
    const count = view.inboxUnread ?? 0
    return `${count} unread ${count === 1 ? 'report needs' : 'reports need'} your attention`
  }
  if (
    view.projectAvailable === false
    && (view.state === 'running' || view.state === 'owned_elsewhere')
  ) return 'Runtime is live; AliceProject home is missing'
  if (view.state === 'running' || view.state === 'owned_elsewhere') return 'Workspace is ready'
  if (view.state === 'absent') return 'Start OpenAlice for this AliceProject'
  if (view.state === 'incompatible') return 'Review Runtime Doctor before changing anything'
  return 'Resolving Runtime state'
}

function homeAttentionRow(view: SupervisorHomeView): string {
  const count = view.inboxUnread ?? 0
  if (count > 0) return `◆ Inbox  ${count} unread ${count === 1 ? 'report' : 'reports'}`
  if (view.state === 'absent') return '◇ Runtime  stopped · ready to launch'
  if (view.state === 'incompatible') return '× Runtime  incompatible owner'
  return '◇ Inbox  clear'
}

function homeConnectionRow(view: SupervisorHomeView): string {
  if (view.connectionHealth === 'checking') return '◌ Connection  checking endpoint'
  if (view.connectionHealth === 'degraded') return '! Connection  degraded'
  if (view.connectionHealth === 'unreachable') return '× Connection  unreachable'
  if (view.state === 'running' || view.state === 'owned_elsewhere') {
    return '● Connection  healthy'
  }
  return '◇ Connection  waiting for Runtime'
}

function homeRecentRows(view: SupervisorHomeView, width: number): string[] {
  const rows = view.recentActivity?.length
    ? view.recentActivity
    : ['· No connection changes in this TUI session']
  return rows.map((row) => truncateDisplayWidth(row, width))
}

function sessionRoute(view: SupervisorHomeView): string {
  const machine = view.machineName ?? 'This computer'
  const transport = view.transport === 'ssh-forward' || view.targetKind === 'ssh'
    ? 'SSH'
    : 'LOCAL'
  return `⌁ ${machine} · ${transport}`
}

function sessionIdentityState(view: SupervisorHomeView): string {
  if (view.connectionHealth === 'checking') return '◌ ENDPOINT CHECK'
  if (view.connectionHealth === 'degraded') return '! DEGRADED'
  if (view.connectionHealth === 'unreachable') return '× UNREACHABLE'
  if (view.state === 'running' || view.state === 'owned_elsewhere') return '● LIVE TARGET'
  if (view.state === 'absent') return '○ READY TO START'
  return '◇ STATE UNKNOWN'
}

function centerSessionRows(rows: string[], height: number): string[] {
  if (rows.length >= height) return rows.slice(0, height)
  const quietRows = Math.max(0, height - rows.length)
  const before = Math.floor(quietRows / 2)
  return [
    ...Array.from({ length: before }, () => ''),
    ...rows,
    ...Array.from({ length: quietRows - before }, () => ''),
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

function homeStateBadge(view: SupervisorHomeView): string {
  if (view.projectAvailable === false && view.state === 'running') {
    return '◆ RUNNING · HOME MISSING'
  }
  if (view.projectAvailable === false && view.state === 'owned_elsewhere') {
    return '◆ EXTERNAL · HOME MISSING'
  }
  return stateBadge(view.state, view.pulse ?? false)
}

function homeGuidance(view: SupervisorHomeView): string[] {
  if (view.inboxPrimary) {
    const count = view.inboxUnread ?? 0
    return [
      `${count} unread ${count === 1 ? 'report is' : 'reports are'} waiting in this AliceProject.`,
      'Enter reviews Inbox; o opens the Web UI.',
    ]
  }
  if (
    view.projectAvailable === false
    && (view.state === 'running' || view.state === 'owned_elsewhere')
  ) {
    return [
      'Runtime is live, but the AliceProject home is missing.',
      'Open still uses the verified Web route.',
    ]
  }
  return view.guidance
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
    ...actionLines.map((line, index) => (
      index === 0
        ? safeWidth < 4
          ? truncateDisplayWidth(line, safeWidth)
          : `╭─ ${fillLine(truncateDisplayWidth(line, bodyWidth), bodyWidth)}╮`
        : safeWidth < 4
          ? truncateDisplayWidth(line, safeWidth)
          : `│ ${fillLine(truncateDisplayWidth(line, bodyWidth), bodyWidth)} │`
    )),
    activity.trim()
      ? dockWithSupervisorActivity(dock, activity, safeWidth)
      : truncateDisplayWidth(dock, safeWidth),
  ]
}

function dockWithSupervisorActivity(
  dock: string,
  activity: string,
  width: number,
): string {
  const match = /^(╰─ .*?(?:\[ q \] Detach|\[ Esc \] Back))/u.exec(dock)
  if (!match?.[1] || width < 16) return truncateDisplayWidth(dock, width)
  const label = activity.trim()
    .replace(/^╭─ /u, '')
    .replace(/ ─+╮$/u, '')
  const joiner = '  ›  '
  const suffix = ' ─╯'
  const budget = Math.max(
    1,
    width - displayWidth(match[1]) - displayWidth(joiner) - displayWidth(suffix),
  )
  const visible = truncateDisplayWidth(label, budget)
  const track = '─'.repeat(Math.max(0, budget - displayWidth(visible)))
  return `${match[1]}${joiner}${visible}${track}${suffix}`
}

export function renderSupervisorDock(
  view: SupervisorDockView,
  width: number,
): string {
  const breadcrumb = '  ›  '
  const controls = view.inputLocked
    ? `◆ OPERATION ACTIVE${breadcrumb}[ q ] Detach`
    : view.focusTask
    ? view.focusTask === 'confirmation'
      ? '◆ DECISION GATE'
      : `◆ FOCUS WORKSPACE${breadcrumb}[ Esc ] Back`
    : view.commandPaletteOpen
      ? `[ / ] Close${breadcrumb}[ q ] Detach`
      : `[ / ] Commands${breadcrumb}[ q ] Detach`
  if (width < 60) return commandSpine(controls, '', width)

  const panel = (view.focusLabel ?? view.focusTask ?? view.panel).toUpperCase()
  const panelIdentity = view.launcher
    ? '◆ LAUNCH'
    : view.focusLabel ? `◆ ${panel}` : panelBadge(panel)
  const compactPanelIdentity = view.launcher || view.focusLabel
    ? panelIdentity
    : compactPanelBadge(panel)
  if (view.recovery) {
    return commandSpine(controls, `! RECOVERY${breadcrumb}${panelIdentity}`, width)
  }

  const signal = view.connectionHealth === 'checking'
    ? '◌ CHECKING'
    : view.connectionHealth === 'degraded'
      ? '! DEGRADED'
      : view.connectionHealth === 'unreachable'
        ? '× UNREACHABLE'
        : runtimeSignal(
            view.runtimeState ?? 'unavailable',
            view.pulse ?? false,
            view.projectAvailable,
          )
  const fullProjectName = view.projectName ?? 'AliceProject'
  const contextBudget = Math.max(1, width - 6 - displayWidth(controls) - 3)
  const contextBreadcrumb = view.launcher ? ' › ' : breadcrumb
  const panelSuffix = `${contextBreadcrumb}${panelIdentity}`
  const projectPrefix = view.focusTask ? '⌂ ' : '[ i ] '
  const targetIdentity = view.launcher
    ? `⌁ ${view.machineName ?? 'Machine'} / ${fullProjectName} · ${view.targetKind === 'ssh' ? 'SSH' : 'LOCAL'}`
    : view.targetKind === 'ssh'
    ? `⌁ ${view.machineName ?? 'Remote'} / ${fullProjectName} · SSH`
    : view.targetKind === 'local'
      ? `⌂ ${view.machineName ?? 'This computer'} / ${view.focusTask ? '' : '[ i ] '}${fullProjectName} · LOCAL`
      : `${projectPrefix}${fullProjectName}`
  const signalSuffix = `${contextBreadcrumb}${signal}`
  const fullContext = `${targetIdentity}${signalSuffix}${panelSuffix}`
  const compactPanelSuffix = `${contextBreadcrumb}${compactPanelIdentity}`
  const compactFullContext = `${targetIdentity}${signalSuffix}${compactPanelSuffix}`
  const projectSignal = `${targetIdentity}${signalSuffix}`
  const projectNameBudget = contextBudget
    - displayWidth(view.launcher
      ? '⌁  · LOCAL'
      : view.targetKind === 'ssh'
      ? '⌁  /  · SSH'
      : view.targetKind === 'local' ? '⌂  / [ i ]  · LOCAL' : projectPrefix)
    - displayWidth(signalSuffix)
  const compactProjectSignal = projectNameBudget >= 6
    ? view.launcher
      ? `⌁ ${truncateDisplayWidth(fullProjectName, projectNameBudget)} · ${view.targetKind === 'ssh' ? 'SSH' : 'LOCAL'}${signalSuffix}`
      : view.targetKind === 'ssh'
      ? `⌁ ${truncateDisplayWidth(`${view.machineName ?? 'Remote'} / ${fullProjectName}`, projectNameBudget)} · SSH${signalSuffix}`
      : view.targetKind === 'local'
        ? `⌂ ${truncateDisplayWidth(`${view.machineName ?? 'This computer'} / ${fullProjectName}`, projectNameBudget)} · LOCAL${signalSuffix}`
        : `${projectPrefix}${truncateDisplayWidth(fullProjectName, projectNameBudget)}${signalSuffix}`
    : ''
  const signalPanel = `${signal}${panelSuffix}`
  const context = displayWidth(fullContext) <= contextBudget
    ? fullContext
    : displayWidth(compactFullContext) <= contextBudget
      ? compactFullContext
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
    : view.inputLocked
      ? 'Operation owns input until ready; q detaches this TUI.'
    : view.launchFailure
      ? 'Enter retries; Esc returns to targets; q detaches this TUI.'
    : view.panel === 'fleet'
      ? view.launcher
        ? '↑↓ selects; Tab/←→ changes pane; click selection again to activate.'
        : view.activeSelection
          ? '←→ changes pane; ↑↓ chooses; Enter returns Home from the active target.'
          : view.switchSelection
            ? '←→ changes pane; Enter switches; current target stays live until ready.'
          : '←→ changes pane; ↑↓ chooses; Enter activates the selected target.'
      : view.panel === 'logs'
        ? view.targetKind === 'ssh'
          ? 'The Chronicle keeps the SSH forward while r checks endpoint health now.'
          : view.itemCount === 0
          ? 'No Runtime events in this lens; l reloads the bounded snapshot.'
          : '↑↓ explores; f filters; y copies; End returns to the latest.'
        : view.panel === 'doctor'
          ? view.itemCount === 0
            ? 'No diagnostic checks in this report; d reruns read-only Doctor.'
            : 'Doctor is read-only; d refreshes checks without changing Runtime.'
          : view.panel === 'help'
            ? '/ searches every available command without leaving this view.'
            : view.panel === 'inbox'
              ? '↑↓ or wheel selects; Enter toggles read state; Home follows unread work.'
              : view.runtimeState === 'absent'
                ? 'Enter starts and opens; s starts quietly inside this terminal.'
                : view.runtimeState === 'running' || view.runtimeState === 'owned_elsewhere'
                  ? 'Enter follows Now; o opens Web; Runtime keeps the diagnostic detail.'
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
  const capped = trimmed.startsWith('╭─ ') && trimmed.endsWith('╮')
  const contentOffset = framed ? 2 : capped ? 3 : 0
  const body = (framed
    ? trimmed.slice(2, -2)
    : capped ? trimmed.slice(3, -1) : trimmed).trimEnd()
  if (!/^[◆·] \[ [^\]]+ \] /u.test(body)) return []
  const parts = body.split('  │  ')
  if (!parts.every((part) => /^(?:[◆·] )?\[ [^\]]+ \] \S/u.test(part))) return []
  const singleActionEnd = parts.length === 1 && (framed || capped)
    ? displayWidth(trimmed) - 1
    : null

  const targets: SupervisorCommandTarget[] = []
  let codeUnitOffset = 0
  for (const part of parts) {
    const match = /^([◆·] )?\[ ([^\]]+) \] /u.exec(part)
    if (!match?.[2]) return []
    const startColumn = displayWidth(line.slice(0, contentOffset + codeUnitOffset)) + 1
    targets.push({
      row,
      startColumn,
      endColumn: singleActionEnd ?? startColumn + displayWidth(part) - 1,
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
  if (panel === 'FLEET') return '◇ CONNECTIONS'
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

function compactPanelBadge(panel: string): string {
  if (panel === 'FLEET') return '◇ CONN'
  return panelBadge(panel)
}

function fillLine(value: string, width: number): string {
  const safe = truncateDisplayWidth(value, Math.max(1, width))
  return `${safe}${' '.repeat(Math.max(0, width - displayWidth(safe)))}`
}

function stateBadge(state: string, pulse: boolean): string {
  const runningGlyph = pulse ? '◉' : '●'
  if (state === 'running') return `${runningGlyph} RUNNING`
  if (state === 'owned_elsewhere') return `${runningGlyph} RUNNING ELSEWHERE`
  if (state === 'absent') return '○ STOPPED'
  if (state === 'incompatible') return '◆ NEEDS ATTENTION'
  if (state === 'unhealthy') return '◆ UNHEALTHY'
  if (state === 'unreachable') return '× UNREACHABLE'
  if (state === 'unavailable') return '◇ UNAVAILABLE'
  return `◌ ${state.toUpperCase()}`
}

function runtimeSignal(state: string, pulse: boolean, projectAvailable?: boolean): string {
  if (projectAvailable === false && state === 'running') return '◆ LIVE · HOME MISSING'
  if (projectAvailable === false && state === 'owned_elsewhere') return '◆ EXTERNAL · HOME MISSING'
  const runningGlyph = pulse ? '◉' : '●'
  if (state === 'running') return `${runningGlyph} LIVE`
  if (state === 'owned_elsewhere') return `${runningGlyph} EXTERNAL`
  if (state === 'absent') return '○ COLD'
  if (state === 'incompatible') return '◆ BLOCKED'
  if (state === 'unhealthy') return '◆ DEGRADED'
  if (state === 'unreachable') return '× UNREACHABLE'
  if (state === 'unavailable') return '◇ OFFLINE'
  return `◌ ${state.toUpperCase()}`
}
