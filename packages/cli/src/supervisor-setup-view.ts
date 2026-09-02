import { displayWidth, truncateDisplayWidth } from './supervisor-display.ts'
import {
  decorateSupervisorActionShelf,
  type SupervisorTuiTheme,
} from './supervisor-tui-theme.ts'
import { renderSupervisorPanel, wrapDisplayText } from './supervisor-tui-view.ts'

export type SupervisorSetupItemKind = 'choice' | 'editor' | 'readonly'

export interface SupervisorSetupItem {
  id: string
  label: string
  value: string
  description: string
  kind: SupervisorSetupItemKind
}

export interface SupervisorSetupTarget {
  row: number
  startColumn: number
  endColumn: number
  index: number
}

export interface SupervisorSetupRender {
  lines: string[]
  targets: SupervisorSetupTarget[]
}

export interface SupervisorSetupView {
  projectName: string
  scope: string
  runtimeClass?: string
  message: string
  items: SupervisorSetupItem[]
  selected: number
}

export type SupervisorSetupEditorPhase = 'edit' | 'error'

export interface SupervisorSetupWorkbenchView {
  phase: SupervisorSetupEditorPhase
  projectName: string
  scope: string
  fieldTitle: string
  fieldPosition: string
  runtimeClass?: string
  fieldLines: string[]
  detail: string
  message: string
}

export function renderSupervisorSetupStudio(
  view: SupervisorSetupView,
  width: number,
): SupervisorSetupRender {
  const selected = clamp(view.selected, 0, Math.max(0, view.items.length - 1))
  const item = view.items[selected]
  if (!item) {
    return {
      lines: renderSupervisorPanel('Setup Studio', view.projectName, [
        'No settings are available.',
        '◆ [ Esc ] Done',
      ], width),
      targets: [],
    }
  }

  const wide = width >= 92
  const gap = 3
  const listWidth = wide ? Math.max(42, Math.floor(width * 0.48)) : width
  const detailWidth = wide ? Math.max(36, width - listWidth - gap) : width
  const listInnerWidth = Math.max(1, listWidth - 4)
  const listRows = view.items.map((candidate, index) => {
    const marker = index === selected ? '›' : ' '
    const capability = candidate.kind === 'editor'
      ? 'EDIT'
      : candidate.kind === 'choice' ? 'CYCLE' : 'READ'
    return labelAndTail(`${marker} ${candidate.label}`, capability, listInnerWidth)
  })
  const action = item.kind === 'editor'
    ? '◆ [ Enter ] Edit value  │  [ Esc ] Done'
    : item.kind === 'choice'
      ? '◆ [ Enter ] Cycle value  │  [ Esc ] Done'
      : '◆ [ Esc ] Done'
  const description = wrapDisplayText(item.description, Math.max(1, detailWidth - 4)).slice(0, 2)
  const detailRows = [
    `◆ ${item.label} · ${selected + 1}/${view.items.length}`,
    `Current · ${item.value}`,
    ...description,
  ]
  while (detailRows.length < 4) detailRows.push('')
  detailRows.push(action)

  const layer = `${view.scope.toUpperCase()} LAYER`
  const runtime = runtimeLabel(view.runtimeClass)
  const statusRows = wrapDisplayText(view.message, Math.max(1, width - 4)).slice(0, 2)

  if (wide) {
    const bodyHeight = Math.max(listRows.length, detailRows.length)
    const left = renderSupervisorPanel(
      'Setup Studio',
      view.projectName,
      padRows(listRows, bodyHeight),
      listWidth,
    )
    const right = renderSupervisorPanel(
      'Inspection',
      `${selected + 1}/${view.items.length} · ${runtime}`,
      padRows(detailRows, bodyHeight),
      detailWidth,
    )
    return {
      lines: [
        ...left.map((line, index) => joinColumns(
          line,
          right[index] ?? '',
          listWidth,
          gap,
          width,
        )),
        '',
        ...renderSupervisorPanel('Setup status', layer, statusRows, width),
      ],
      targets: view.items.map((_, index) => ({
        row: index + 2,
        startColumn: 2,
        endColumn: listWidth - 1,
        index,
      })),
    }
  }

  const list = renderSupervisorPanel(
    'Setup Studio',
    `${view.projectName} · ${layer} · ${runtime}`,
    listRows,
    width,
  )
  const detail = renderSupervisorPanel(
    'Inspection',
    `${selected + 1}/${view.items.length}`,
    detailRows,
    width,
  )
  const compactStatusRows = wrapDisplayText(
    `${layer} · ${view.message}`,
    Math.max(1, width - 2),
  ).slice(0, 2).map((line, index) => `${index === 0 ? '◇' : ' '} ${line}`)
  return {
    lines: [
      ...list,
      '',
      ...detail,
      ...compactStatusRows.map((line) => truncateDisplayWidth(line, width)),
    ],
    targets: view.items.map((_, index) => ({
      row: index + 2,
      startColumn: 2,
      endColumn: Math.max(2, width - 1),
      index,
    })),
  }
}

export function supervisorSetupWorkbenchFieldWidth(width: number): number {
  const safeWidth = Math.max(24, width)
  return safeWidth >= 92
    ? Math.max(1, safeWidth - 36 - 3 - 4)
    : Math.max(1, safeWidth - 4)
}

export function renderSupervisorSetupWorkbench(
  view: SupervisorSetupWorkbenchView,
  width: number,
): string[] {
  const safeWidth = Math.max(24, width)
  const error = view.phase === 'error'
  const signal = error ? 'FIX' : 'EDIT'
  const layer = `${view.scope.toUpperCase()} LAYER`
  const scopeLabel = view.scope.toLowerCase().startsWith('machine') ? 'MACHINE' : 'PROJECT'
  const routeRows = [
    labelAndTail(`${error ? '!' : '◆'} 01 Edit`, error ? 'RETRY' : 'CURRENT', 32),
    labelAndTail('· 02 Validate', 'NEXT', 32),
    labelAndTail('· 03 Save', error ? 'BLOCKED' : 'NEXT', 32),
    '',
    `Layer · ${view.scope}`,
    `Project · ${view.projectName}`,
    `Field · ${view.fieldPosition}`,
  ]
  const inspectorRows = [
    `◆ ${view.fieldTitle}`,
    ...view.fieldLines,
    '',
    view.detail,
    '',
    '◆ [ Enter ] Validate & save  │  [ Esc ] Cancel',
  ]

  if (safeWidth >= 92) {
    const contextWidth = 36
    const gap = 3
    const inspectorWidth = safeWidth - contextWidth - gap
    const height = Math.max(routeRows.length, inspectorRows.length)
    const context = renderSupervisorPanel(
      'Layer Context',
      `${scopeLabel} · ${signal}`,
      padRows(routeRows, height),
      contextWidth,
    )
    const inspector = renderSupervisorPanel(
      'Field Inspector',
      `${view.fieldPosition} · ${runtimeLabel(view.runtimeClass)}`,
      padRows(inspectorRows, height),
      inspectorWidth,
    )
    return [
      ...context.map((line, index) => joinColumns(
        line,
        inspector[index] ?? '',
        contextWidth,
        gap,
        safeWidth,
      )),
      '',
      ...renderSupervisorPanel('Inheritance contract', layer, [view.message], safeWidth),
    ]
  }

  const route = error
    ? '! Edit  → Validate  · Save'
    : '◆ Edit  → Validate  → Save'
  return [
    ...renderSupervisorPanel('Setup Workbench', `${scopeLabel} · ${signal}`, [route], safeWidth),
    '',
    ...renderSupervisorPanel(
      'Field Inspector',
      `${view.fieldPosition} · ${runtimeLabel(view.runtimeClass)}`,
      inspectorRows,
      safeWidth,
    ),
    '',
    truncateDisplayWidth(`◆ INHERITANCE · ${view.message}`, safeWidth),
  ]
}

export function decorateSupervisorSetupWorkbench(
  lines: string[],
  theme: SupervisorTuiTheme,
  hoveredCommand?: string,
): string[] {
  const action = '◆ [ Enter ] Validate & save  │  [ Esc ] Cancel'
  return lines.map((line) => {
    if (line.includes(action)) {
      return line.replace(action, decorateSupervisorActionShelf(action, theme, hoveredCommand))
    }
    if (!theme.enabled) return line
    if (line.startsWith('╭')) return theme.accent(line)
    if (line.startsWith('╰')) return theme.muted(line)
    if (line.startsWith('│ ! ')) return decorateLeftPanel(line, theme.danger)
    if (line.startsWith('│ ◆ ')) return decorateLeftPanel(line, theme.accentStrong)
    return line
  })
}

export function decorateSupervisorSetupStudio(
  lines: string[],
  theme: SupervisorTuiTheme,
  hoveredCommand?: string,
): string[] {
  const actions = [
    '◆ [ Enter ] Edit value  │  [ Esc ] Done',
    '◆ [ Enter ] Cycle value  │  [ Esc ] Done',
    '◆ [ Esc ] Done',
  ]
  return lines.map((line) => {
    const action = actions.find((candidate) => line.includes(candidate))
    if (action) {
      return line.replace(action, decorateSupervisorActionShelf(action, theme, hoveredCommand))
    }
    if (!theme.enabled) return line
    if (line.includes('│ › ')) return theme.selected(line)
    if (line.includes('│ ◆ ')) return theme.accentStrong(line)
    if (line.startsWith('╭')) return theme.accent(line)
    if (line.startsWith('╰')) return theme.muted(line)
    if (line.includes('● LIVE')) return theme.success(line)
    if (line.includes('◆ ATTENTION')) return theme.danger(line)
    if (line.includes('○ STOPPED') || line.includes('◌ CHECKING')) return theme.muted(line)
    return line
  })
}

function runtimeLabel(runtimeClass?: string): string {
  if (runtimeClass === 'running') return '● LIVE'
  if (runtimeClass === 'owned_elsewhere') return '● EXTERNAL'
  if (runtimeClass === 'absent') return '○ STOPPED'
  if (runtimeClass === 'incompatible' || runtimeClass === 'unhealthy') return '◆ ATTENTION'
  return '◌ CHECKING'
}

function labelAndTail(label: string, tail: string, width: number): string {
  const safeTail = truncateDisplayWidth(tail, Math.max(1, Math.floor(width / 3)))
  const tailWidth = displayWidth(safeTail)
  const safeLabel = truncateDisplayWidth(label, Math.max(1, width - tailWidth - 1))
  const gap = Math.max(1, width - displayWidth(safeLabel) - tailWidth)
  return `${safeLabel}${' '.repeat(gap)}${safeTail}`
}

function padRows(rows: string[], height: number): string[] {
  return [...rows, ...Array.from({ length: Math.max(0, height - rows.length) }, () => '')]
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

function decorateLeftPanel(line: string, decorate: (value: string) => string): string {
  const boundary = line.indexOf('│', 1)
  if (boundary < 0) return decorate(line)
  return `${decorate(line.slice(0, boundary + 1))}${line.slice(boundary + 1)}`
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}
