#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  copyFileSync,
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, parse, posix, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const CLI_NEUTRAL_INPUT_ROOTS = Object.freeze([
  'ui/dist',
  'packages/connector-protocol/dist',
  'packages/guardian-runtime/dist',
  'packages/ibkr/dist',
  'packages/opentypebb/dist',
  'packages/uta-protocol/dist',
])

const MANIFEST_NAME = 'manifest.json'
const MANIFEST_CHECKSUM_NAME = 'manifest.sha256'
const PAYLOAD_DIRECTORY = 'payload'
const MANIFEST_KIND = 'openalice-cli-neutral-inputs'
const MANIFEST_SCHEMA_VERSION = 1

export function prepareCliNeutralInputs({ repositoryRoot, outputDir, commit }) {
  assertCommit(commit)
  const sourceRoot = resolve(repositoryRoot)
  const artifactRoot = resolve(outputDir)
  assertSafeOutputDirectory(sourceRoot, artifactRoot)
  if (pathExists(artifactRoot)) {
    throw new Error(`refusing to replace existing neutral input artifact: ${artifactRoot}`)
  }

  const files = []
  for (const inputRoot of CLI_NEUTRAL_INPUT_ROOTS) {
    const absoluteRoot = joinFromManifestPath(sourceRoot, inputRoot)
    const rootStat = checkedLstat(absoluteRoot, `required neutral input is missing: ${inputRoot}`)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error(`required neutral input is not a real directory: ${inputRoot}`)
    }
    const rootFiles = inventoryTree(absoluteRoot, inputRoot).files
    if (rootFiles.length === 0) {
      throw new Error(`required neutral input contains no files: ${inputRoot}`)
    }
    files.push(...rootFiles.map(({ path, absolutePath, bytes }) => ({
      path,
      absolutePath,
      bytes,
      sha256: sha256File(absolutePath),
    })))
  }
  files.sort((left, right) => compareText(left.path, right.path))

  const payloadRoot = join(artifactRoot, PAYLOAD_DIRECTORY)
  for (const file of files) {
    const destination = joinFromManifestPath(payloadRoot, file.path)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(file.absolutePath, destination)
  }

  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    kind: MANIFEST_KIND,
    commit,
    roots: [...CLI_NEUTRAL_INPUT_ROOTS],
    files: files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  mkdirSync(artifactRoot, { recursive: true })
  writeFileSync(join(artifactRoot, MANIFEST_NAME), manifestBytes)
  writeFileSync(
    join(artifactRoot, MANIFEST_CHECKSUM_NAME),
    `${sha256Bytes(manifestBytes)}  ${MANIFEST_NAME}\n`,
  )

  validateNeutralArtifact({ artifactRoot, expectedCommit: commit })
  return manifest
}

export function verifyCliNeutralInputs({ repositoryRoot, inputDir, commit, install = false }) {
  assertCommit(commit)
  const destinationRoot = resolve(repositoryRoot)
  const artifactRoot = resolve(inputDir)
  const manifest = validateNeutralArtifact({ artifactRoot, expectedCommit: commit })

  if (install) {
    const payloadRoot = join(artifactRoot, PAYLOAD_DIRECTORY)
    for (const inputRoot of CLI_NEUTRAL_INPUT_ROOTS) {
      const destination = joinFromManifestPath(destinationRoot, inputRoot)
      if (pathExists(destination)) {
        throw new Error(`refusing to merge neutral input into existing destination: ${inputRoot}`)
      }
    }
    for (const inputRoot of CLI_NEUTRAL_INPUT_ROOTS) {
      const source = joinFromManifestPath(payloadRoot, inputRoot)
      const destination = joinFromManifestPath(destinationRoot, inputRoot)
      mkdirSync(dirname(destination), { recursive: true })
      cpSync(source, destination, { recursive: true, errorOnExist: true, force: false })
    }
  }

  return manifest
}

function validateNeutralArtifact({ artifactRoot, expectedCommit }) {
  assertArtifactEnvelope(artifactRoot)
  const manifestPath = join(artifactRoot, MANIFEST_NAME)
  const manifestBytes = readFileSync(manifestPath)
  const expectedManifestChecksum = parseManifestChecksum(
    readFileSync(join(artifactRoot, MANIFEST_CHECKSUM_NAME), 'utf8'),
  )
  const actualManifestChecksum = sha256Bytes(manifestBytes)
  if (actualManifestChecksum !== expectedManifestChecksum) {
    throw new Error('neutral input manifest does not match its SHA-256 sidecar')
  }

  let manifest
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'))
  } catch {
    throw new Error('neutral input manifest is not valid JSON')
  }
  validateManifestShape(manifest, expectedCommit)

  const payloadRoot = join(artifactRoot, PAYLOAD_DIRECTORY)
  const payload = inventoryTree(payloadRoot, '')
  const actualFiles = payload.files.map(({ path }) => path).sort(compareText)
  const expectedFiles = manifest.files.map(({ path }) => path)
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error('neutral input payload contains missing or unexpected files')
  }

  const expectedDirectories = expectedPayloadDirectories(expectedFiles)
  const actualDirectories = payload.directories.sort(compareText)
  if (JSON.stringify(actualDirectories) !== JSON.stringify(expectedDirectories)) {
    throw new Error('neutral input payload contains missing or unexpected directories')
  }

  for (const file of manifest.files) {
    const absolutePath = joinFromManifestPath(payloadRoot, file.path)
    const stat = checkedLstat(absolutePath, `neutral input payload is missing: ${file.path}`)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`neutral input payload entry is not a regular file: ${file.path}`)
    }
    if (stat.size !== file.bytes || sha256File(absolutePath) !== file.sha256) {
      throw new Error(`neutral input payload hash or size mismatch: ${file.path}`)
    }
  }
  return manifest
}

function validateManifestShape(manifest, expectedCommit) {
  if (!isPlainObject(manifest)) throw new Error('neutral input manifest must be an object')
  expectExactKeys(manifest, ['commit', 'files', 'kind', 'roots', 'schemaVersion'], 'manifest')
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION || manifest.kind !== MANIFEST_KIND) {
    throw new Error('neutral input manifest has an unsupported schema or kind')
  }
  if (manifest.commit !== expectedCommit) {
    throw new Error(`neutral input commit ${String(manifest.commit)} does not match ${expectedCommit}`)
  }
  if (JSON.stringify(manifest.roots) !== JSON.stringify(CLI_NEUTRAL_INPUT_ROOTS)) {
    throw new Error('neutral input manifest does not contain the exact approved roots')
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('neutral input manifest must contain files')
  }

  const seen = new Set()
  let previousPath = ''
  const rootsWithFiles = new Set()
  for (const file of manifest.files) {
    if (!isPlainObject(file)) throw new Error('neutral input file entry must be an object')
    expectExactKeys(file, ['bytes', 'path', 'sha256'], 'file entry')
    if (!isSafeManifestPath(file.path)) {
      throw new Error(`neutral input manifest contains an unsafe path: ${String(file.path)}`)
    }
    const owningRoot = CLI_NEUTRAL_INPUT_ROOTS.find((root) => file.path.startsWith(`${root}/`))
    if (!owningRoot) {
      throw new Error(`neutral input manifest path is outside the approved roots: ${file.path}`)
    }
    if (seen.has(file.path) || (previousPath && compareText(previousPath, file.path) >= 0)) {
      throw new Error('neutral input manifest file paths must be unique and sorted')
    }
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      throw new Error(`neutral input manifest contains an invalid size: ${file.path}`)
    }
    if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error(`neutral input manifest contains an invalid SHA-256: ${file.path}`)
    }
    seen.add(file.path)
    rootsWithFiles.add(owningRoot)
    previousPath = file.path
  }
  if (rootsWithFiles.size !== CLI_NEUTRAL_INPUT_ROOTS.length) {
    throw new Error('neutral input manifest leaves an approved root empty')
  }
}

function inventoryTree(absoluteRoot, manifestRoot) {
  const files = []
  const directories = []
  walk(absoluteRoot, manifestRoot)
  files.sort((left, right) => compareText(left.path, right.path))
  directories.sort(compareText)
  return { files, directories }

  function walk(directory, manifestDirectory) {
    if (manifestDirectory) directories.push(manifestDirectory)
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareText(left.name, right.name))
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name)
      const path = manifestDirectory ? `${manifestDirectory}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) {
        throw new Error(`neutral input may not contain symbolic links: ${path}`)
      }
      if (entry.isDirectory()) {
        walk(absolutePath, path)
        continue
      }
      if (!entry.isFile()) {
        throw new Error(`neutral input may contain only files and directories: ${path}`)
      }
      files.push({ path, absolutePath, bytes: lstatSync(absolutePath).size })
    }
  }
}

function expectedPayloadDirectories(files) {
  const directories = new Set()
  for (const file of files) {
    let current = posix.dirname(file)
    while (current !== '.') {
      directories.add(current)
      current = posix.dirname(current)
    }
  }
  return [...directories].sort(compareText)
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function assertSafeOutputDirectory(repositoryRoot, outputRoot) {
  if (
    outputRoot === parse(outputRoot).root
    || outputRoot === homedir()
    || outputRoot === repositoryRoot
  ) {
    throw new Error(`refusing unsafe neutral input output directory: ${outputRoot}`)
  }
  for (const inputRoot of CLI_NEUTRAL_INPUT_ROOTS) {
    const source = joinFromManifestPath(repositoryRoot, inputRoot)
    if (
      outputRoot === source
      || outputRoot.startsWith(`${source}${sep}`)
      || source.startsWith(`${outputRoot}${sep}`)
    ) {
      throw new Error(`neutral input output may not overlap an approved input: ${inputRoot}`)
    }
  }
}

function assertArtifactEnvelope(artifactRoot) {
  const rootStat = checkedLstat(artifactRoot, 'neutral input artifact is missing')
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('neutral input artifact must be a real directory')
  }
  const entries = readdirSync(artifactRoot, { withFileTypes: true })
    .sort((left, right) => compareText(left.name, right.name))
  const expected = [MANIFEST_NAME, MANIFEST_CHECKSUM_NAME, PAYLOAD_DIRECTORY].sort(compareText)
  if (JSON.stringify(entries.map(({ name }) => name)) !== JSON.stringify(expected)) {
    throw new Error('neutral input artifact contains missing or unexpected top-level entries')
  }
  for (const entry of entries) {
    const valid = entry.name === PAYLOAD_DIRECTORY ? entry.isDirectory() : entry.isFile()
    if (!valid || entry.isSymbolicLink()) {
      throw new Error(`neutral input artifact contains an invalid top-level entry: ${entry.name}`)
    }
  }
}

function assertCommit(commit) {
  if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error(`invalid neutral input commit identity: ${String(commit)}`)
  }
}

function parseManifestChecksum(content) {
  const match = content.trim().match(/^([a-f0-9]{64})  manifest\.json$/)
  if (!match) throw new Error('neutral input manifest SHA-256 sidecar is malformed')
  return match[1]
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path))
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function checkedLstat(path, message) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(message)
    throw error
  }
}

function pathExists(path) {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function isSafeManifestPath(path) {
  return typeof path === 'string'
    && path.length > 0
    && !isAbsolute(path)
    && !path.includes('\\')
    && posix.normalize(path) === path
    && path !== '..'
    && !path.startsWith('../')
}

function joinFromManifestPath(root, path) {
  const joined = resolve(root, ...path.split('/'))
  const relativePath = relative(root, joined)
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`path escapes its root: ${path}`)
  }
  return joined
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function expectExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`neutral input ${label} contains unexpected fields`)
  }
}

function parseCommand(argv) {
  const [command, ...rest] = argv
  if (!['prepare', 'verify'].includes(command)) throw new Error(usage())
  const allowed = command === 'prepare'
    ? new Set(['--repository-root', '--output-dir', '--commit'])
    : new Set(['--repository-root', '--input-dir', '--commit', '--install'])
  const values = new Map()
  for (let index = 0; index < rest.length; index += 1) {
    const name = rest[index]
    if (!allowed.has(name) || values.has(name)) throw new Error(usage())
    if (name === '--install') {
      values.set(name, true)
      continue
    }
    const value = rest[index + 1]
    if (!value || value.startsWith('--')) throw new Error(usage())
    values.set(name, value)
    index += 1
  }
  if (!values.has('--repository-root') || !values.has('--commit')) throw new Error(usage())
  if (command === 'prepare' && !values.has('--output-dir')) throw new Error(usage())
  if (command === 'verify' && !values.has('--input-dir')) throw new Error(usage())
  return { command, values }
}

function usage() {
  return [
    'Usage:',
    '  prepare-cli-neutral-inputs.mjs prepare --repository-root <dir> --output-dir <dir> --commit <sha>',
    '  prepare-cli-neutral-inputs.mjs verify --repository-root <dir> --input-dir <dir> --commit <sha> [--install]',
  ].join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { command, values } = parseCommand(process.argv.slice(2))
    const common = {
      repositoryRoot: values.get('--repository-root'),
      commit: values.get('--commit'),
    }
    const manifest = command === 'prepare'
      ? prepareCliNeutralInputs({ ...common, outputDir: values.get('--output-dir') })
      : verifyCliNeutralInputs({
          ...common,
          inputDir: values.get('--input-dir'),
          install: values.get('--install') === true,
        })
    process.stdout.write(`${JSON.stringify({ commit: manifest.commit, files: manifest.files.length })}\n`)
  } catch (error) {
    process.stderr.write(`CLI neutral inputs: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
