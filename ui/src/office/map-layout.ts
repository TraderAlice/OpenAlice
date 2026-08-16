import type { OfficeHarness } from '../api/office'

export const OFFICE_MAP_TILE = 24
export const OFFICE_POD_WIDTH = 288
export const OFFICE_POD_HEIGHT = 216
export const OFFICE_POD_GAP = 48
export const OFFICE_MAP_PADDING = 72

export interface OfficeMapLayoutInput {
  id: string
  harness: OfficeHarness
}

export interface OfficeMapPodLayout extends OfficeMapLayoutInput {
  x: number
  y: number
  width: number
  height: number
}

export interface OfficeMapLayout {
  width: number
  height: number
  columns: number
  rows: number
  alice: { x: number; y: number }
  pods: OfficeMapPodLayout[]
}

function candidateScore(count: number, columns: number): number {
  const rows = Math.ceil(count / columns)
  const width = Math.max(960, OFFICE_MAP_PADDING * 2
    + columns * OFFICE_POD_WIDTH
    + Math.max(0, columns - 1) * OFFICE_POD_GAP)
  const height = Math.max(672, OFFICE_MAP_PADDING * 2
    + rows * OFFICE_POD_HEIGHT
    + Math.max(0, rows - 1) * OFFICE_POD_GAP)
  const aspectPenalty = Math.abs(width / height - 4 / 3)
  const emptyPenalty = (columns * rows - count) * 0.025
  return aspectPenalty + emptyPenalty
}

export function layoutOfficeMap(inputs: readonly OfficeMapLayoutInput[]): OfficeMapLayout {
  const count = Math.max(1, inputs.length)
  let columns = 1
  let bestScore = Number.POSITIVE_INFINITY
  for (let candidate = 1; candidate <= count; candidate += 1) {
    const score = candidateScore(count, candidate)
    if (score <= bestScore) {
      columns = candidate
      bestScore = score
    }
  }
  const rows = Math.ceil(count / columns)
  const contentWidth = columns * OFFICE_POD_WIDTH
    + Math.max(0, columns - 1) * OFFICE_POD_GAP
  const contentHeight = rows * OFFICE_POD_HEIGHT
    + Math.max(0, rows - 1) * OFFICE_POD_GAP
  const width = Math.max(960, contentWidth + OFFICE_MAP_PADDING * 2)
  const height = Math.max(672, contentHeight + OFFICE_MAP_PADDING * 2)
  const originX = Math.round((width - contentWidth) / (2 * OFFICE_MAP_TILE)) * OFFICE_MAP_TILE
  const originY = Math.round((height - contentHeight) / (2 * OFFICE_MAP_TILE)) * OFFICE_MAP_TILE
  const pods = inputs.map((input, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    return {
      ...input,
      x: originX + column * (OFFICE_POD_WIDTH + OFFICE_POD_GAP),
      y: originY + row * (OFFICE_POD_HEIGHT + OFFICE_POD_GAP),
      width: OFFICE_POD_WIDTH,
      height: OFFICE_POD_HEIGHT,
    }
  })
  const aliceX = columns > 1
    ? originX + Math.floor(columns / 2) * (OFFICE_POD_WIDTH + OFFICE_POD_GAP) - OFFICE_POD_GAP / 2
    : originX + OFFICE_POD_WIDTH + OFFICE_POD_GAP / 2
  const aliceY = rows > 1
    ? originY + Math.floor(rows / 2) * (OFFICE_POD_HEIGHT + OFFICE_POD_GAP) - OFFICE_POD_GAP / 2
    : originY + OFFICE_POD_HEIGHT / 2

  return {
    width,
    height,
    columns,
    rows,
    alice: {
      x: Math.round(aliceX / OFFICE_MAP_TILE) * OFFICE_MAP_TILE,
      y: Math.round(aliceY / OFFICE_MAP_TILE) * OFFICE_MAP_TILE,
    },
    pods,
  }
}
