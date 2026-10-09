import type { ReleaseDecision } from './index.js'
import type { DiscoverySnapshot } from './discovery.js'

/** Local host policy. Never read from the selected backend's AliceProject. */
export interface ClientUpdatePreferences { autoCheck: boolean }
export interface ClientReleaseObservation {
  status: ReleaseDecision['status'] | 'unsupported'
  reason?: ReleaseDecision['reason']
  currentVersion: string
  latestVersion?: string
  latestCommit?: string
  channel: string
  releaseNotesUrl?: string
  message?: string
}
export interface ClientUpdateSnapshot {
  kind: 'cli' | 'desktop'
  currentVersion: string
  preferences: ClientUpdatePreferences
  discovery: DiscoverySnapshot<ClientReleaseObservation>
}

/** Native transport progress. Release eligibility still comes from selectRelease. */
export type UpdaterInstallStage = 'preparing' | 'stopping-services' | 'releasing-runtime' | 'handing-off'
export type NativeUpdaterStatus =
  | { phase: 'checking' }
  | { phase: 'current'; version: string }
  | { phase: 'blocked' | 'unknown'; version?: string; reason: ReleaseDecision['reason'] }
  | { phase: 'available'; version?: string; releaseUrl?: string }
  | { phase: 'downloading'; version?: string; percent?: number }
  | { phase: 'downloaded'; version: string; releaseUrl: string }
  | { phase: 'installing'; version: string; stage: UpdaterInstallStage }
  | { phase: 'error'; message: string }
