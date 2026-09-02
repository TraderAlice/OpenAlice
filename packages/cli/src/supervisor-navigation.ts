import { displayWidth, truncateDisplayWidth } from './supervisor-display.ts'
import type { SupervisorFocusTask } from './supervisor-task-surface.ts'

export type SupervisorNavigationPanel = 'fleet' | 'overview' | 'inbox' | 'logs' | 'doctor' | 'help'

export interface SupervisorNavigationView {
  selected: SupervisorNavigationPanel
  focusTask?: SupervisorFocusTask
  confirmation?: {
    confirmLabel: string
    cancelLabel: string
  }
  recovery?: boolean
  connected?: boolean
  connectionHealth?: 'connected' | 'checking' | 'degraded' | 'unreachable'
  inboxUnread?: number
  machineCount?: number
  logCount?: number
  doctor?: {
    checks: number
    failures: number
    warnings: number
  }
}

export interface SupervisorNavigationTarget {
  panel: SupervisorNavigationPanel
  startColumn: number
  endColumn: number
}

export interface SupervisorNavigationLayout {
  line: string
  targets: SupervisorNavigationTarget[]
}

interface NavigationItem {
  panel: SupervisorNavigationPanel
  glyph: string
  wide: string
  compact: string
  minimal: string
  badge: string
}

const SEPARATOR = ' │ '

export function renderSupervisorNavigation(
  view: SupervisorNavigationView,
  width: number,
): SupervisorNavigationLayout {
  if (view.focusTask) return renderFocusHeader(view.focusTask, width, view.confirmation)
  const items = navigationItems(view)
  const variants = ['wide', 'compact', 'minimal'] as const
  const selected = view.selected
  const variant = variants.find((candidate) => (
    displayWidth(renderItems(items, selected, candidate)) <= width
  )) ?? 'minimal'
  const targets: SupervisorNavigationTarget[] = []
  let column = 1
  const segments = items.map((item) => {
    const segment = renderItem(item, selected, variant)
    const segmentWidth = displayWidth(segment)
    const visibleWidth = Math.max(0, Math.min(segmentWidth, width - column + 1))
    if (visibleWidth > 0) {
      targets.push({
        panel: item.panel,
        startColumn: column,
        endColumn: column + visibleWidth - 1,
      })
    }
    column += segmentWidth + displayWidth(SEPARATOR)
    return segment
  })
  const content = truncateDisplayWidth(segments.join(SEPARATOR), width)
  return {
    line: content.padEnd(width, ' '),
    targets,
  }
}

function renderFocusHeader(
  task: SupervisorFocusTask,
  width: number,
  confirmation?: SupervisorNavigationView['confirmation'],
): SupervisorNavigationLayout {
  const definition: Record<SupervisorFocusTask, {
    title: string
    compact: string
    contract: string
  }> = {
    setup: {
      title: 'SETUP STUDIO',
      compact: 'SETUP',
      contract: 'INSPECT · EDIT · VALIDATE · SAVE',
    },
    source: {
      title: 'SOURCE LAUNCH BAY',
      compact: 'SOURCE',
      contract: 'SELECT · VALIDATE · SAVE · LAUNCH',
    },
    projects: {
      title: 'ALICEPROJECT SWITCHBOARD',
      compact: 'PROJECTS',
      contract: 'INSPECT · SELECT OR CREATE · REMEMBER',
    },
    release: {
      title: 'RELEASE OBSERVATORY',
      compact: 'RELEASE',
      contract: 'CHOOSE · PROBE · CONFIRM · INSTALL',
    },
    transfer: {
      title: 'TRANSFER FLIGHT DECK',
      compact: 'TRANSFER',
      contract: '8-STAGE GUARDED MIGRATION',
    },
    confirmation: {
      title: 'DECISION GATE',
      compact: 'CONFIRM',
      contract: 'REVIEW IMPACT · CONFIRM OR CANCEL',
    },
  }
  const current = task === 'confirmation' && confirmation
    ? {
        title: 'DECISION GATE',
        compact: confirmation.confirmLabel.toUpperCase(),
        contract: 'REVIEW IMPACT',
      }
    : definition[task]
  const identity = task === 'confirmation' && confirmation
    ? confirmation.confirmLabel.toUpperCase()
    : task.toUpperCase()
  const back = task === 'confirmation'
    ? `[ Esc ] ${confirmation?.cancelLabel ?? 'Cancel'}`
    : '[ Esc ] Back'
  const candidates = [
    `◆ FOCUS · ${identity}  │  ${current.title}  │  ${current.contract}`,
    `◆ FOCUS · ${identity}  │  ${current.title}`,
    `◆ ${current.compact}`,
  ]
  const available = Math.max(1, width - displayWidth(back) - 2)
  const left = candidates.find((candidate) => displayWidth(candidate) <= available)
    ?? truncateDisplayWidth(candidates.at(-1)!, available)
  const gap = Math.max(1, width - displayWidth(left) - displayWidth(back))
  return {
    line: truncateDisplayWidth(`${left}${' '.repeat(gap)}${back}`, width).padEnd(width, ' '),
    targets: [],
  }
}

export function supervisorNavigationPanelAt(
  targets: SupervisorNavigationTarget[],
  column: number,
): SupervisorNavigationPanel | undefined {
  return targets.find((target) => (
    column >= target.startColumn && column <= target.endColumn
  ))?.panel
}

function renderItems(
  items: NavigationItem[],
  selected: SupervisorNavigationPanel | undefined,
  variant: 'wide' | 'compact' | 'minimal',
): string {
  return items.map((item) => renderItem(item, selected, variant)).join(SEPARATOR)
}

function renderItem(
  item: NavigationItem,
  selected: SupervisorNavigationPanel | undefined,
  variant: 'wide' | 'compact' | 'minimal',
): string {
  const label = item[variant]
  const glyph = variant === 'minimal' ? '' : `${item.glyph} `
  return `${glyph}${item.panel === selected ? `[${label}]` : label}${item.badge}`
}

function navigationItems(view: SupervisorNavigationView): NavigationItem[] {
  if (view.recovery) {
    return [
      item('overview', '◆', 'Recovery', 'Recovery', 'Fix'),
      item('help', '?', 'Help', 'Help', 'Help'),
    ]
  }
  if (view.connected === false) {
    return [
      item('fleet', '◆', 'Connect', 'Connect', 'Connect', countBadge(view.machineCount)),
      item('help', '?', 'Help', 'Help', 'Help'),
    ]
  }
  return [
    item('overview', '◆', 'Home', 'Home', 'Home', connectionBadge(view.connectionHealth)),
    item('inbox', '●', 'Inbox', 'Inbox', 'Inbox', countBadge(view.inboxUnread)),
    item('fleet', '◇', 'Connections', 'Connect', 'Link', countBadge(view.machineCount)),
    item('logs', '≋', 'Runtime', 'Runtime', 'Run', countBadge(view.logCount)),
  ]
}

function item(
  panel: SupervisorNavigationPanel,
  glyph: string,
  wide: string,
  compact: string,
  minimal: string,
  badge = '',
): NavigationItem {
  return { panel, glyph, wide, compact, minimal, badge }
}

function countBadge(count?: number): string {
  return count && count > 0 ? `·${count}` : ''
}

function connectionBadge(health?: SupervisorNavigationView['connectionHealth']): string {
  if (health === 'checking') return '·…'
  if (health === 'degraded') return '·!'
  if (health === 'unreachable') return '·×'
  return ''
}
