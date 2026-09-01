/**
 * Overlay hit routing follows the MIT-licensed Oh My Pi list interaction
 * model. Position resolution intentionally mirrors the installed pi-tui
 * compositor so rendered rows and pointer coordinates share one origin.
 */

import type { SupervisorPointerEvent } from './supervisor-tui-pointer.ts'
import { supervisorCommandTargets } from './supervisor-tui-view.ts'

export interface SupervisorOverlayOptions {
  width?: number | `${number}%`
  maxHeight?: number | `${number}%`
  anchor?: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center' | 'left-center' | 'right-center'
  offsetX?: number
  offsetY?: number
  margin?: number | { top?: number; right?: number; bottom?: number; left?: number }
}

export interface SupervisorOverlayListTarget {
  firstRow: number
  indexes: number[]
  startColumn?: number
  endColumn?: number
  select(index: number): void
  activate(): void
  move(delta: -1 | 1): void
}

export interface SupervisorOverlayPointerFrame {
  lines: string[]
  width: number
  terminalWidth: number
  terminalHeight: number
  options: SupervisorOverlayOptions
  list?: SupervisorOverlayListTarget
  hoverCommand?(label?: string): void
  input(data: string): void
}

interface ResolvedOverlayFrame extends SupervisorOverlayPointerFrame {
  col: number
  row: number
  height: number
}

const commandInput = (label: string): string | undefined => {
  const normalized = label.trim().toLowerCase()
  if (normalized === 'enter') return '\r'
  if (normalized === 'esc' || normalized === 'escape') return '\u001b'
  if (normalized === 'space') return ' '
  return normalized.length === 1 ? normalized : undefined
}

const marginEdges = (margin: SupervisorOverlayOptions['margin']) => {
  if (typeof margin === 'number') {
    const value = Math.max(0, margin)
    return { top: value, right: value, bottom: value, left: value }
  }
  return {
    top: Math.max(0, margin?.top ?? 0),
    right: Math.max(0, margin?.right ?? 0),
    bottom: Math.max(0, margin?.bottom ?? 0),
    left: Math.max(0, margin?.left ?? 0),
  }
}

function anchorRow(
  anchor: NonNullable<SupervisorOverlayOptions['anchor']>,
  height: number,
  available: number,
  margin: number,
): number {
  switch (anchor) {
    case 'top-left':
    case 'top-center':
    case 'top-right':
      return margin
    case 'bottom-left':
    case 'bottom-center':
    case 'bottom-right':
      return margin + available - height
    default:
      return margin + Math.floor((available - height) / 2)
  }
}

function anchorColumn(
  anchor: NonNullable<SupervisorOverlayOptions['anchor']>,
  width: number,
  available: number,
  margin: number,
): number {
  switch (anchor) {
    case 'top-left':
    case 'left-center':
    case 'bottom-left':
      return margin
    case 'top-right':
    case 'right-center':
    case 'bottom-right':
      return margin + available - width
    default:
      return margin + Math.floor((available - width) / 2)
  }
}

export function resolveSupervisorOverlayPosition(
  width: number,
  height: number,
  terminalWidth: number,
  terminalHeight: number,
  options: SupervisorOverlayOptions,
): { col: number; row: number } {
  const margin = marginEdges(options.margin)
  const availableWidth = Math.max(1, terminalWidth - margin.left - margin.right)
  const availableHeight = Math.max(1, terminalHeight - margin.top - margin.bottom)
  const effectiveWidth = Math.max(1, Math.min(width, availableWidth))
  const effectiveHeight = Math.max(1, Math.min(height, availableHeight))
  const anchor = options.anchor ?? 'center'
  const rawRow = anchorRow(anchor, effectiveHeight, availableHeight, margin.top)
    + (options.offsetY ?? 0)
  const rawCol = anchorColumn(anchor, effectiveWidth, availableWidth, margin.left)
    + (options.offsetX ?? 0)
  return {
    row: Math.max(margin.top, Math.min(rawRow, terminalHeight - margin.bottom - effectiveHeight)),
    col: Math.max(margin.left, Math.min(rawCol, terminalWidth - margin.right - effectiveWidth)),
  }
}

export class SupervisorOverlayPointerRouter {
  private frame: ResolvedOverlayFrame | null = null

  capture(frame: SupervisorOverlayPointerFrame): void {
    const margin = marginEdges(frame.options.margin)
    const availableHeight = Math.max(1, frame.terminalHeight - margin.top - margin.bottom)
    const requestedMaxHeight = typeof frame.options.maxHeight === 'number'
      ? frame.options.maxHeight
      : frame.options.maxHeight?.endsWith('%')
        ? Math.floor(frame.terminalHeight * Number.parseFloat(frame.options.maxHeight) / 100)
        : undefined
    const height = Math.min(
      frame.lines.length,
      requestedMaxHeight === undefined
        ? availableHeight
        : Math.max(1, Math.min(requestedMaxHeight, availableHeight)),
    )
    const position = resolveSupervisorOverlayPosition(
      frame.width,
      height,
      frame.terminalWidth,
      frame.terminalHeight,
      frame.options,
    )
    this.frame = { ...frame, lines: frame.lines.slice(0, height), ...position, height }
  }

  clear(): void {
    this.frame = null
  }

  route(event: SupervisorPointerEvent): boolean {
    const frame = this.frame
    if (!frame) return false
    const localRow = event.row - frame.row
    const localColumn = event.col - frame.col
    if (
      localRow < 1
      || localRow > frame.height
      || localColumn < 1
      || localColumn > frame.width
    ) {
      if (event.motion) frame.hoverCommand?.()
      return false
    }

    const command = supervisorCommandTargets(frame.lines).find((target) => (
      target.row === localRow
      && localColumn >= target.startColumn
      && localColumn <= target.endColumn
    ))
    if (event.motion) frame.hoverCommand?.(command?.label)

    const list = frame.list
    const inListColumns = Boolean(list)
      && localColumn >= (list?.startColumn ?? 1)
      && localColumn <= (list?.endColumn ?? frame.width)
    if (event.wheel && list && inListColumns) {
      list.move(event.wheel)
      return true
    }

    if (list && inListColumns) {
      const offset = localRow - list.firstRow
      const index = list.indexes[offset]
      if (index !== undefined && (event.motion || event.leftClick)) {
        list.select(index)
        if (event.leftClick) list.activate()
        return true
      }
    }

    if (event.leftClick) {
      const data = command ? commandInput(command.label) : undefined
      if (data) {
        frame.input(data)
        return true
      }
    }
    return event.motion || event.release
  }
}

export function supervisorVisibleListIndexes(
  selectedIndex: number,
  itemCount: number,
  maxVisible: number,
): number[] {
  if (itemCount <= 0 || maxVisible <= 0) return []
  const selected = Math.max(0, Math.min(selectedIndex, itemCount - 1))
  const visible = Math.min(maxVisible, itemCount)
  const start = Math.max(0, Math.min(
    selected - Math.floor(visible / 2),
    itemCount - visible,
  ))
  return Array.from({ length: visible }, (_, index) => start + index)
}
