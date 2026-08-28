/**
 * Office only depends on this pack interface. Codex pet v2 is the first
 * adapter — not part of the employee / desk / office model. It belongs
 * exclusively to Alice; runtime coworkers use generated static overworld art.
 */
export type OfficeAlicePose = 'idle' | 'walk-right' | 'walk-left'

export interface OfficeSpritePose {
  readonly row: number
  readonly frames: number
  readonly durationsMs: readonly number[]
}

export interface OfficeSpritePack {
  readonly id: string
  readonly displayName: string
  readonly sheetUrl: string
  readonly cell: { readonly width: number; readonly height: number }
  readonly atlas: { readonly columns: number; readonly rows: number }
  pose(action: OfficeAlicePose): OfficeSpritePose
}

/** Codex v2 atlas: 1536×2288, 8×11, 192×208 cells. Rows 0–2 are idle/right-run/left-run. */
const V2_CELL = { width: 192, height: 208 } as const

const V2_POSES: Record<OfficeAlicePose, OfficeSpritePose> = {
  idle: { row: 0, frames: 6, durationsMs: [280, 110, 110, 140, 140, 320] },
  'walk-right': { row: 1, frames: 8, durationsMs: [80, 80, 80, 80, 80, 80, 80, 80] },
  'walk-left': { row: 2, frames: 8, durationsMs: [80, 80, 80, 80, 80, 80, 80, 80] },
}

export const defaultOfficeSpritePack: OfficeSpritePack = {
  id: 'alice-maid',
  displayName: 'Alice',
  sheetUrl: '/office/packs/alice-maid/spritesheet.webp',
  cell: V2_CELL,
  atlas: { columns: 8, rows: 11 },
  pose(action) {
    return V2_POSES[action]
  },
}
