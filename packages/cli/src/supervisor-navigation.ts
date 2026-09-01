import { displayWidth, truncateDisplayWidth } from './supervisor-display.ts'

export type SupervisorNavigationPanel = 'fleet' | 'overview' | 'logs' | 'doctor' | 'help'

export interface SupervisorNavigationView {
  selected: SupervisorNavigationPanel
  recovery?: boolean
  machineCount?: number
  logCount?: number
  doctor?: {
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
  const items = navigationItems(view)
  const variants = ['wide', 'compact', 'minimal'] as const
  const variant = variants.find((candidate) => (
    displayWidth(renderItems(items, view.selected, candidate)) <= width
  )) ?? 'minimal'
  const targets: SupervisorNavigationTarget[] = []
  let column = 1
  const segments = items.map((item) => {
    const segment = renderItem(item, view.selected, variant)
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
  selected: SupervisorNavigationPanel,
  variant: 'wide' | 'compact' | 'minimal',
): string {
  return items.map((item) => renderItem(item, selected, variant)).join(SEPARATOR)
}

function renderItem(
  item: NavigationItem,
  selected: SupervisorNavigationPanel,
  variant: 'wide' | 'compact' | 'minimal',
): string {
  const label = item[variant]
  const glyph = variant === 'minimal' ? '' : `${item.glyph} `
  return `${glyph}${item.panel === selected ? `[${label}]` : label}${item.badge}`
}

function navigationItems(view: SupervisorNavigationView): NavigationItem[] {
  const items: NavigationItem[] = [
    item('overview', '◆', 'Overview', 'Home', 'Home'),
  ]
  if (!view.recovery) {
    items.push(
      item('fleet', '◇', 'Machines', 'Fleet', 'Fleet', countBadge(view.machineCount)),
      item('logs', '≋', 'Logs', 'Logs', 'Logs', countBadge(view.logCount)),
      item('doctor', '✦', 'Doctor', 'Doctor', 'Doc', doctorBadge(view.doctor)),
    )
  }
  items.push(item('help', '?', 'Help', 'Help', 'Help'))
  return items
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

function doctorBadge(doctor?: SupervisorNavigationView['doctor']): string {
  if (!doctor) return ''
  if (doctor.failures > 0) return `×${doctor.failures}`
  if (doctor.warnings > 0) return `!${doctor.warnings}`
  return '✓'
}
