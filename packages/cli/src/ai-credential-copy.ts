/**
 * Copy AI vault credentials between AliceProject complete homes.
 *
 * The vault is `<home>/data/config/ai-provider-manager.json`. Broker
 * accounts and sealing keys stay untouched. Secrets are never logged.
 */
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const AI_PROVIDER_FILE_REL = join('data', 'config', 'ai-provider-manager.json')

export interface AiCredentialRecord {
  vendor: string
  authType?: string
  apiKey?: string
  label?: string
  wires?: Record<string, string>
  baseUrl?: string
  wireShape?: string
  lastModel?: string
}

export interface AiProviderVault {
  credentials: Record<string, AiCredentialRecord>
  workspaceCredentialDefaults?: Record<string, { credentialSlug: string; [key: string]: unknown }>
  [key: string]: unknown
}

export interface AiCredentialCopyPlan {
  copied: string[]
  skipped: string[]
  renamed: Array<{ from: string; to: string }>
}

export interface AiCredentialCopyResult extends AiCredentialCopyPlan {
  fromKey: string
  toKey: string
  fromHome: string
  toHome: string
}

export function credentialIdentity(credential: AiCredentialRecord): string {
  return `${credential.vendor}\0${credential.authType ?? ''}\0${credential.apiKey ?? ''}`
}

export function allocateCredentialSlug(vendor: string, taken: Set<string>): string {
  const prefix = vendor.trim() || 'custom'
  let n = 1
  while (taken.has(`${prefix}-${n}`)) n += 1
  return `${prefix}-${n}`
}

export function mergeAiCredentials(
  source: Record<string, AiCredentialRecord>,
  dest: Record<string, AiCredentialRecord>,
): { credentials: Record<string, AiCredentialRecord>; aliases: Array<{ from: string; to: string }> }
  & AiCredentialCopyPlan {
  const destByIdentity = new Map(
    Object.entries(dest).map(([slug, credential]) => [credentialIdentity(credential), slug]),
  )
  const taken = new Set(Object.keys(dest))
  const credentials = { ...dest }
  const copied: string[] = []
  const skipped: string[] = []
  const renamed: Array<{ from: string; to: string }> = []
  const aliases: Array<{ from: string; to: string }> = []

  for (const [slug, credential] of Object.entries(source)) {
    if (!isCopyableCredential(credential)) continue
    const existing = destByIdentity.get(credentialIdentity(credential))
    if (existing) {
      skipped.push(slug)
      if (existing !== slug) aliases.push({ from: slug, to: existing })
      continue
    }
    let destSlug = slug
    if (taken.has(destSlug)) {
      destSlug = allocateCredentialSlug(credential.vendor, taken)
      renamed.push({ from: slug, to: destSlug })
    }
    credentials[destSlug] = { ...credential }
    taken.add(destSlug)
    destByIdentity.set(credentialIdentity(credential), destSlug)
    copied.push(destSlug)
    if (destSlug !== slug) aliases.push({ from: slug, to: destSlug })
  }
  return { credentials, copied, skipped, renamed, aliases }
}

export function mergeWorkspaceCredentialDefaults(
  source: AiProviderVault['workspaceCredentialDefaults'],
  dest: AiProviderVault['workspaceCredentialDefaults'],
  credentials: Record<string, AiCredentialRecord>,
  renamed: Array<{ from: string; to: string }>,
): AiProviderVault['workspaceCredentialDefaults'] {
  if (!source) return dest
  const renameMap = new Map(renamed.map((entry) => [entry.from, entry.to]))
  const next = { ...dest }
  for (const [agentId, def] of Object.entries(source)) {
    if (!agentId || next[agentId]) continue
    if (!def || typeof def.credentialSlug !== 'string' || !def.credentialSlug) continue
    const mapped = renameMap.get(def.credentialSlug) ?? def.credentialSlug
    if (!credentials[mapped]) continue
    next[agentId] = { ...def, credentialSlug: mapped }
  }
  return Object.keys(next).length > 0 ? next : dest
}

export async function readAiProviderVault(home: string): Promise<AiProviderVault> {
  const path = join(home, AI_PROVIDER_FILE_REL)
  try {
    return parseAiProviderVault(JSON.parse(await readFile(path, 'utf8')))
  } catch (error: unknown) {
    if (isNodeError(error, 'ENOENT')) return { credentials: {} }
    throw Object.assign(
      new Error(`Could not read AI credentials at ${path}: ${errorMessage(error)}`),
      { code: 'EAIVAULT', exitCode: 1 },
    )
  }
}

export async function writeAiProviderVault(home: string, vault: AiProviderVault): Promise<void> {
  const dir = join(home, 'data', 'config')
  const path = join(dir, 'ai-provider-manager.json')
  const temporary = join(dir, `.ai-provider-manager.${process.pid}.${randomUUID()}.tmp`)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  try {
    await writeFile(
      temporary,
      `${JSON.stringify(vault, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600, flag: 'wx' },
    )
    await rename(temporary, path)
  } catch (error: unknown) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw Object.assign(
      new Error(`Could not write AI credentials at ${path}: ${errorMessage(error)}`),
      { code: 'EAIVAULT', exitCode: 1 },
    )
  }
}

export async function copyAiCredentials(input: {
  fromKey: string
  toKey: string
  fromHome: string
  toHome: string
}): Promise<AiCredentialCopyResult> {
  if (input.fromKey === input.toKey) {
    throw Object.assign(new Error('Source and destination AliceProjects must be different.'), {
      code: 'EUSAGE',
      exitCode: 2,
    })
  }
  if (await sameHome(input.fromHome, input.toHome)) {
    throw Object.assign(new Error('Source and destination use the same complete home.'), {
      code: 'EUSAGE',
      exitCode: 2,
    })
  }
  const source = await readAiProviderVault(input.fromHome)
  const dest = await readAiProviderVault(input.toHome)
  const merged = mergeAiCredentials(source.credentials, dest.credentials)
  const workspaceCredentialDefaults = mergeWorkspaceCredentialDefaults(
    source.workspaceCredentialDefaults,
    dest.workspaceCredentialDefaults,
    merged.credentials,
    merged.aliases,
  )
  if (merged.copied.length > 0) {
    await writeAiProviderVault(input.toHome, {
      ...dest,
      credentials: merged.credentials,
      ...(workspaceCredentialDefaults
        ? { workspaceCredentialDefaults }
        : {}),
    })
  }
  return {
    fromKey: input.fromKey,
    toKey: input.toKey,
    fromHome: input.fromHome,
    toHome: input.toHome,
    copied: merged.copied,
    skipped: merged.skipped,
    renamed: merged.renamed,
  }
}

export function formatAiCredentialCopyResult(result: AiCredentialCopyResult): string {
  const lines = [
    `Copied AI credentials from ${result.fromKey} to ${result.toKey}.`,
    `Added ${result.copied.length}, skipped ${result.skipped.length} already present.`,
  ]
  if (result.renamed.length > 0) {
    lines.push(
      `Renamed colliding slugs: ${result.renamed.map((entry) => `${entry.from} → ${entry.to}`).join(', ')}.`,
    )
  }
  if (result.copied.length === 0 && result.skipped.length === 0) {
    return `No AI credentials in ${result.fromKey} to copy.\n`
  }
  return `${lines.join('\n')}\n`
}

export function parseAiProviderVault(value: unknown): AiProviderVault {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { credentials: {} }
  }
  const root = value as Record<string, unknown>
  const credentials: Record<string, AiCredentialRecord> = {}
  if (root.credentials && typeof root.credentials === 'object' && !Array.isArray(root.credentials)) {
    for (const [slug, raw] of Object.entries(root.credentials as Record<string, unknown>)) {
      if (!slug || typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
      const record = raw as Record<string, unknown>
      if (typeof record.vendor !== 'string' || !record.vendor.trim()) continue
      credentials[slug] = {
        ...(record as unknown as AiCredentialRecord),
        vendor: record.vendor,
      }
    }
  }
  let workspaceCredentialDefaults: AiProviderVault['workspaceCredentialDefaults']
  if (
    root.workspaceCredentialDefaults
    && typeof root.workspaceCredentialDefaults === 'object'
    && !Array.isArray(root.workspaceCredentialDefaults)
  ) {
    workspaceCredentialDefaults = {}
    for (const [agentId, raw] of Object.entries(
      root.workspaceCredentialDefaults as Record<string, unknown>,
    )) {
      if (!agentId || typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
      const record = raw as Record<string, unknown>
      if (typeof record.credentialSlug !== 'string' || !record.credentialSlug) continue
      workspaceCredentialDefaults[agentId] = {
        ...record,
        credentialSlug: record.credentialSlug,
      }
    }
  }
  return {
    ...root,
    credentials,
    ...(workspaceCredentialDefaults ? { workspaceCredentialDefaults } : {}),
  }
}

function isCopyableCredential(credential: AiCredentialRecord): boolean {
  return typeof credential.vendor === 'string' && credential.vendor.trim().length > 0
}

async function sameHome(left: string, right: string): Promise<boolean> {
  try {
    return await realpath(left) === await realpath(right)
  } catch {
    return join(left) === join(right)
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
