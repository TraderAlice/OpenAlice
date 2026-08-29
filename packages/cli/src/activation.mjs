import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'

const RELEASE_NAME = /^[A-Za-z0-9._+-]+$/
const STATES = new Set(['pending', 'confirmed', 'rolled_back'])

export async function readActivationReceipt(layout, dependencies = {}) {
  if (!layout?.activationPath) return null
  let value
  try {
    value = JSON.parse(await (dependencies.readFileImpl ?? readFile)(layout.activationPath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw new Error(`OpenAlice CLI activation metadata is unreadable: ${error instanceof Error ? error.message : String(error)}`)
  }
  return requireActivationReceipt(value)
}

export function requireActivationReceipt(value) {
  if (!value || typeof value !== 'object') throw new Error('OpenAlice CLI activation metadata is invalid')
  const previousRelease = value.previousRelease === null ? null : value.previousRelease
  if (
    value.schemaVersion !== 1
    || typeof value.activeRelease !== 'string'
    || !RELEASE_NAME.test(value.activeRelease)
    || (previousRelease !== null && (
      typeof previousRelease !== 'string'
      || !RELEASE_NAME.test(previousRelease)
      || previousRelease === value.activeRelease
    ))
    || typeof value.productVersion !== 'string'
    || !/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/.test(value.productVersion)
    || !STATES.has(value.state)
    || !validTimestamp(value.activatedAt)
    || (value.confirmedAt !== undefined && !validTimestamp(value.confirmedAt))
    || (value.rolledBackAt !== undefined && !validTimestamp(value.rolledBackAt))
    || (value.failureCode !== undefined && (
      typeof value.failureCode !== 'string'
      || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.failureCode)
    ))
  ) {
    throw new Error('OpenAlice CLI activation metadata is invalid')
  }
  return {
    schemaVersion: 1,
    activeRelease: value.activeRelease,
    previousRelease,
    productVersion: value.productVersion,
    state: value.state,
    activatedAt: value.activatedAt,
    ...(value.confirmedAt ? { confirmedAt: value.confirmedAt } : {}),
    ...(value.rolledBackAt ? { rolledBackAt: value.rolledBackAt } : {}),
    ...(value.failureCode ? { failureCode: value.failureCode } : {}),
  }
}

export async function writeActivationReceipt(layout, receipt, dependencies = {}) {
  const value = requireActivationReceipt(receipt)
  const temporaryPath = `${layout.activationPath}.next.${process.pid}.${randomUUID()}`
  try {
    await (dependencies.writeFileImpl ?? writeFile)(
      temporaryPath,
      `${JSON.stringify(value, null, 2)}\n`,
      { mode: 0o600 },
    )
    await (dependencies.renameImpl ?? rename)(temporaryPath, layout.activationPath)
  } finally {
    await (dependencies.rmImpl ?? rm)(temporaryPath, { force: true })
  }
  return value
}

export async function recordPendingActivation(layout, activation, dependencies = {}) {
  return writeActivationReceipt(layout, {
    schemaVersion: 1,
    activeRelease: activation.activeRelease,
    previousRelease: activation.previousRelease ?? null,
    productVersion: activation.productVersion,
    state: 'pending',
    activatedAt: activation.activatedAt ?? new Date().toISOString(),
  }, dependencies)
}

export async function confirmActivation(layout, receipt, dependencies = {}) {
  if (!receipt || receipt.state !== 'pending') return receipt
  const latest = await readActivationReceipt(layout, dependencies)
  if (!samePendingActivation(latest, receipt)) return latest
  return writeActivationReceipt(layout, {
    ...receipt,
    state: 'confirmed',
    confirmedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
  }, dependencies)
}

export async function markActivationRolledBack(layout, receipt, error, dependencies = {}) {
  const latest = await readActivationReceipt(layout, dependencies)
  if (!samePendingActivation(latest, receipt)) return latest
  return writeActivationReceipt(layout, {
    ...receipt,
    state: 'rolled_back',
    rolledBackAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    failureCode: normalizeFailureCode(error?.code),
  }, dependencies)
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function normalizeFailureCode(value) {
  const normalized = String(value ?? 'ESTART').toUpperCase().replaceAll(/[^A-Z0-9_]+/g, '_')
  return /^[A-Z]/.test(normalized) ? normalized.slice(0, 64) : `E_${normalized}`.slice(0, 64)
}

function samePendingActivation(left, right) {
  return left?.state === 'pending'
    && right?.state === 'pending'
    && left.activeRelease === right.activeRelease
    && left.previousRelease === right.previousRelease
    && left.productVersion === right.productVersion
    && left.activatedAt === right.activatedAt
}
