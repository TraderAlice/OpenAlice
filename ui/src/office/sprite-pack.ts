/**
 * Office only depends on this pack interface. Codex pet v2 is the first
 * adapter — not part of the employee / desk / office model. Swap `pose()`
 * and `sheetUrl` to change generators later.
 */
export type OfficeEmployeeMood =
  | 'idle'
  | 'working'
  | 'talking'
  | 'waiting'
  | 'review'
  | 'failed'

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
  pose(mood: OfficeEmployeeMood): OfficeSpritePose
}

/** Codex v2 atlas: 1536×2288, 8×11, 192×208 cells. Rows 0–8 are moods. */
const V2_CELL = { width: 192, height: 208 } as const

const V2_POSES: Record<OfficeEmployeeMood, OfficeSpritePose> = {
  idle: { row: 0, frames: 6, durationsMs: [280, 110, 110, 140, 140, 320] },
  working: { row: 7, frames: 6, durationsMs: [120, 120, 120, 120, 120, 220] },
  talking: { row: 3, frames: 4, durationsMs: [140, 140, 140, 280] },
  waiting: { row: 6, frames: 6, durationsMs: [150, 150, 150, 150, 150, 260] },
  review: { row: 8, frames: 6, durationsMs: [150, 150, 150, 150, 150, 280] },
  failed: { row: 5, frames: 8, durationsMs: [140, 140, 140, 140, 140, 140, 140, 240] },
}

export const defaultOfficeSpritePack: OfficeSpritePack = {
  id: 'alice-maid',
  displayName: 'Alice',
  sheetUrl: '/office/packs/alice-maid/spritesheet.webp',
  cell: V2_CELL,
  atlas: { columns: 8, rows: 11 },
  pose(mood) {
    return V2_POSES[mood]
  },
}
