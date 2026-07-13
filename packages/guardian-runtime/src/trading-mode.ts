import { createDecipheriv } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export type GuardianTradingMode = 'lite' | 'readonly' | 'pro'

export interface GuardianTradingModePlan {
  mode: GuardianTradingMode
  source: 'env' | 'config' | 'auto'
  envLocked: boolean
  hasUTAConfig: boolean
}

export function isLiteModeEnv(env: NodeJS.ProcessEnv): boolean {
  return truthyEnv(env['OPENALICE_LITE_MODE']) || truthyEnv(env['OPENALICE_UTA_DISABLED'])
}

export function parseGuardianTradingModeEnv(env: NodeJS.ProcessEnv): GuardianTradingMode | null {
  const raw = env['OPENALICE_TRADING_MODE']?.trim().toLowerCase()
  if (raw === 'lite' || raw === 'readonly' || raw === 'pro') return raw
  return isLiteModeEnv(env) ? 'lite' : null
}

export async function resolveGuardianTradingMode(
  env: NodeJS.ProcessEnv,
  userDataHome: string,
): Promise<GuardianTradingModePlan> {
  const envMode = parseGuardianTradingModeEnv(env)
  const configuredMode = await readPersistedTradingMode(userDataHome)
  const hasUTAConfig = await hasPersistedUTAs(userDataHome)
  if (envMode) return { mode: envMode, source: 'env', envLocked: true, hasUTAConfig }
  if (configuredMode) return { mode: configuredMode, source: 'config', envLocked: false, hasUTAConfig }
  return { mode: hasUTAConfig ? 'pro' : 'lite', source: 'auto', envLocked: false, hasUTAConfig }
}

async function readPersistedTradingMode(userDataHome: string): Promise<GuardianTradingMode | null> {
  try {
    const raw = JSON.parse(await readFile(resolve(
      userDataHome,
      'data',
      'config',
      'trading.json',
    ), 'utf8')) as { mode?: unknown }
    return raw.mode === 'lite' || raw.mode === 'readonly' || raw.mode === 'pro' ? raw.mode : null
  } catch {
    return null
  }
}

async function hasPersistedUTAs(userDataHome: string): Promise<boolean> {
  try {
    const raw = JSON.parse(await readFile(resolve(
      userDataHome,
      'data',
      'config',
      'accounts.json',
    ), 'utf8'))
    const accounts = isSealedEnvelope(raw)
      ? await unsealGuardianAccounts(userDataHome, raw)
      : raw
    return Array.isArray(accounts) && accounts.length > 0
  } catch {
    return false
  }
}

function isSealedEnvelope(value: unknown): value is {
  alg: string
  iv: string
  tag: string
  data: string
} {
  return (
    typeof value === 'object' && value !== null &&
    (value as Record<string, unknown>)['$sealed'] === 1 &&
    typeof (value as Record<string, unknown>)['iv'] === 'string' &&
    typeof (value as Record<string, unknown>)['tag'] === 'string' &&
    typeof (value as Record<string, unknown>)['data'] === 'string'
  )
}

async function unsealGuardianAccounts(
  userDataHome: string,
  envelope: { alg: string; iv: string; tag: string; data: string },
): Promise<unknown> {
  if (envelope.alg !== 'aes-256-gcm') return []
  const keyRaw = (await readFile(resolve(userDataHome, 'sealing.key'), 'utf8')).trim()
  const key = Buffer.from(keyRaw, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ])
  return JSON.parse(plaintext.toString('utf8')) as unknown
}

function truthyEnv(raw: string | undefined): boolean {
  if (raw === undefined || raw === '') return false
  const normalized = raw.toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}
