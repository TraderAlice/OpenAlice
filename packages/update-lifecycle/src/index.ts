/** Public policy and lifecycle contracts; release-policy also runs in pre-install tools. */
export * from './release-policy.js'

export { DiscoveryStore, type DiscoverySnapshot } from './discovery.js'
export { verifyReleaseEvidence, type ReleaseEvidence, type ReleaseVerification } from './verification.js'
export type { ClientUpdatePreferences, ClientReleaseObservation, ClientUpdateSnapshot, NativeUpdaterStatus, UpdaterInstallStage } from './client.js'
export * from './runtime.js'

export * from './coordinator.js'
export * from './owner.js'
export { parseInstallSource, requireInstallSource, installSourceUpdateChannel, type InstallSource, type InstallChannel } from './install-source.js'
