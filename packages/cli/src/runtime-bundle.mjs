import { createHash } from 'node:crypto'
import {
  createReadStream,
} from 'node:fs'
import {
  lstat,
  link,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'

export const RUNTIME_BUNDLE_SCHEMA_VERSION = 1
export const RUNTIME_BUNDLE_DIRECTORY = 'openalice-runtime'
export const RUNTIME_BUNDLE_MANIFEST = 'runtime-manifest.json'
export const RUNTIME_BUNDLE_ENTRYPOINT = 'scripts/guardian/prod.mjs'
export const RUNTIME_BUNDLE_MINIMUM_NODE_VERSION = '22.19.0'

const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux'])
const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64'])
const REQUIRED_PATHS = [
  'dist/main.js',
  'ui/dist/index.html',
  'default/persona.default.md',
  'src/workspaces/templates',
  'src/workspaces/cli/bin/openalice-cli.cjs',
  'services/uta/dist/uta.js',
  'services/connector/dist/connector.cjs',
  'packages/guardian-runtime/dist/index.js',
  RUNTIME_BUNDLE_ENTRYPOINT,
  'scripts/guardian/control-server.mjs',
  'scripts/guardian/prod-ports.mjs',
  'node_modules',
  'package.json',
]

export async function createRuntimeBundleManifest(
  root,
  options,
) {
  const platform = requireSupportedPlatform(
    options?.platform ?? process.platform,
  )
  const arch = requireSupportedArchitecture(
    options?.arch ?? process.arch,
  )
  const productVersion = requireVersion(options?.productVersion)
  await assertRuntimeLayout(root)
  const files = await collectRuntimeEntries(root)
  const unsigned = {
    schemaVersion: RUNTIME_BUNDLE_SCHEMA_VERSION,
    productVersion,
    platform,
    arch,
    node: {
      minimumVersion: RUNTIME_BUNDLE_MINIMUM_NODE_VERSION,
    },
    entrypoint: RUNTIME_BUNDLE_ENTRYPOINT,
    files,
  }
  return {
    ...unsigned,
    contentIdentity: manifestContentIdentity(unsigned),
  }
}

export async function writeRuntimeBundleManifest(
  root,
  options,
) {
  const manifest = await createRuntimeBundleManifest(root, options)
  await writeFile(
    join(root, RUNTIME_BUNDLE_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o644 },
  )
  return manifest
}

export async function readRuntimeBundleManifest(root) {
  let parsed
  try {
    parsed = JSON.parse(
      await readFile(join(root, RUNTIME_BUNDLE_MANIFEST), 'utf8'),
    )
  } catch (error) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLEMANIFEST',
      `Could not read ${RUNTIME_BUNDLE_MANIFEST} under ${root}: ${errorMessage(error)}`,
    )
  }
  return parseRuntimeBundleManifest(parsed)
}

export function parseRuntimeBundleManifest(value) {
  const record = requireRecord(value, 'Runtime bundle manifest')
  rejectUnknownKeys(record, new Set([
    'schemaVersion',
    'productVersion',
    'platform',
    'arch',
    'node',
    'entrypoint',
    'files',
    'contentIdentity',
  ]), 'Runtime bundle manifest')
  if (record.schemaVersion !== RUNTIME_BUNDLE_SCHEMA_VERSION) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLEMANIFEST',
      `Runtime bundle schemaVersion must be ${RUNTIME_BUNDLE_SCHEMA_VERSION}.`,
    )
  }
  const productVersion = requireVersion(record.productVersion)
  const platform = requireSupportedPlatform(record.platform)
  const arch = requireSupportedArchitecture(record.arch)
  const node = requireRecord(record.node, 'Runtime bundle node')
  rejectUnknownKeys(
    node,
    new Set(['minimumVersion']),
    'Runtime bundle node',
  )
  if (node.minimumVersion !== RUNTIME_BUNDLE_MINIMUM_NODE_VERSION) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLEMANIFEST',
      `Runtime bundle minimum Node.js version must be ${RUNTIME_BUNDLE_MINIMUM_NODE_VERSION}.`,
    )
  }
  if (record.entrypoint !== RUNTIME_BUNDLE_ENTRYPOINT) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLEMANIFEST',
      `Runtime bundle entrypoint must be ${RUNTIME_BUNDLE_ENTRYPOINT}.`,
    )
  }
  if (!Array.isArray(record.files) || record.files.length === 0) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLEMANIFEST',
      'Runtime bundle files must be a non-empty array.',
    )
  }
  const files = record.files.map((entry, index) => (
    parseRuntimeEntry(entry, index)
  ))
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
  if (files.some((entry, index) => entry.path !== sorted[index].path)) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLEMANIFEST',
      'Runtime bundle files must be sorted by path.',
    )
  }
  if (new Set(files.map((entry) => entry.path)).size !== files.length) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLEMANIFEST',
      'Runtime bundle files contain duplicate paths.',
    )
  }
  const contentIdentity = requireContentIdentity(record.contentIdentity)
  const unsigned = {
    schemaVersion: RUNTIME_BUNDLE_SCHEMA_VERSION,
    productVersion,
    platform,
    arch,
    node: {
      minimumVersion: RUNTIME_BUNDLE_MINIMUM_NODE_VERSION,
    },
    entrypoint: RUNTIME_BUNDLE_ENTRYPOINT,
    files,
  }
  if (manifestContentIdentity(unsigned) !== contentIdentity) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLEMANIFEST',
      'Runtime bundle content identity does not match its manifest.',
    )
  }
  return {
    ...unsigned,
    contentIdentity,
  }
}

export async function verifyRuntimeBundle(
  root,
  options = {},
) {
  const manifest = await readRuntimeBundleManifest(root)
  if (
    options.productVersion !== undefined
    && manifest.productVersion !== options.productVersion
  ) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLEVERSION',
      `Runtime bundle reports ${manifest.productVersion}, expected ${options.productVersion}.`,
    )
  }
  const platform = options.platform ?? process.platform
  if (manifest.platform !== platform) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLEPLATFORM',
      `Runtime bundle targets ${manifest.platform}, not ${platform}.`,
    )
  }
  const arch = options.arch ?? process.arch
  if (manifest.arch !== arch) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLEARCH',
      `Runtime bundle targets ${manifest.arch}, not ${arch}.`,
    )
  }
  await assertRuntimeLayout(root)
  const actualEntries = await collectRuntimeEntries(root)
  if (JSON.stringify(actualEntries) !== JSON.stringify(manifest.files)) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLEINTEGRITY',
      `Runtime bundle files under ${root} do not match ${RUNTIME_BUNDLE_MANIFEST}.`,
    )
  }
  return manifest
}

export async function deduplicateRuntimeTree(root) {
  const candidates = []
  await walkRuntimeTree(root, async (path, info) => {
    if (info.isFile() && info.size >= 4_096 && info.nlink === 1) {
      candidates.push({
        path,
        size: info.size,
        mode: info.mode & 0o777,
      })
    }
  })
  const byShape = new Map()
  for (const candidate of candidates) {
    const key = `${candidate.size}:${candidate.mode}`
    const entries = byShape.get(key) ?? []
    entries.push(candidate.path)
    byShape.set(key, entries)
  }

  let filesLinked = 0
  let bytesDeduplicated = 0
  for (const entries of byShape.values()) {
    if (entries.length < 2) continue
    const byHash = new Map()
    for (const path of entries.sort()) {
      const hash = await fileSha256(path)
      const source = byHash.get(hash)
      if (!source) {
        byHash.set(hash, path)
        continue
      }
      const temporary = `${path}.openalice-dedup-${process.pid}`
      await rename(path, temporary)
      try {
        await link(source, path)
        await rm(temporary, { force: true })
      } catch (error) {
        await rm(path, { force: true }).catch(() => undefined)
        await rename(temporary, path)
        throw runtimeBundleError(
          'ERUNTIMEBUNDLEBUILD',
          `Could not deduplicate ${path}: ${errorMessage(error)}`,
        )
      }
      filesLinked += 1
      bytesDeduplicated += (await stat(path)).size
    }
  }
  return { filesLinked, bytesDeduplicated }
}

export async function fileSha256(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

async function collectRuntimeEntries(root) {
  const entries = []
  await walkRuntimeTree(root, async (path, info) => {
    const relativePath = runtimeRelativePath(root, path)
    if (relativePath === RUNTIME_BUNDLE_MANIFEST) return
    if (info.isFile()) {
      entries.push({
        path: relativePath,
        kind: 'file',
        size: info.size,
        mode: info.mode & 0o777,
        sha256: await fileSha256(path),
      })
      return
    }
    if (info.isSymbolicLink()) {
      const target = await readlink(path)
      await assertSafeRuntimeSymlink(root, path, target)
      entries.push({
        path: relativePath,
        kind: 'symlink',
        target: target.split(sep).join('/'),
      })
    }
  })
  return entries.sort((a, b) => a.path.localeCompare(b.path))
}

async function walkRuntimeTree(root, visit) {
  const walk = async (directory) => {
    const names = (await readdir(directory)).sort()
    for (const name of names) {
      const path = join(directory, name)
      const info = await lstat(path)
      if (info.isDirectory()) {
        await walk(path)
      } else if (info.isFile() || info.isSymbolicLink()) {
        await visit(path, info)
      } else {
        throw runtimeBundleError(
          'ERUNTIMEBUNDLELAYOUT',
          `Runtime bundle contains unsupported filesystem entry ${path}.`,
        )
      }
    }
  }
  await walk(root)
}

async function assertSafeRuntimeSymlink(root, path, target) {
  if (isAbsolute(target)) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLELAYOUT',
      `Runtime bundle symlink ${path} has an absolute target.`,
    )
  }
  const lexicalTarget = resolve(dirname(path), target)
  if (!pathInside(root, lexicalTarget)) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLELAYOUT',
      `Runtime bundle symlink ${path} escapes the bundle root.`,
    )
  }
  try {
    const physicalTarget = await realpath(lexicalTarget)
    if (!pathInside(await realpath(root), physicalTarget)) {
      throw runtimeBundleError(
        'ERUNTIMEBUNDLELAYOUT',
        `Runtime bundle symlink ${path} resolves outside the bundle root.`,
      )
    }
  } catch (error) {
    if (isRuntimeBundleError(error)) throw error
    throw runtimeBundleError(
      'ERUNTIMEBUNDLELAYOUT',
      `Runtime bundle symlink ${path} is broken: ${errorMessage(error)}`,
    )
  }
}

async function assertRuntimeLayout(root) {
  for (const relativePath of REQUIRED_PATHS) {
    const path = join(root, relativePath)
    try {
      await lstat(path)
    } catch {
      throw runtimeBundleError(
        'ERUNTIMEBUNDLELAYOUT',
        `Runtime bundle is missing ${relativePath}.`,
      )
    }
  }
}

function parseRuntimeEntry(value, index) {
  const label = `Runtime bundle files[${index}]`
  const record = requireRecord(value, label)
  const path = requireRuntimePath(record.path, `${label}.path`)
  if (record.kind === 'file') {
    rejectUnknownKeys(
      record,
      new Set(['path', 'kind', 'size', 'mode', 'sha256']),
      label,
    )
    if (!Number.isSafeInteger(record.size) || record.size < 0) {
      throw runtimeBundleError(
        'ERUNTIMEBUNDLEMANIFEST',
        `${label}.size must be a non-negative safe integer.`,
      )
    }
    if (
      !Number.isInteger(record.mode)
      || record.mode < 0
      || record.mode > 0o777
    ) {
      throw runtimeBundleError(
        'ERUNTIMEBUNDLEMANIFEST',
        `${label}.mode must be a permission mode from 0 to 0777.`,
      )
    }
    if (
      typeof record.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(record.sha256)
    ) {
      throw runtimeBundleError(
        'ERUNTIMEBUNDLEMANIFEST',
        `${label}.sha256 must be a lowercase SHA-256 value.`,
      )
    }
    return {
      path,
      kind: 'file',
      size: record.size,
      mode: record.mode,
      sha256: record.sha256,
    }
  }
  if (record.kind === 'symlink') {
    rejectUnknownKeys(
      record,
      new Set(['path', 'kind', 'target']),
      label,
    )
    if (
      typeof record.target !== 'string'
      || record.target === ''
      || isAbsolute(record.target)
    ) {
      throw runtimeBundleError(
        'ERUNTIMEBUNDLEMANIFEST',
        `${label}.target must be a non-empty relative path.`,
      )
    }
    return {
      path,
      kind: 'symlink',
      target: record.target,
    }
  }
  throw runtimeBundleError(
    'ERUNTIMEBUNDLEMANIFEST',
    `${label}.kind must be "file" or "symlink".`,
  )
}

function requireRuntimePath(value, label) {
  if (
    typeof value !== 'string'
    || value === ''
    || value.startsWith('/')
    || value.includes('\\')
    || value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLEMANIFEST',
      `${label} must be a normalized relative POSIX path.`,
    )
  }
  return value
}

function manifestContentIdentity(unsigned) {
  return createHash('sha256')
    .update(JSON.stringify(unsigned))
    .digest('hex')
    .slice(0, 16)
}

function requireSupportedPlatform(value) {
  if (typeof value !== 'string' || !SUPPORTED_PLATFORMS.has(value)) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLEPLATFORM',
      `Unsupported Runtime bundle platform: ${String(value)}.`,
    )
  }
  return value
}

function requireSupportedArchitecture(value) {
  if (typeof value !== 'string' || !SUPPORTED_ARCHITECTURES.has(value)) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLEARCH',
      `Unsupported Runtime bundle architecture: ${String(value)}.`,
    )
  }
  return value
}

function requireVersion(value) {
  if (
    typeof value !== 'string'
    || !/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/.test(value)
  ) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLEVERSION',
      `Invalid Runtime bundle product version: ${String(value)}.`,
    )
  }
  return value
}

function requireContentIdentity(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{16}$/.test(value)) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLEMANIFEST',
      'Runtime bundle contentIdentity must be 16 lowercase hexadecimal characters.',
    )
  }
  return value
}

function requireRecord(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLEMANIFEST',
      `${label} must be a JSON object.`,
    )
  }
  return value
}

function rejectUnknownKeys(value, allowed, label) {
  const unknown = Object.keys(value).find((key) => !allowed.has(key))
  if (unknown) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLEMANIFEST',
      `${label} contains unknown field "${unknown}".`,
    )
  }
}

function runtimeRelativePath(root, path) {
  return relative(root, path).split(sep).join('/')
}

function pathInside(root, target) {
  const rel = relative(resolve(root), resolve(target))
  return rel === '' || (
    !rel.startsWith('..')
    && !isAbsolute(rel)
  )
}

function runtimeBundleError(code, message) {
  return Object.assign(new Error(message), {
    code,
    exitCode: 2,
  })
}

function isRuntimeBundleError(error) {
  return error instanceof Error
    && 'code' in error
    && String(error.code).startsWith('ERUNTIMEBUNDLE')
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

async function runRuntimeBundleCommand(argv) {
  const [command, root, ...args] = argv
  if (command !== 'verify' || !root) {
    throw runtimeBundleError(
      'ERUNTIMEBUNDLEUSAGE',
      'Usage: node runtime-bundle.mjs verify <root> [--platform <name>] [--arch <name>] [--product-version <version>]',
    )
  }
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const value = args[index + 1]
    if (
      !['--platform', '--arch', '--product-version'].includes(arg)
      || !value
      || value.startsWith('--')
    ) {
      throw runtimeBundleError(
        'ERUNTIMEBUNDLEUSAGE',
        `Unknown or incomplete Runtime bundle option: ${String(arg)}.`,
      )
    }
    if (arg === '--platform') options.platform = value
    if (arg === '--arch') options.arch = value
    if (arg === '--product-version') options.productVersion = value
    index += 1
  }
  const manifest = await verifyRuntimeBundle(resolve(root), options)
  process.stdout.write(`${JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    productVersion: manifest.productVersion,
    platform: manifest.platform,
    arch: manifest.arch,
    minimumNodeVersion: manifest.node.minimumVersion,
    contentIdentity: manifest.contentIdentity,
    files: manifest.files.length,
  })}\n`)
}

if (process.argv[2] === 'verify') {
  runRuntimeBundleCommand(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`openalice runtime bundle: ${errorMessage(error)}\n`)
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1
  })
}
