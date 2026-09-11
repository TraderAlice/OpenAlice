import { displayWidth, truncateDisplayWidth } from './supervisor-display.ts'

export interface SupervisorScrollRailOptions {
  /** Zero-based first visible row in the complete logical collection. */
  offset: number
  total: number
  /** Zero-based track row currently owned by pointer hover or drag. */
  hoveredRow?: number | null
}

export interface SupervisorScrollRailTarget {
  /** One-based row inside the owning rendered view. */
  row: number
  /** One-based terminal column of the single-cell rail. */
  column: number
  /** Zero-based row inside the rail track. */
  trackRow: number
  /** Proportional zero-based item selected by this rail row. */
  index: number
}

/**
 * Projects an OMP-style scroll track into the final content column without
 * owning selection, wheel, or paging state.
 */
export function withSupervisorScrollRail(
  rows: string[],
  width: number,
  options: SupervisorScrollRailOptions,
): string[] {
  const safeWidth = Math.max(0, Math.trunc(width))
  if (safeWidth === 0 || rows.length === 0 || options.total <= rows.length) return rows

  const viewport = rows.length
  const total = Math.max(viewport, Math.trunc(options.total))
  const maxOffset = total - viewport
  const offset = clamp(Math.trunc(options.offset), 0, maxOffset)
  // Thumb sizing and travel follow @oh-my-pi/pi-tui ScrollView's MIT-licensed
  // geometry while retaining OpenAlice's existing list state and hit testing.
  const thumbSize = Math.max(1, Math.min(Math.floor((viewport * viewport) / total), viewport))
  const travel = viewport - thumbSize
  const thumbStart = maxOffset === 0 ? 0 : Math.round((offset / maxOffset) * travel)
  const contentWidth = safeWidth - 1

  return rows.map((row, index) => {
    const text = truncateDisplayWidth(row, contentWidth)
    const padding = ' '.repeat(Math.max(0, contentWidth - displayWidth(text)))
    const glyph = index === options.hoveredRow
      ? '◆'
      : index >= thumbStart && index < thumbStart + thumbSize ? '█' : '│'
    return `${text}${padding}${glyph}`
  })
}

/**
 * Maps a rail cell directly onto a real item. The owning view remains
 * responsible for translating that item into selection or focus state.
 */
export function supervisorScrollRailIndexAt(
  trackRow: number,
  viewportRows: number,
  total: number,
): number | undefined {
  const safeViewport = Number.isFinite(viewportRows) ? Math.max(0, Math.trunc(viewportRows)) : 0
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0
  const safeRow = Number.isFinite(trackRow) ? Math.trunc(trackRow) : -1
  if (
    safeViewport <= 0
    || safeTotal <= safeViewport
    || safeRow < 0
    || safeRow >= safeViewport
  ) return undefined
  if (safeViewport === 1) return 0
  return Math.round((safeRow / (safeViewport - 1)) * (safeTotal - 1))
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}
