/**
 * Office only depends on this pack interface. Codex pet v2 is the first
 * adapter — not part of the employee / desk / office model. It belongs
 * exclusively to Alice; runtime coworkers use generated static overworld art.
 */
export type OfficeAlicePose = 'idle' | 'idle-back' | 'walk-right' | 'walk-left'

export interface OfficeSpritePose {
  readonly sheetUrl: string
  readonly cell: { readonly width: number; readonly height: number }
  readonly atlas: { readonly columns: number; readonly rows: number }
  readonly row: number
  readonly frames: number
  readonly durationsMs: readonly number[]
}

export interface OfficeSpritePack {
  readonly id: string
  readonly displayName: string
  pose(action: OfficeAlicePose): OfficeSpritePose
}

/** Codex v2 atlas: 1536×2288, 8×11, 192×208 cells. Rows 0–2 are idle/right-run/left-run. */
const V2_CELL = { width: 192, height: 208 } as const
const V2_SHEET = {
  sheetUrl: '/office/packs/alice-maid/spritesheet.webp',
  cell: V2_CELL,
  atlas: { columns: 8, rows: 11 },
} as const
const BACK_SHEET = {
  sheetUrl: '/office/packs/alice-maid/back-v1.png',
  cell: V2_CELL,
  atlas: { columns: 1, rows: 1 },
} as const

const V2_POSES: Record<OfficeAlicePose, OfficeSpritePose> = {
  idle: { ...V2_SHEET, row: 0, frames: 6, durationsMs: [280, 110, 110, 140, 140, 320] },
  'idle-back': { ...BACK_SHEET, row: 0, frames: 1, durationsMs: [320] },
  'walk-right': { ...V2_SHEET, row: 1, frames: 8, durationsMs: [80, 80, 80, 80, 80, 80, 80, 80] },
  'walk-left': { ...V2_SHEET, row: 2, frames: 8, durationsMs: [80, 80, 80, 80, 80, 80, 80, 80] },
}

export const defaultOfficeSpritePack: OfficeSpritePack = {
  id: 'alice-maid',
  displayName: 'Alice',
  pose(action) {
    return V2_POSES[action]
  },
}
