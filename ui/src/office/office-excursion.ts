import type { OfficePlayerState } from './OfficeBuilding'

let rememberedPlayerState: OfficePlayerState | null = null

export function readOfficePlayerState(): OfficePlayerState | null {
  return rememberedPlayerState
    ? {
        position: { ...rememberedPlayerState.position },
        direction: rememberedPlayerState.direction,
      }
    : null
}

export function rememberOfficePlayerState(state: OfficePlayerState): void {
  rememberedPlayerState = {
    position: { ...state.position },
    direction: state.direction,
  }
}

export function clearOfficePlayerState(): void {
  rememberedPlayerState = null
}
