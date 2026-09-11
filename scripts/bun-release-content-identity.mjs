import { createHash } from 'node:crypto'

const IDENTITY_DOMAIN = 'OpenAlice Bun native release payload v1'

/**
 * Derive the native release identity from the complete, self-reference-free
 * release manifest. `release.json` itself must not appear in `files` because it
 * stores the resulting identity.
 */
export function bunReleaseContentIdentity(release) {
  if (!release || typeof release !== 'object' || Array.isArray(release)) {
    throw new Error('Bun release identity requires release metadata')
  }
  if (!Array.isArray(release.files) || release.files.length === 0) {
    throw new Error('Bun release identity requires a non-empty files manifest')
  }
  const paths = new Set()
  for (const entry of release.files) {
    validateReleaseEntry(entry, paths)
  }

  const { contentIdentity: _ignored, ...unsignedRelease } = release
  const normalized = {
    ...unsignedRelease,
    files: [...release.files].sort(compareReleaseEntries),
  }
  return createHash('sha256')
    .update(`${IDENTITY_DOMAIN}\n`)
    .update(canonicalJson(normalized))
    .digest('hex')
    .slice(0, 16)
}

function validateReleaseEntry(entry, paths) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error('Bun release identity contains an invalid file entry')
  }
  const path = entry.path
  if (
    typeof path !== 'string'
    || path.length === 0
    || path.startsWith('/')
    || path.includes('\\')
    || path.includes('\0')
    || path.includes('\n')
    || path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error('Bun release identity contains an invalid file path')
  }
  if (path === 'release.json') {
    throw new Error('Bun release identity files must exclude release.json')
  }
  if (paths.has(path)) {
    throw new Error(`Bun release identity contains duplicate path: ${path}`)
  }
  paths.add(path)

  if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) {
    throw new Error(`Bun release identity contains invalid metadata for ${path}`)
  }
  if (entry.type === 'file') {
    if (!Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777 || entry.target !== undefined) {
      throw new Error(`Bun release identity contains invalid file metadata for ${path}`)
    }
    return
  }
  if (entry.type === 'symlink') {
    if (
      typeof entry.target !== 'string'
      || entry.target.length === 0
      || entry.mode !== undefined
      || entry.bytes !== Buffer.byteLength(entry.target)
      || entry.sha256 !== createHash('sha256').update(entry.target).digest('hex')
    ) {
      throw new Error(`Bun release identity contains invalid symlink metadata for ${path}`)
    }
    return
  }
  throw new Error(`Bun release identity contains invalid entry type for ${path}`)
}

function compareReleaseEntries(left, right) {
  const leftPath = typeof left?.path === 'string' ? left.path : ''
  const rightPath = typeof right?.path === 'string' ? right.path : ''
  if (leftPath < rightPath) return -1
  if (leftPath > rightPath) return 1
  return 0
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
