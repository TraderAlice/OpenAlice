/**
 * Reconcile previously installed Broker Packs with the running OpenAlice
 * release without turning optional integrations into implicit installs.
 *
 * A compatible older Pack remains loadable while the replacement downloads.
 * installBrokerPack() activates atomically, so any failed update leaves the
 * prior active pointer untouched.
 */

import {
  INSTALLABLE_BROKER_ENGINES,
  type InstallableBrokerEngine,
} from '../../core/broker-packs.js'
import { getCurrentVersion } from '../../core/version.js'
import { triggerUTARestart, type TriggerResult } from '../uta-supervisor/restart-trigger.js'
import {
  getBrokerPackLocalStatus,
  installBrokerPack,
} from './installer.js'

const STARTUP_RECONCILE_DELAY_MS = 1_500

export interface BrokerPackReconcileFailure {
  engine: InstallableBrokerEngine
  error: string
}

export interface BrokerPackReconcileResult {
  skipped?: string
  checked: InstallableBrokerEngine[]
  updated: InstallableBrokerEngine[]
  failed: BrokerPackReconcileFailure[]
  restart?: TriggerResult
}

export interface BrokerPackReconcileOptions {
  force?: boolean
  restart?: boolean
}

export async function reconcileInstalledBrokerPacks(
  options: BrokerPackReconcileOptions = {},
): Promise<BrokerPackReconcileResult> {
  const skipReason = options.force ? null : automaticReconcileSkipReason()
  if (skipReason) {
    return { skipped: skipReason, checked: [], updated: [], failed: [] }
  }

  const statuses = await Promise.all(
    INSTALLABLE_BROKER_ENGINES.map((engine) => getBrokerPackLocalStatus(engine)),
  )
  const outdated = statuses
    .filter((status) => status.updateAvailable && status.version)
    .map((status) => status.engine as InstallableBrokerEngine)

  const settled = await Promise.allSettled(
    outdated.map(async (engine) => {
      await installBrokerPack(engine)
      return engine
    }),
  )
  const updated: InstallableBrokerEngine[] = []
  const failed: BrokerPackReconcileFailure[] = []
  settled.forEach((result, index) => {
    const engine = outdated[index]!
    if (result.status === 'fulfilled') updated.push(engine)
    else {
      failed.push({
        engine,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
    }
  })

  const restart = updated.length > 0 && options.restart !== false
    ? await triggerUTARestart()
    : undefined
  return {
    checked: outdated,
    updated,
    failed,
    ...(restart ? { restart } : {}),
  }
}

export function scheduleInstalledBrokerPackReconciliation(): void {
  const skipReason = automaticReconcileSkipReason()
  if (skipReason) {
    console.log(`[broker-packs] automatic reconciliation skipped: ${skipReason}`)
    return
  }

  const timer = setTimeout(() => {
    void reconcileInstalledBrokerPacks()
      .then((result) => {
        if (result.updated.length > 0) {
          console.log(
            `[broker-packs] updated ${result.updated.join(', ')} for OpenAlice ${getCurrentVersion()}`,
          )
        }
        for (const failure of result.failed) {
          console.warn(
            `[broker-packs] kept previous ${failure.engine} release after update failed: ${failure.error}`,
          )
        }
        if (result.restart && !result.restart.ready) {
          console.warn('[broker-packs] UTA restart after update did not become ready:', result.restart.error)
        }
      })
      .catch((err) => {
        console.warn(
          '[broker-packs] automatic reconciliation failed:',
          err instanceof Error ? err.message : err,
        )
      })
  }, STARTUP_RECONCILE_DELAY_MS)
  timer.unref?.()
}

function automaticReconcileSkipReason(): string | null {
  if (process.env['OPENALICE_BROKER_PACK_AUTO_UPDATE'] === '0') return 'disabled by environment'
  if (process.env['NODE_ENV'] === 'test') return 'test runtime'
  if (process.env['OPENALICE_LAUNCHER'] === 'dev') return 'source development runtime'
  return null
}
