/** Bounded, checksum-verified AliceProject transfer stream and remote importer. */
import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  statfs,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { once } from 'node:events'

import { parseAiProviderVault, writeAiProviderVault } from './ai-credential-copy.ts'
import { transformProjectTransferFile } from './project-transfer-files.ts'
import {
  normalizeProjectTransferAiVault,
  readProjectTransferCredentialBundle,
  sealProjectTransferJson,
  type ProjectTransferCredentialBundle,
} from './project-transfer-secrets.ts'
import {
  PROJECT_TRANSFER_RECEIPT_FILE,
  PROJECT_TRANSFER_SCHEMA_VERSION,
  readProjectTransferCredentialSnapshot,
  validateManifestPath,
  type ProjectTransferEntry,
  type ProjectTransferPlan,
} from './project-transfer.ts'

const MAGIC = 'OPENALICE_PROJECT_TRANSFER/1'
const MAX_LINE_BYTES = 16 * 1024 * 1024
const MAX_ENTRIES = 250_000
const MAX_FILE_BYTES = 64 * 1024 * 1024 * 1024
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024 * 1024
const MAX_CREDENTIAL_BYTES = 16 * 1024 * 1024
const MARKER_FILE = '.openalice-transfer-transaction.json'

export interface ProjectTransferReceipt {
  schemaVersion: 1
  transferId: string
  sourceProjectId: string
  destinationProjectId: string
  destinationHome: string
  files: number
  bytes: number
  manifestSha256: string
  credentials: 'included' | 'omitted'
  sessionsImported: 0
  publishedAt: string
}

export async function writeProjectTransferStream(input: {
  plan: ProjectTransferPlan
  output: Writable
  signal?: AbortSignal
  onProgress?: (progress: { files: number; bytes: number; totalFiles: number; totalBytes: number }) => void
}): Promise<{ bytes: number }> {
  input.signal?.throwIfAborted()
  assertTransferPlan(input.plan)
  if (!input.plan.readyToApply) throw transferStreamError('Transfer plan has unresolved blockers.')
  let transferred = 0
  let transferredFiles = 0
  await writeChunk(input.output, Buffer.from(`${MAGIC}\n${JSON.stringify(input.plan)}\n`, 'utf8'))
  for (let index = 0; index < input.plan.portable.entries.length; index += 1) {
    input.signal?.throwIfAborted()
    const entry = input.plan.portable.entries[index]!
    const sourcePath = join(input.plan.source.home, ...entry.path.split('/'))
    const sourceInfo = await lstat(sourcePath)
    if (entry.kind === 'directory' && !sourceInfo.isDirectory()) {
      throw transferStreamError(`Portable directory changed after planning: ${entry.path}`)
    }
    if (entry.kind === 'symlink') {
      if (!sourceInfo.isSymbolicLink() || await readlink(sourcePath) !== entry.linkTarget) {
        throw transferStreamError(`Portable symlink changed after planning: ${entry.path}`)
      }
    }
    await writeChunk(input.output, Buffer.from(`${JSON.stringify({ type: 'entry', index })}\n`, 'utf8'))
    if (entry.kind !== 'file') continue
    if (!sourceInfo.isFile()) throw transferStreamError(`Portable file changed after planning: ${entry.path}`)
    const sourceHandle = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const openedInfo = await sourceHandle.stat()
      if (!openedInfo.isFile()) throw transferStreamError(`Portable file changed after planning: ${entry.path}`)
      if (entry.transform) {
        const source = await sourceHandle.readFile()
        assertSourceFile(entry, source.byteLength, sha256(source))
        const portable = transformProjectTransferFile({
          path: entry.path,
          transform: entry.transform,
          bytes: source,
          destinationHome: input.plan.destination.home,
        })
        assertPortableFile(entry, portable.byteLength, sha256(portable))
        await writeChunk(input.output, portable)
        transferred += portable.byteLength
        transferredFiles += 1
        input.onProgress?.({ files: transferredFiles, bytes: transferred, totalFiles: input.plan.portable.files, totalBytes: input.plan.portable.bytes })
        continue
      }
      if (openedInfo.size !== entry.size) throw transferStreamError(`Portable file changed after planning: ${entry.path}`)
      const hash = createHash('sha256')
      let size = 0
      for await (const chunk of sourceHandle.createReadStream({ autoClose: false })) {
        input.signal?.throwIfAborted()
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += bytes.byteLength
        if (size > entry.size) throw transferStreamError(`Portable file grew after planning: ${entry.path}`)
        hash.update(bytes)
        await writeChunk(input.output, bytes)
      }
      assertPortableFile(entry, size, hash.digest('hex'))
      transferred += size
      transferredFiles += 1
      input.onProgress?.({ files: transferredFiles, bytes: transferred, totalFiles: input.plan.portable.files, totalBytes: input.plan.portable.bytes })
    } finally {
      await sourceHandle.close()
    }
  }
  if (input.plan.policy.credentials === 'include') {
    input.signal?.throwIfAborted()
    const bytes = readProjectTransferCredentialSnapshot(input.plan)
    if (!bytes) throw transferStreamError('Credential snapshot is unavailable; review a new transfer plan.')
    if (bytes.byteLength > MAX_CREDENTIAL_BYTES) throw transferStreamError('Credential payload is too large.')
    await writeChunk(input.output, Buffer.from(`${JSON.stringify({
      type: 'credentials',
      size: bytes.byteLength,
      sha256: sha256(bytes),
    })}\n`, 'utf8'))
    await writeChunk(input.output, bytes)
  }
  await writeChunk(input.output, Buffer.from(`${JSON.stringify({ type: 'end' })}\n`, 'utf8'))
  return { bytes: transferred }
}

export async function receiveProjectTransferStream(input: {
  source: Readable
  now?: () => Date
  register?: (plan: ProjectTransferPlan, receipt: ProjectTransferReceipt) => Promise<void>
  availableBytes?: (path: string) => Promise<number>
}): Promise<ProjectTransferReceipt> {
  const reader = new AsyncByteReader(input.source)
  if (await reader.readLine() !== MAGIC) throw transferStreamError('Invalid AliceProject transfer stream.')
  const plan = parseTransferPlan(await reader.readLine())
  assertTransferPlan(plan)
  if (!plan.readyToApply) throw transferStreamError('Transfer plan has unresolved blockers.')
  const destination = plan.destination.home
  await assertCanonicalDestination(destination)
  const staging = join(dirname(destination), `.openalice-transfer-${plan.transferId}.staging`)
  const existingReceipt = await readPublishedReceipt(destination)
  if (existingReceipt) {
    const expectedManifestSha256 = sha256(Buffer.from(JSON.stringify(plan.portable.entries), 'utf8'))
    const expectedCredentials = plan.policy.credentials === 'include' ? 'included' : 'omitted'
    if (
      existingReceipt.transferId !== plan.transferId
      || existingReceipt.destinationHome !== destination
      || existingReceipt.destinationProjectId !== plan.destination.projectId
      || existingReceipt.sourceProjectId !== plan.source.projectId
      || existingReceipt.files !== plan.portable.files
      || existingReceipt.bytes !== plan.portable.bytes
      || existingReceipt.manifestSha256 !== expectedManifestSha256
      || existingReceipt.credentials !== expectedCredentials
      || existingReceipt.sessionsImported !== 0
    ) {
      throw transferStreamError(`Destination already contains another AliceProject: ${destination}`)
    }
    const retryCredentialBytes = await verifyAndDiscardPayload(reader, plan)
    await verifyPublishedDestination(destination, plan, retryCredentialBytes)
    await input.register?.(plan, existingReceipt)
    return existingReceipt
  }
  const availableBytes = await (input.availableBytes ?? readAvailableBytes)(dirname(destination))
  if (availableBytes < plan.destination.requiredFreeBytes) {
    throw transferStreamError(
      `Destination has insufficient free space: requires ${plan.destination.requiredFreeBytes} bytes, ${availableBytes} bytes available.`,
    )
  }
  await prepareStaging(staging, destination, plan.transferId)
  let receivedBytes = 0
  try {
    for (let index = 0; index < plan.portable.entries.length; index += 1) {
      const entry = plan.portable.entries[index]!
      const header = parseRecord(await reader.readLine())
      if (header['type'] !== 'entry' || header['index'] !== index) {
        throw transferStreamError(`Transfer stream entry order changed at index ${index}.`)
      }
      const path = join(staging, ...entry.path.split('/'))
      if (entry.kind === 'directory') {
        await mkdir(path, { recursive: true, mode: safeDirectoryMode(entry.mode) })
        await chmod(path, safeDirectoryMode(entry.mode)).catch(() => undefined)
      } else if (entry.kind === 'symlink') {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 })
        assertSafeStagedSymlink(staging, path, entry.linkTarget ?? '')
        await symlink(entry.linkTarget!, path)
      } else {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 })
        const handle = await open(path, 'wx', safeFileMode(entry.mode))
        const hash = createHash('sha256')
        try {
          await reader.readExactly(entry.size, async (chunk) => {
            hash.update(chunk)
            await handle.write(chunk)
          })
        } finally {
          await handle.close()
        }
        const digest = hash.digest('hex')
        if (digest !== entry.sha256) throw transferStreamError(`Checksum mismatch for ${entry.path}.`)
        await chmod(path, safeFileMode(entry.mode)).catch(() => undefined)
        receivedBytes += entry.size
      }
    }

    let credentialBundle: ProjectTransferCredentialBundle | null = null
    let final = parseRecord(await reader.readLine())
    if (final['type'] === 'credentials') {
      if (plan.policy.credentials !== 'include') throw transferStreamError('Unexpected credential payload.')
      const size = requireBoundedInteger(final['size'], 0, MAX_CREDENTIAL_BYTES, 'credential size')
      const expected = requireSha(final['sha256'], 'credential checksum')
      const bytes = await reader.readBuffer(size)
      if (sha256(bytes) !== expected) throw transferStreamError('Credential payload checksum mismatch.')
      credentialBundle = parseCredentialBundle(bytes)
      final = parseRecord(await reader.readLine())
    }
    if (final['type'] !== 'end') throw transferStreamError('Transfer stream did not terminate cleanly.')
    if (plan.policy.credentials === 'include' && !credentialBundle) {
      throw transferStreamError('Credential payload is missing.')
    }
    if (credentialBundle) await writeCredentialBundle(staging, credentialBundle)

    const receipt: ProjectTransferReceipt = {
      schemaVersion: 1,
      transferId: plan.transferId,
      sourceProjectId: plan.source.projectId,
      destinationProjectId: plan.destination.projectId,
      destinationHome: destination,
      files: plan.portable.files,
      bytes: receivedBytes,
      manifestSha256: sha256(Buffer.from(JSON.stringify(plan.portable.entries), 'utf8')),
      credentials: plan.policy.credentials === 'include' ? 'included' : 'omitted',
      sessionsImported: 0,
      publishedAt: (input.now ?? (() => new Date()))().toISOString(),
    }
    await writePrivateJson(join(staging, PROJECT_TRANSFER_RECEIPT_FILE), receipt)
    await rm(join(staging, MARKER_FILE), { force: true })
    await rename(staging, destination)
    await input.register?.(plan, receipt)
    return receipt
  } catch (error: unknown) {
    await writeFailureMarker(staging, destination, plan.transferId, error).catch(() => undefined)
    throw error
  }
}

async function assertCanonicalDestination(destination: string): Promise<void> {
  let existing = destination
  const missing: string[] = []
  while (!(await exists(existing))) {
    const parent = dirname(existing)
    if (parent === existing) break
    missing.unshift(basename(existing))
    existing = parent
  }
  const canonical = resolve(await realpath(existing), ...missing)
  if (canonical !== resolve(destination)) {
    throw transferStreamError(
      'Destination Home resolves through a symlink; use its canonical path before planning the transfer.',
    )
  }
}

async function verifyAndDiscardPayload(reader: AsyncByteReader, plan: ProjectTransferPlan): Promise<Buffer | null> {
  for (let index = 0; index < plan.portable.entries.length; index += 1) {
    const entry = plan.portable.entries[index]!
    const header = parseRecord(await reader.readLine())
    if (header['type'] !== 'entry' || header['index'] !== index) {
      throw transferStreamError(`Transfer stream entry order changed at index ${index}.`)
    }
    if (entry.kind !== 'file') continue
    const hash = createHash('sha256')
    await reader.readExactly(entry.size, (chunk) => { hash.update(chunk) })
    if (hash.digest('hex') !== entry.sha256) throw transferStreamError(`Checksum mismatch for ${entry.path}.`)
  }
  let final = parseRecord(await reader.readLine())
  let credentialBytes: Buffer | null = null
  if (final['type'] === 'credentials') {
    if (plan.policy.credentials !== 'include') throw transferStreamError('Unexpected credential payload.')
    const size = requireBoundedInteger(final['size'], 0, MAX_CREDENTIAL_BYTES, 'credential size')
    const expected = requireSha(final['sha256'], 'credential checksum')
    const bytes = await reader.readBuffer(size)
    if (sha256(bytes) !== expected) throw transferStreamError('Credential payload checksum mismatch.')
    credentialBytes = bytes
    final = parseRecord(await reader.readLine())
  }
  if (final['type'] !== 'end') throw transferStreamError('Transfer stream did not terminate cleanly.')
  if (plan.policy.credentials === 'include' && !credentialBytes) {
    throw transferStreamError('Credential payload is missing.')
  }
  return credentialBytes
}

function assertTransferPlan(plan: ProjectTransferPlan): void {
  if (plan.schemaVersion !== PROJECT_TRANSFER_SCHEMA_VERSION) throw transferStreamError('Unsupported transfer plan schema.')
  if (!/^[a-zA-Z0-9-]{1,128}$/u.test(plan.transferId)) throw transferStreamError('Invalid transfer id.')
  if (!isAbsolute(plan.source.home) || !isAbsolute(plan.destination.home)) throw transferStreamError('Transfer homes must be absolute paths.')
  if (
    dirname(plan.destination.home) === plan.destination.home
    || /[\u0000-\u001f\u007f-\u009f]/u.test(plan.destination.home)
  ) throw transferStreamError('Destination Home is unsafe.')
  requireBoundedInteger(plan.destination.requiredFreeBytes, 0, Number.MAX_SAFE_INTEGER, 'required free bytes')
  if (plan.portable.entries.length > MAX_ENTRIES) throw transferStreamError('Transfer manifest has too many entries.')
  let total = 0
  const paths = new Set<string>()
  const symlinks = new Set(
    plan.portable.entries.filter((entry) => entry.kind === 'symlink').map((entry) => entry.path),
  )
  let files = 0
  let directories = 0
  let symlinkCount = 0
  for (const entry of plan.portable.entries) {
    validateTransferEntry(entry)
    if (paths.has(entry.path)) throw transferStreamError(`Duplicate transfer path: ${entry.path}`)
    for (const symlinkPath of symlinks) {
      if (entry.path.startsWith(`${symlinkPath}/`)) throw transferStreamError(`Transfer path traverses a symlink: ${entry.path}`)
    }
    paths.add(entry.path)
    if (entry.kind === 'file') files += 1
    else if (entry.kind === 'directory') directories += 1
    else symlinkCount += 1
    total += entry.size
    if (total > MAX_TOTAL_BYTES) throw transferStreamError('Transfer manifest is too large.')
  }
  if (total !== plan.portable.bytes) throw transferStreamError('Transfer manifest byte total is inconsistent.')
  if (
    files !== plan.portable.files
    || directories !== plan.portable.directories
    || symlinkCount !== plan.portable.symlinks
  ) throw transferStreamError('Transfer manifest entry totals are inconsistent.')
}

async function verifyPublishedDestination(
  destination: string,
  plan: ProjectTransferPlan,
  retryCredentialBytes: Buffer | null,
): Promise<void> {
  try {
    for (const entry of plan.portable.entries) {
      // Included credentials intentionally replace the stripped portable AI
      // vault; the private bundle verification below owns its final bytes.
      if (
        plan.policy.credentials === 'include'
        && entry.path === 'data/config/ai-provider-manager.json'
      ) continue
      const path = join(destination, ...entry.path.split('/'))
      const info = await lstat(path)
      if (entry.kind === 'directory') {
        if (!info.isDirectory()) throw new Error(`${entry.path} changed type`)
      } else if (entry.kind === 'symlink') {
        if (!info.isSymbolicLink() || await readlink(path) !== entry.linkTarget) {
          throw new Error(`${entry.path} changed symlink target`)
        }
      } else {
        if (!info.isFile() || info.size !== entry.size) throw new Error(`${entry.path} changed size or type`)
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          const hash = createHash('sha256')
          let size = 0
          for await (const chunk of handle.createReadStream({ autoClose: false })) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            size += bytes.byteLength
            hash.update(bytes)
          }
          if (size !== entry.size || hash.digest('hex') !== entry.sha256) {
            throw new Error(`${entry.path} changed content`)
          }
        } finally {
          await handle.close()
        }
      }
    }
    if (plan.policy.credentials === 'include') {
      if (!retryCredentialBytes) throw new Error('credential payload is missing')
      const expected = parseCredentialBundle(retryCredentialBytes)
      const actual = await readProjectTransferCredentialBundle(destination)
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('credential bundle changed')
    }
    await assertPublishedEntrySet(destination, plan)
  } catch (error: unknown) {
    throw transferStreamError(
      'Published transfer destination changed before registration retry; choose a new destination Home.',
      error,
    )
  }
}

async function assertPublishedEntrySet(destination: string, plan: ProjectTransferPlan): Promise<void> {
  const allowed = new Set(plan.portable.entries.map((entry) => entry.path))
  allowed.add(PROJECT_TRANSFER_RECEIPT_FILE)
  if (plan.policy.credentials === 'include') {
    for (const path of [
      'sealing.key',
      'provider-keys.json',
      'data/config/ai-provider-manager.json',
      'data/config/accounts.json',
      'data/config/connectors.json',
    ]) allowed.add(path)
  }
  for (const path of [...allowed]) {
    const parts = path.split('/')
    for (let index = 1; index < parts.length; index += 1) {
      allowed.add(parts.slice(0, index).join('/'))
    }
  }

  const pending = ['']
  while (pending.length > 0) {
    const parent = pending.pop()!
    const absoluteParent = parent
      ? join(destination, ...parent.split('/'))
      : destination
    for (const name of await readdir(absoluteParent)) {
      const path = parent ? `${parent}/${name}` : name
      if (!allowed.has(path)) throw new Error(`unexpected published path ${path}`)
      const info = await lstat(join(destination, ...path.split('/')))
      if (info.isDirectory()) pending.push(path)
    }
  }
}

async function readAvailableBytes(path: string): Promise<number> {
  let current = path
  while (!(await exists(current))) {
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  const info = await statfs(current, { bigint: true })
  const available = info.bavail * info.bsize
  return available > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(available)
}

function validateTransferEntry(entry: ProjectTransferEntry): void {
  validateManifestPath(entry.path)
  if (!['directory', 'file', 'symlink'].includes(entry.kind)) throw transferStreamError(`Invalid transfer entry kind: ${entry.path}`)
  requireBoundedInteger(entry.mode, 0, 0o777, 'entry mode')
  requireBoundedInteger(entry.size, 0, MAX_FILE_BYTES, 'entry size')
  if (entry.kind === 'file') requireSha(entry.sha256, 'entry checksum')
  else if (entry.size !== 0 || entry.sha256 !== null) throw transferStreamError(`Non-file entry carries file bytes: ${entry.path}`)
  if (entry.kind === 'symlink' && typeof entry.linkTarget !== 'string') throw transferStreamError(`Symlink target is missing: ${entry.path}`)
}

async function prepareStaging(staging: string, destination: string, transferId: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
  if (await exists(destination)) throw transferStreamError(`Destination already exists: ${destination}`)
  if (await exists(staging)) {
    const marker = await readMarker(staging)
    if (marker['transferId'] !== transferId || marker['destination'] !== destination) {
      throw transferStreamError(`Refusing to reuse unrecognized staging path: ${staging}`)
    }
    await rm(staging, { recursive: true, force: true })
  }
  await mkdir(staging, { recursive: false, mode: 0o700 })
  await writePrivateJson(join(staging, MARKER_FILE), {
    schemaVersion: 1,
    transferId,
    destination,
    state: 'receiving',
    createdAt: new Date().toISOString(),
  })
}

async function writeCredentialBundle(home: string, bundle: ProjectTransferCredentialBundle): Promise<void> {
  await writeAiProviderVault(home, bundle.ai)
  await writePrivateJson(join(home, 'provider-keys.json'), bundle.providerKeys)
  await sealProjectTransferJson(home, join('data', 'config', 'accounts.json'), bundle.brokerAccounts)
  await sealProjectTransferJson(home, join('data', 'config', 'connectors.json'), bundle.connectors)
}

async function readPublishedReceipt(destination: string): Promise<ProjectTransferReceipt | null> {
  try {
    return parseReceipt(JSON.parse(await readFile(join(destination, PROJECT_TRANSFER_RECEIPT_FILE), 'utf8')) as unknown)
  } catch (error: unknown) {
    if (isNodeError(error, 'ENOENT')) return null
    throw error
  }
}

async function readMarker(staging: string): Promise<Record<string, unknown>> {
  try {
    return parseRecord(await readFile(join(staging, MARKER_FILE), 'utf8'))
  } catch (error: unknown) {
    throw transferStreamError(`Could not validate existing transfer staging at ${staging}.`, error)
  }
}

async function writeFailureMarker(
  staging: string,
  destination: string,
  transferId: string,
  error: unknown,
): Promise<void> {
  if (!await exists(staging)) return
  await writePrivateJson(join(staging, MARKER_FILE), {
    schemaVersion: 1,
    transferId,
    destination,
    state: 'failed',
    code: error instanceof Error && 'code' in error ? String(error.code) : 'ETRANSFER',
  })
}

function parseTransferPlan(value: string): ProjectTransferPlan {
  return JSON.parse(value) as ProjectTransferPlan
}

function parseCredentialBundle(bytes: Buffer): ProjectTransferCredentialBundle {
  const value = JSON.parse(bytes.toString('utf8')) as unknown
  const root = requireRecord(value, 'credential payload')
  return {
    ai: normalizeProjectTransferAiVault(parseAiProviderVault(root['ai'])),
    brokerAccounts: Array.isArray(root['brokerAccounts']) ? root['brokerAccounts'] : [],
    connectors: requireRecord(root['connectors'], 'Connector credential payload'),
    providerKeys: Object.fromEntries(
      Object.entries(requireRecord(root['providerKeys'], 'provider key payload'))
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ),
  }
}

function parseReceipt(value: unknown): ProjectTransferReceipt {
  const root = requireRecord(value, 'transfer receipt')
  const transferId = root['transferId']
  const sourceProjectId = root['sourceProjectId']
  const destinationProjectId = root['destinationProjectId']
  const destinationHome = root['destinationHome']
  const files = root['files']
  const bytes = root['bytes']
  const manifestSha256 = root['manifestSha256']
  const credentials = root['credentials']
  const publishedAt = root['publishedAt']
  if (
    root['schemaVersion'] !== 1
    || typeof transferId !== 'string'
    || transferId.length < 1
    || typeof sourceProjectId !== 'string'
    || sourceProjectId.length < 1
    || typeof destinationProjectId !== 'string'
    || destinationProjectId.length < 1
    || typeof destinationHome !== 'string'
    || destinationHome.length < 1
    || !Number.isSafeInteger(files)
    || Number(files) < 0
    || !Number.isSafeInteger(bytes)
    || Number(bytes) < 0
    || typeof manifestSha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(manifestSha256)
    || (credentials !== 'included' && credentials !== 'omitted')
    || root['sessionsImported'] !== 0
    || typeof publishedAt !== 'string'
    || !Number.isFinite(Date.parse(publishedAt))
  ) throw transferStreamError('Invalid transfer receipt.')
  return {
    schemaVersion: 1,
    transferId,
    sourceProjectId,
    destinationProjectId,
    destinationHome,
    files: Number(files),
    bytes: Number(bytes),
    manifestSha256,
    credentials,
    sessionsImported: 0,
    publishedAt,
  }
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    return requireRecord(JSON.parse(value) as unknown, 'transfer record')
  } catch (error: unknown) {
    throw transferStreamError('Invalid transfer stream record.', error)
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw transferStreamError(`Invalid ${label}.`)
  return value as Record<string, unknown>
}

function assertSourceFile(entry: ProjectTransferEntry, size: number, digest: string): void {
  if (entry.sourceSize !== size || entry.sourceSha256 !== digest) throw transferStreamError(`Portable file changed after planning: ${entry.path}`)
}

function assertPortableFile(entry: ProjectTransferEntry, size: number, digest: string): void {
  if (entry.size !== size || entry.sha256 !== digest) throw transferStreamError(`Portable file changed after planning: ${entry.path}`)
}

function assertSafeStagedSymlink(staging: string, path: string, target: string): void {
  if (!target || isAbsolute(target) || /[\u0000-\u001f\u007f-\u009f]/u.test(target)) throw transferStreamError(`Unsafe symlink target for ${basename(path)}.`)
  const resolved = resolve(dirname(path), target)
  if (resolved !== staging && !resolved.startsWith(`${staging}${sep}`)) throw transferStreamError(`Symlink escapes transfer staging: ${relative(staging, path)}`)
}

function safeFileMode(mode: number): number {
  return mode & 0o111 ? 0o700 : 0o600
}

function safeDirectoryMode(_mode: number): number {
  return 0o700
}

function requireBoundedInteger(value: unknown, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw transferStreamError(`Invalid ${label}.`)
  return Number(value)
}

function requireSha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw transferStreamError(`Invalid ${label}.`)
  return value
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

async function writeChunk(output: Writable, value: Buffer): Promise<void> {
  if (!output.write(value)) await once(output, 'drain')
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

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error: unknown) {
    if (isNodeError(error, 'ENOENT')) return false
    throw error
  }
}

class AsyncByteReader {
  private readonly iterator: AsyncIterator<unknown>
  private buffered = Buffer.alloc(0)
  private ended = false

  constructor(source: Readable) {
    this.iterator = source[Symbol.asyncIterator]()
  }

  async readLine(): Promise<string> {
    while (true) {
      const newline = this.buffered.indexOf(0x0a)
      if (newline >= 0) {
        const line = this.buffered.subarray(0, newline)
        this.buffered = this.buffered.subarray(newline + 1)
        return line.toString('utf8')
      }
      if (this.buffered.byteLength > MAX_LINE_BYTES) throw transferStreamError('Transfer stream record is too large.')
      if (!await this.pull()) throw transferStreamError('Transfer stream ended unexpectedly.')
    }
  }

  async readBuffer(size: number): Promise<Buffer> {
    const chunks: Buffer[] = []
    await this.readExactly(size, (chunk) => { chunks.push(Buffer.from(chunk)) })
    return Buffer.concat(chunks, size)
  }

  async readExactly(size: number, consume: (chunk: Buffer) => void | Promise<void>): Promise<void> {
    let remaining = size
    while (remaining > 0) {
      if (this.buffered.byteLength === 0 && !await this.pull()) throw transferStreamError('Transfer stream ended inside a file.')
      const length = Math.min(remaining, this.buffered.byteLength)
      const chunk = this.buffered.subarray(0, length)
      this.buffered = this.buffered.subarray(length)
      remaining -= length
      await consume(chunk)
    }
  }

  private async pull(): Promise<boolean> {
    if (this.ended) return false
    const next = await this.iterator.next()
    if (next.done) {
      this.ended = true
      return false
    }
    const bytes = Buffer.from(
      typeof next.value === 'string' ? next.value : next.value as Uint8Array,
    )
    this.buffered = this.buffered.byteLength === 0 ? bytes : Buffer.concat([this.buffered, bytes])
    return true
  }
}

function transferStreamError(message: string, cause?: unknown): Error & { code: string; exitCode: number } {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), {
    code: 'ETRANSFERSTREAM',
    exitCode: 1,
  })
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}
