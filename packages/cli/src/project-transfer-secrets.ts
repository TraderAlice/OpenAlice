/** Secret-plane helpers for AliceProject transfer.
 *
 * Secret values are deliberately kept out of the ordinary file manifest.
 * They may exist only in source-process memory, the authenticated SSH stdin
 * stream, and a freshly sealed destination file.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto'
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  readAiProviderVault,
  type AiProviderVault,
} from './ai-credential-copy.ts'

const ALG = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12

export interface ProjectTransferCredentialBundle {
  ai: AiProviderVault
  brokerAccounts: unknown[]
  connectors: Record<string, unknown>
  providerKeys: Record<string, string>
}

export interface ProjectTransferCredentialSummary {
  ai: { count: number; vendors: string[] }
  broker: { count: number; presets: string[] }
  connector: { count: number; adapters: string[] }
  providerKeys: { count: number; vendors: string[] }
}

interface SealedEnvelope {
  $sealed: 1
  alg: typeof ALG
  iv: string
  tag: string
  data: string
}

export async function readProjectTransferCredentialBundle(
  home: string,
): Promise<ProjectTransferCredentialBundle> {
  const [ai, brokerValue, connectorValue, globalProviderKeys, marketData] = await Promise.all([
    readAiProviderVault(home),
    readOptionalSecretJson(home, join('data', 'config', 'accounts.json')),
    readOptionalSecretJson(home, join('data', 'config', 'connectors.json')),
    readOptionalJson(join(home, 'provider-keys.json')),
    readOptionalJson(join(home, 'data', 'config', 'market-data.json')),
  ])
  return {
    ai,
    brokerAccounts: Array.isArray(brokerValue) ? brokerValue : [],
    connectors: recordValue(connectorValue),
    providerKeys: stringMap({
      ...recordValue(globalProviderKeys),
      ...recordValue(recordValue(marketData)['providerKeys']),
    }),
  }
}

export function summarizeProjectTransferCredentials(
  bundle: ProjectTransferCredentialBundle,
): ProjectTransferCredentialSummary {
  const aiVendors = new Set<string>()
  for (const value of Object.values(bundle.ai.credentials)) {
    if (typeof value.vendor === 'string' && value.vendor.trim()) aiVendors.add(value.vendor)
  }
  const brokerPresets = new Set<string>()
  for (const value of bundle.brokerAccounts) {
    const record = recordValue(value)
    const preset = record['presetId'] ?? record['type'] ?? record['id']
    if (typeof preset === 'string' && preset.trim()) brokerPresets.add(preset)
  }
  const connectorRoot = recordValue(bundle.connectors['adapters'])
  return {
    ai: {
      count: Object.keys(bundle.ai.credentials).length,
      vendors: [...aiVendors].sort(),
    },
    broker: {
      count: bundle.brokerAccounts.length,
      presets: [...brokerPresets].sort(),
    },
    connector: {
      count: Object.keys(connectorRoot).length,
      adapters: Object.keys(connectorRoot).sort(),
    },
    providerKeys: {
      count: Object.keys(bundle.providerKeys).length,
      vendors: Object.keys(bundle.providerKeys).sort(),
    },
  }
}

export async function sealProjectTransferJson(
  home: string,
  relativePath: string,
  value: unknown,
): Promise<void> {
  const key = await loadOrCreateDestinationKey(home)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALG, key, iv)
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const envelope: SealedEnvelope = {
    $sealed: 1,
    alg: ALG,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }
  await writePrivateJson(join(home, relativePath), envelope)
}

async function readOptionalSecretJson(home: string, relativePath: string): Promise<unknown> {
  const value = await readOptionalJson(join(home, relativePath))
  if (!isSealedEnvelope(value)) return value
  const key = await readSourceKey(home)
  if (!key) throw transferSecretError(`Credential file ${relativePath} is sealed but the source sealing key is missing.`)
  try {
    const decipher = createDecipheriv(ALG, key, Buffer.from(value.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(value.data, 'base64')),
      decipher.final(),
    ])
    return JSON.parse(plaintext.toString('utf8')) as unknown
  } catch (error: unknown) {
    throw transferSecretError(`Credential file ${relativePath} could not be unsealed.`, error)
  }
}

async function readSourceKey(home: string): Promise<Buffer | null> {
  try {
    const key = Buffer.from((await readFile(join(home, 'sealing.key'), 'utf8')).trim(), 'base64')
    if (key.length !== KEY_BYTES) throw transferSecretError('The source sealing key is malformed.')
    return key
  } catch (error: unknown) {
    if (isNodeError(error, 'ENOENT')) return null
    throw error
  }
}

async function loadOrCreateDestinationKey(home: string): Promise<Buffer> {
  const existing = await readSourceKey(home)
  if (existing) return existing
  const path = join(home, 'sealing.key')
  const key = randomBytes(KEY_BYTES)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  try {
    await writeFile(path, `${key.toString('base64')}\n`, { mode: 0o600, flag: 'wx' })
    await chmod(path, 0o600).catch(() => undefined)
  } catch (error: unknown) {
    if (isNodeError(error, 'EEXIST')) {
      const raced = await readSourceKey(home)
      if (raced) return raced
    }
    throw error
  }
  return key
}

async function readOptionalJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error: unknown) {
    if (isNodeError(error, 'ENOENT')) return undefined
    throw transferSecretError(`Could not read credential configuration at ${path}.`, error)
  }
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
    await chmod(path, 0o600).catch(() => undefined)
  } catch (error: unknown) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

function isSealedEnvelope(value: unknown): value is SealedEnvelope {
  const record = recordValue(value)
  return record['$sealed'] === 1
    && record['alg'] === ALG
    && typeof record['iv'] === 'string'
    && typeof record['tag'] === 'string'
    && typeof record['data'] === 'string'
}

function stringMap(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function transferSecretError(message: string, cause?: unknown): Error & { code: string; exitCode: number } {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), {
    code: 'ETRANSFERSECRET',
    exitCode: 1,
  })
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}
