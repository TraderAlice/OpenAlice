import { displayWidth, truncateDisplayWidth } from './supervisor-fleet.ts'
import { renderSupervisorPanel } from './supervisor-tui-view.ts'

export type SupervisorCommandDeckInput =
  | 'enter'
  | 'tab'
  | 's'
  | 'r'
  | 'x'
  | 'l'
  | 'd'
  | 'u'
  | 'i'
  | 'p'
  | '?'

export interface SupervisorCommandDeckContext {
  recovery: boolean
  runtimeState: string
  primaryLabel: string
  primaryAvailable: boolean
  startAvailable: boolean
  restartAvailable: boolean
  stopAvailable: boolean
}

export interface SupervisorCommandDeckItem {
  input: SupervisorCommandDeckInput
  label: string
  description: string
  group: 'Primary' | 'Observe' | 'Manage' | 'Navigate'
  primary?: boolean
}

export interface SupervisorCommandDeckState {
  selected: number
  hovered: number | null
}

export interface SupervisorCommandDeckTarget {
  /** 1-based row inside the rendered panel. */
  row: number
  startColumn: number
  endColumn: number
  index: number
}

export interface SupervisorCommandDeckRender {
  lines: string[]
  targets: SupervisorCommandDeckTarget[]
}

export function createSupervisorCommandDeckState(): SupervisorCommandDeckState {
  return { selected: 0, hovered: null }
}

export function supervisorCommandDeckItems(
  context: SupervisorCommandDeckContext,
): SupervisorCommandDeckItem[] {
  if (context.recovery) {
    return [
      command('u', 'Check for update', 'Choose a release channel and inspect it', 'Primary', true),
      command('?', 'Recovery help', 'Review safe recovery controls', 'Navigate'),
    ]
  }

  const items: SupervisorCommandDeckItem[] = []
  if (context.primaryAvailable) {
    items.push(command(
      'enter',
      context.primaryLabel,
      context.runtimeState === 'absent'
        ? 'Start the selected AliceProject and open its Workspace'
        : 'Open the selected AliceProject Workspace',
      'Primary',
      true,
    ))
  }
  if (context.startAvailable) {
    items.push(command('s', 'Start quietly', 'Start without opening a browser', 'Primary'))
  }
  if (context.restartAvailable) {
    items.push(command('r', 'Restart Runtime', 'Confirm before reconnecting active sessions', 'Primary'))
  }
  if (context.stopAvailable) {
    items.push(command('x', 'Stop Runtime', 'Confirm before disconnecting active sessions', 'Primary'))
  }
  items.push(
    command('l', 'Runtime logs', 'Inspect the bounded, redacted snapshot', 'Observe'),
    command('d', 'Runtime Doctor', 'Run read-only ownership and readiness checks', 'Observe'),
    command('i', 'AliceProjects', 'Select or create a complete local home', 'Manage'),
    command('p', 'Setup', 'Review project and Machine defaults', 'Manage'),
    command('u', 'Update', 'Choose and inspect a release channel', 'Manage'),
    command('tab', 'Next view', 'Move through the Supervisor navigation rail', 'Navigate'),
    command('?', 'Help', 'Open the complete keyboard reference', 'Navigate'),
  )
  return items
}

export function normalizeSupervisorCommandDeckState(
  state: SupervisorCommandDeckState,
  itemCount: number,
): SupervisorCommandDeckState {
  if (itemCount <= 0) return { selected: 0, hovered: null }
  return {
    selected: clamp(state.selected, 0, itemCount - 1),
    hovered: state.hovered === null ? null : clamp(state.hovered, 0, itemCount - 1),
  }
}

export function moveSupervisorCommandDeckSelection(
  state: SupervisorCommandDeckState,
  delta: -1 | 1,
  itemCount: number,
  wrap = true,
): SupervisorCommandDeckState {
  if (itemCount <= 0) return { selected: 0, hovered: null }
  const selected = wrap
    ? (state.selected + delta + itemCount) % itemCount
    : clamp(state.selected + delta, 0, itemCount - 1)
  return { selected, hovered: null }
}

export function renderSupervisorCommandDeck(
  items: readonly SupervisorCommandDeckItem[],
  state: SupervisorCommandDeckState,
  runtimeState: string,
  width: number,
): SupervisorCommandDeckRender {
  const normalized = normalizeSupervisorCommandDeckState(state, items.length)
  const innerWidth = Math.max(1, width - 4)
  const labelColumnWidth = Math.min(
    Math.max(...items.map((item) => displayWidth(commandLabel(item, false, false))), 16),
    Math.max(16, Math.floor(innerWidth * 0.52)),
  )
  const rows = items.map((item, index) => renderCommandRow(
    item,
    index === normalized.selected,
    index === normalized.hovered,
    innerWidth,
    labelColumnWidth,
  ))
  rows.push('', '[ ↑ / ↓ ] Select   [ Enter ] Run   [ / ] Close')
  const lines = renderSupervisorPanel(
    'Command Palette',
    `${normalized.selected + 1}/${Math.max(1, items.length)} · ${runtimeState.toUpperCase()}`,
    rows,
    width,
  )
  return {
    lines,
    targets: items.map((_, index) => ({
      row: index + 2,
      startColumn: 2,
      endColumn: Math.max(2, width - 1),
      index,
    })),
  }
}

function command(
  input: SupervisorCommandDeckInput,
  label: string,
  description: string,
  group: SupervisorCommandDeckItem['group'],
  primary = false,
): SupervisorCommandDeckItem {
  return { input, label, description, group, primary }
}

function renderCommandRow(
  item: SupervisorCommandDeckItem,
  selected: boolean,
  hovered: boolean,
  width: number,
  labelColumnWidth: number,
): string {
  const label = commandLabel(item, selected, hovered)
  const shortcut = commandShortcut(item.input)
  if (width < 58) return labelAndTail(label, shortcut, width)
  const group = `${item.group.toUpperCase()} · ${shortcut}`
  const descriptionWidth = Math.max(1, width - labelColumnWidth - displayWidth(group) - 4)
  const description = truncateDisplayWidth(item.description, descriptionWidth)
  return `${fit(label, labelColumnWidth)}  ${fit(description, descriptionWidth)}  ${group}`
}

function commandLabel(
  item: SupervisorCommandDeckItem,
  selected: boolean,
  hovered: boolean,
): string {
  const marker = selected ? '›' : hovered ? '»' : ' '
  return `${marker} ${item.primary ? '◆ ' : '  '}${item.label}`
}

function commandShortcut(input: SupervisorCommandDeckInput): string {
  if (input === 'enter') return 'ENTER'
  if (input === 'tab') return 'TAB'
  return input.toUpperCase()
}

function labelAndTail(label: string, tail: string, width: number): string {
  const safeTail = truncateDisplayWidth(tail, Math.max(1, Math.floor(width * 0.62)))
  const safeLabel = truncateDisplayWidth(label, Math.max(1, width - displayWidth(safeTail) - 1))
  return `${safeLabel}${' '.repeat(Math.max(1, width - displayWidth(safeLabel) - displayWidth(safeTail)))}${safeTail}`
}

function fit(value: string, width: number): string {
  const safe = truncateDisplayWidth(value, width)
  return `${safe}${' '.repeat(Math.max(0, width - displayWidth(safe)))}`
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}
