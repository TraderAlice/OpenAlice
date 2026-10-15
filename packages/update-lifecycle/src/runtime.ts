import { selectRelease, compareVersions, isVersion, type InstalledRelease, type ReleaseIdentity } from './index.js'
import { verifyReleaseEvidence, type ReleaseEvidence } from './verification.js'

/** One independently installed unit. Adapters validate provenance and ownership. */
export interface RuntimeRelease extends InstalledRelease { contentIdentity?: string }
export type RuntimeStage = 'install' | 'activate' | 'verify' | 'reconnect'
export interface RuntimeUpdateInput {
  installed: RuntimeRelease | null
  candidate: (ReleaseIdentity & { contentIdentity?: string }) | null
  active: ReleaseEvidence | null
  running: boolean
  canActivate: boolean
  installationOnly?: boolean
  reconnect?: boolean
  installedVerified?: boolean
  channel?: ReleaseIdentity['channel']
}
export interface RuntimeUpdatePlan {
  target: RuntimeRelease | null
  selection: 'installed' | 'candidate'
  stages: RuntimeStage[]
  blocker: string | null
}

/** Connection never changes an installation's channel. Exact payload checks are
 * separate from release ordering; a newer installed release is retained. */
export function planRuntimeUpdate(input: RuntimeUpdateInput): RuntimeUpdatePlan {
  const { candidate } = input
  // A verified archive binds its commit even when the installed receipt only
  // records that archive's checksum. Enrich both sides of identity comparison.
  const installed = input.installed && candidate?.commit && !input.installed.commit && candidate.artifactSha256 &&
    candidate.artifactSha256 === input.installed.artifactSha256
    ? { ...input.installed, commit: candidate.commit } : input.installed
  let target: RuntimeRelease | null = installed
  let selection: RuntimeUpdatePlan['selection'] = 'installed'
  if (!installed && candidate) { target = candidate; selection = 'candidate' }
  else if (installed && candidate && (input.channel ?? installed.channel) === candidate.channel &&
    selectRelease(installed, candidate, candidate.channel).status === 'available') {
    target = candidate
    selection = 'candidate'
  }
  if (target && !isVersion(target.version)) return { target: null, selection, stages: [], blocker: 'The release identity is unknown or invalid.' }
  if (!target) return { target, selection, stages: [], blocker: 'No verified release is available for this installation.' }
  const install = input.installedVerified === false || !installed || verifyReleaseEvidence(target, installed).status !== 'matched'
  const activate = !input.installationOnly && (install || !input.running ||
    verifyReleaseEvidence(activeEvidence(target), input.active).status !== 'matched')
  const blocker = activate && input.active && isVersion(input.active.version) && target.channel !== 'dev' &&
    compareVersions(input.active.version, target.version) > 0
    ? 'Activation would downgrade the running Runtime. Select an explicit rollback separately.'
    : activate && input.running && !input.canActivate
      ? 'The running Runtime cannot be safely activated: structured stop and the recorded owner identity are required.' : null
  const stages: RuntimeStage[] = [
    ...(install ? ['install' as const] : []),
    ...(activate ? ['activate' as const] : []),
    'verify',
    ...(!input.installationOnly && input.reconnect !== false ? ['reconnect' as const] : []),
  ]
  return { target, selection, stages, blocker }
}

/** Runtime processes report content identity, while archive hashes describe the
 * installation. Never demand an archive hash from a running process. */
export function activeEvidence(target: RuntimeRelease): ReleaseEvidence {
  return { version: target.version, ...(target.commit && !target.contentIdentity ? { commit: target.commit } : {}),
    ...(target.contentIdentity ? { contentIdentity: target.contentIdentity } : {}) }
}

export interface RuntimeOperation {
  schemaVersion: 1
  target: RuntimeRelease
  stages: RuntimeStage[]
  completed: RuntimeStage[]
  phase: 'running' | 'failed' | 'succeeded'
  error: string | null
}
export function beginRuntimeOperation(plan: RuntimeUpdatePlan): RuntimeOperation {
  if (plan.blocker || !plan.target) throw new Error(plan.blocker ?? 'Missing release target')
  return { schemaVersion: 1, target: { ...plan.target }, stages: [...plan.stages], completed: [], phase: 'running', error: null }
}
export type RuntimeOperationEvent =
  | { type: 'complete'; stage: RuntimeStage; observed?: ReleaseEvidence | null; installationOnly?: boolean }
  | { type: 'fail'; error: string }
  | { type: 'retry' }

/** The real controller and rehearsal advance this same receipt. Completion of
 * install/verify requires observed identity, never a successful command alone. */
export function transitionRuntimeOperation(operation: RuntimeOperation, event: RuntimeOperationEvent): RuntimeOperation {
  if (event.type === 'fail') return { ...operation, phase: 'failed', error: event.error }
  if (event.type === 'retry') return operation.phase === 'failed' ? { ...operation, phase: 'running', error: null } : operation
  if (operation.phase !== 'running' || operation.stages[operation.completed.length] !== event.stage)
    throw new Error('Update receipt does not match the next approved stage')
  if (event.stage === 'install' || event.stage === 'verify') {
    const expected = event.stage === 'install' || event.installationOnly ? operation.target : activeEvidence(operation.target)
    if (verifyReleaseEvidence(expected, event.observed ?? null).status !== 'matched')
      throw new Error(`The ${event.stage} evidence does not match the approved release`)
  }
  const completed = [...operation.completed, event.stage]
  return { ...operation, completed, phase: completed.length === operation.stages.length ? 'succeeded' : 'running', error: null }
}
