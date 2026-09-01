import type { OfficeCadenceDutyCandidate } from './duty-registry'

export interface OfficeCadenceExcursion {
  readonly duty: OfficeCadenceDutyCandidate
}

// A route excursion is ephemeral navigation state. Daily review truth lives in
// the Project-owned Office Day; this module only keeps the captured dossier
// while the current renderer visits the Issue surface and returns.
let currentExcursion: OfficeCadenceExcursion | null = null

export function readOfficeCadenceExcursion(): OfficeCadenceExcursion | null {
  return currentExcursion
}

export function rememberOfficeCadenceExcursion(excursion: OfficeCadenceExcursion): void {
  currentExcursion = excursion
}

export function clearOfficeCadenceExcursion(): void {
  currentExcursion = null
}
