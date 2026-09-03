export type OfficeAlicePose =
  | 'idle-down'
  | 'idle-left'
  | 'idle-right'
  | 'idle-up'
  | 'walk-down'
  | 'walk-left'
  | 'walk-right'
  | 'walk-up'

export interface OfficeSpritePose {
  readonly sheetUrl: string
  readonly cell: { readonly width: number; readonly height: number }
  readonly atlas: { readonly columns: number; readonly rows: number }
  readonly row: number
  readonly column: number
  readonly frames: number
  readonly durationsMs: readonly number[]
}

export interface OfficeSpritePack {
  readonly id: string
  readonly displayName: string
  pose(action: OfficeAlicePose): OfficeSpritePose
}

/** Generated Office overworld atlas: 144×192, 3×4, native 48×48 cells. */
const OVERWORLD_SHEET = {
  sheetUrl: '/office/packs/alice-overworld-v1.png',
  cell: { width: 48, height: 48 },
  atlas: { columns: 3, rows: 4 },
} as const

const OFFICE_POSES: Record<OfficeAlicePose, OfficeSpritePose> = {
  'idle-down': { ...OVERWORLD_SHEET, row: 0, column: 1, frames: 1, durationsMs: [320] },
  'idle-left': { ...OVERWORLD_SHEET, row: 1, column: 1, frames: 1, durationsMs: [320] },
  'idle-right': { ...OVERWORLD_SHEET, row: 2, column: 1, frames: 1, durationsMs: [320] },
  'idle-up': { ...OVERWORLD_SHEET, row: 3, column: 1, frames: 1, durationsMs: [320] },
  'walk-down': { ...OVERWORLD_SHEET, row: 0, column: 0, frames: 3, durationsMs: [120, 120, 120] },
  'walk-left': { ...OVERWORLD_SHEET, row: 1, column: 0, frames: 3, durationsMs: [120, 120, 120] },
  'walk-right': { ...OVERWORLD_SHEET, row: 2, column: 0, frames: 3, durationsMs: [120, 120, 120] },
  'walk-up': { ...OVERWORLD_SHEET, row: 3, column: 0, frames: 3, durationsMs: [120, 120, 120] },
}

export const defaultOfficeSpritePack: OfficeSpritePack = {
  id: 'alice-overworld',
  displayName: 'Alice',
  pose(action) {
    return OFFICE_POSES[action]
  },
}
