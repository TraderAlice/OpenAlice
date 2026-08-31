import { realpath } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

import {
  confirmActivation,
  markActivationRolledBack,
  readActivationReceipt,
} from './activation.mjs'
import { resolveInstalledLayout } from './install-layout.mjs'
import { CLI_VERSION, installedContentIdentity } from './install-source.mjs'
import {
  activateRelease,
  assertNoLiveInstaller,
  inspectRollback,
} from './rollback.mjs'

export async function resolveActivationContext(env, dependencies = {}) {
  const resolveLayout = dependencies.resolveInstalledLayoutImpl ?? resolveInstalledLayout
  const layout = Object.hasOwn(dependencies, 'activationLayout')
    ? dependencies.activationLayout
    : resolveLayout(import.meta.url, { env })
  const contentIdentity = (
    dependencies.installedContentIdentityImpl ?? installedContentIdentity
  )(import.meta.url, {
    env,
    executable: dependencies.runtimeExecutable ?? process.execPath,
  })
  if (!layout || layout.kind !== 'bun') {
    return {
      layout: null,
      receipt: null,
      currentRelease: null,
      currentContentIdentity: null,
      contentIdentity,
      productVersion: dependencies.cliVersion ?? CLI_VERSION,
    }
  }
  const receipt = await (dependencies.readActivationReceiptImpl ?? readActivationReceipt)(
    layout,
    dependencies,
  )
  let currentRelease = null
  try {
    const realpathImpl = dependencies.realpathImpl ?? realpath
    const currentPath = await realpathImpl(layout.currentPath)
    const releasesPath = await realpathImpl(layout.releasesDir)
    if (dirname(currentPath) !== releasesPath) {
      const error = new Error('The active OpenAlice release pointer leaves the installer-owned releases directory.')
      error.code = 'EACTIVATION'
      throw error
    }
    currentRelease = basename(currentPath)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return {
    layout,
    receipt,
    currentRelease,
    currentContentIdentity: /-([a-f0-9]{16})$/.exec(currentRelease ?? '')?.[1] ?? null,
    contentIdentity,
    productVersion: dependencies.cliVersion ?? CLI_VERSION,
  }
}

export async function reconcileActivation(status, activation, dependencies = {}, options = {}) {
  const providerIdentity = status.provider?.contentIdentity ?? null
  const cliOwner = ['cli', 'cli-server'].includes(status.owner?.surface)
  const runningInstalledContent = (
    status.class === 'running'
    && cliOwner
    && activation.contentIdentity
    && activation.contentIdentity === activation.currentContentIdentity
    && providerIdentity === activation.contentIdentity
  )
  const directPending = (
    activation.layout
    && activation.receipt?.state === 'pending'
    && activation.receipt.activeRelease === activation.currentRelease
  )
  if (directPending && runningInstalledContent) {
    if (options.confirm === false) return { ...status, pendingActivation: null }
    try {
      const confirmed = await (dependencies.confirmActivationImpl ?? confirmActivation)(
        activation.layout,
        activation.receipt,
        dependencies,
      )
      if (
        confirmed?.state === 'confirmed'
        && confirmed.activeRelease === activation.currentRelease
      ) return { ...status, pendingActivation: null }
    } catch (error) {
      dependencies.activationWarning?.(error)
    }
  }
  if (directPending) {
    return {
      ...status,
      pendingActivation: {
        productVersion: activation.receipt.productVersion,
        restartRequired: status.class !== 'absent',
        reason: status.class === 'absent'
          ? 'The newly installed OpenAlice release has not completed its first successful start'
          : 'A newly installed OpenAlice release is waiting for this Runtime to restart',
      },
    }
  }
  if (
    status.class === 'running'
    && cliOwner
    && activation.contentIdentity
    && providerIdentity !== activation.contentIdentity
  ) {
    return {
      ...status,
      pendingActivation: {
        productVersion: activation.productVersion,
        restartRequired: true,
        reason: 'The installed OpenAlice package differs from the running Runtime',
      },
    }
  }
  return status
}

export async function rollbackFailedActivation(activation, error, dependencies = {}) {
  if (
    !['EEARLYEXIT', 'ETIMEDOUT', 'ENOENT', 'EACCES'].includes(error?.code)
    || !activation.layout
    || activation.receipt?.state !== 'pending'
    || !activation.receipt.previousRelease
    || activation.receipt.activeRelease !== activation.currentRelease
    || activation.contentIdentity !== activation.currentContentIdentity
  ) return null
  try {
    await (dependencies.assertNoLiveInstallerImpl ?? assertNoLiveInstaller)(
      activation.layout.lockDir,
      dependencies.processKill ?? process.kill,
    )
    const plan = await (dependencies.inspectRollbackImpl ?? inspectRollback)(
      activation.layout,
      activation.receipt.previousRelease,
      dependencies,
    )
    if (
      plan.current.name !== activation.receipt.activeRelease
      || plan.target.name !== activation.receipt.previousRelease
    ) return null
    await (dependencies.activateReleaseImpl ?? activateRelease)(
      activation.layout,
      plan.target.name,
      dependencies,
    )
    try {
      await (dependencies.markActivationRolledBackImpl ?? markActivationRolledBack)(
        activation.layout,
        activation.receipt,
        error,
        dependencies,
      )
    } catch (metadataError) {
      dependencies.activationWarning?.(metadataError)
    }
    return {
      failedRelease: plan.current.name,
      restoredRelease: plan.target.name,
    }
  } catch (rollbackError) {
    dependencies.activationWarning?.(rollbackError)
    return null
  }
}
