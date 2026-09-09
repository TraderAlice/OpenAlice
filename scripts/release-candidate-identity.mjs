import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const targetKeys = new Set(['darwin-arm64', 'darwin-x64', 'win32-arm64', 'win32-x64', 'linux-arm64', 'linux-x64'])
const headerKeys = ['sourceSha', 'version', 'channel', 'platform', 'arch', 'kind']

function validateHeader(header) {
  if (!/^[a-f0-9]{40}$/.test(header.sourceSha ?? '')) throw new Error('Invalid candidate source SHA')
  if (!targetKeys.has(`${header.platform}-${header.arch}`)) throw new Error('Invalid candidate target')
  if (!['desktop', 'cli'].includes(header.kind)) throw new Error('Invalid candidate kind')
  const pattern = header.channel === 'stable' ? /^\d+\.\d+\.\d+$/
    : header.channel === 'beta' ? /^\d+\.\d+\.\d+-beta(?:\.\d+)?$/ : null
  if (!pattern?.test(header.version ?? '')) throw new Error('Invalid candidate version/channel')
}

function validateFiles(files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('Candidate has no files')
  const seen = new Set()
  for (const file of files) {
    if (typeof file.name !== 'string' || !file.name || file.name !== basename(file.name)
      || /[\\/\x00-\x1f]/.test(file.name) || ['.', '..'].includes(file.name)
      || seen.has(file.name) || !Number.isSafeInteger(file.size) || file.size < 0
      || !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')) throw new Error('Invalid candidate file entry')
    seen.add(file.name)
  }
}

function canonicalPayload(manifest) {
  validateHeader(manifest)
  validateFiles(manifest.files)
  return {
    schemaVersion: 1,
    ...Object.fromEntries(headerKeys.map((key) => [key, manifest[key]])),
    files: manifest.files.map(({ name, size, sha256 }) => ({ name, size, sha256 }))
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  }
}

function inventory(directory, names) {
  return names.map((name) => {
    if (name !== basename(name) || /[\\/\x00-\x1f]/.test(name) || ['.', '..'].includes(name)) {
      throw new Error('Unsafe candidate filename')
    }
    const path = join(directory, name)
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Candidate must contain regular files')
    const bytes = readFileSync(path)
    return { name, size: bytes.length, sha256: sha256(bytes) }
  })
}

export function createCandidateIdentity({ directory, filenames, ...header }) {
  const payload = canonicalPayload({ ...header, files: inventory(directory, filenames) })
  return { ...payload, candidateId: sha256(JSON.stringify(payload)) }
}

// Expected identity comes from the selected candidate record, not from the
// downloaded manifest itself. Workflows own trusted source/run selection.
export function verifyCandidateIdentity({ directory, manifest, expected, ignoredFiles = [] }) {
  if (manifest?.schemaVersion !== 1) throw new Error('Unsupported candidate manifest')
  if (!expected || headerKeys.some((key) => expected[key] === undefined)
    || !/^[a-f0-9]{64}$/.test(expected.candidateId ?? '')) {
    throw new Error('Explicit candidate expectations are required')
  }
  validateHeader(expected)
  const payload = canonicalPayload(manifest)
  for (const key of headerKeys) {
    if (payload[key] !== expected[key]) throw new Error(`Candidate ${key} mismatch`)
  }
  const candidateId = sha256(JSON.stringify(payload))
  if (candidateId !== manifest.candidateId) throw new Error('Candidate manifest identity mismatch')
  if (candidateId !== expected.candidateId) {
    throw new Error('Selected candidate identity mismatch')
  }
  const names = payload.files.map(({ name }) => name)
  const actualNames = readdirSync(directory).filter((name) => !ignoredFiles.includes(name)).sort()
  if (JSON.stringify(actualNames) !== JSON.stringify([...names].sort())) {
    throw new Error('Candidate file set mismatch')
  }
  const actual = inventory(directory, names)
  if (JSON.stringify(actual) !== JSON.stringify(payload.files)) throw new Error('Candidate bytes mismatch')
  return candidateId
}

export function createCandidateAcceptance({ candidateId, verifierSha, checkKind, checks }) {
  if (!/^[a-f0-9]{64}$/.test(candidateId ?? '') || !/^[a-f0-9]{40}$/.test(verifierSha ?? '')) {
    throw new Error('Invalid acceptance identity')
  }
  if (typeof checkKind !== 'string' || !checkKind || !checks || Array.isArray(checks)
    || Object.keys(checks).length === 0 || Object.values(checks).some((value) => value !== true)) {
    throw new Error('Acceptance checks did not pass')
  }
  return { schemaVersion: 1, candidateId, verifierSha, checkKind, checks }
}

export function verifyCandidateAcceptance({ receipt, candidateId, verifierSha, checkKind, requiredChecks }) {
  if (!Array.isArray(requiredChecks) || requiredChecks.length === 0) throw new Error('Required checks are missing')
  if (receipt?.schemaVersion !== 1 || receipt.candidateId !== candidateId
    || receipt.verifierSha !== verifierSha || receipt.checkKind !== checkKind) {
    throw new Error('Acceptance does not match selected candidate/verifier')
  }
  createCandidateAcceptance(receipt)
  if (requiredChecks.some((key) => receipt.checks[key] !== true)) throw new Error('Required acceptance check missing')
  return true
}
