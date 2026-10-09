#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, posix, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bunReleaseContentIdentity } from './bun-release-content-identity.mjs'
import { pinnedBunVersion } from './bun-toolchain.mjs'
import { inspectMachOSignature } from './macho-signature.mjs'
import { CLI_RELEASE_TARGETS, cliExecutableName } from '../packages/cli/src/release-targets.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const tarEnvironment = { ...process.env, COPYFILE_DISABLE: '1' }
delete tarEnvironment.TAR_OPTIONS
const tarOptions = { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: tarEnvironment }

export function verifyCliReleaseArchive({ archivePath, version, platform, arch }) {
  const archiveName = basename(archivePath)
  if (!CLI_RELEASE_TARGETS.some(([p, a]) => p === platform && a === arch)) throw new Error('Unsupported CLI target')
  const releaseName = `openalice-cli-${version}-${platform}-${arch}`
  if (archiveName !== `${releaseName}.tar.gz`) throw new Error(`unexpected native CLI archive name: ${archiveName}`)
  const checksumPath = `${archivePath}.sha256`
  const sidecar = readFileSync(checksumPath, 'utf8').trim().match(/^([a-f0-9]{64})  ([^/]+)$/)
  if (!sidecar || sidecar[2] !== archiveName) throw new Error(`${archiveName}.sha256 is malformed or names a different archive`)
  const checksum = hash(readFileSync(archivePath))
  if (checksum !== sidecar[1]) throw new Error(`${archiveName} does not match its SHA-256 sidecar`)
  const entries = execFileSync('tar', ['-tzf', archivePath], tarOptions).split('\n').filter(Boolean)
  const seen = new Set()
  for (const entry of entries) {
    const path = entry.replace(/\/$/, '')
    if (!path.startsWith(`${releaseName}/`) && path !== releaseName || path.includes('\\') || path.includes('\r') || path.split('/').some(part => ['', '.', '..'].includes(part)) || seen.has(path)) {
      throw new Error(`${archiveName} contains duplicate or unsafe entries outside its release root`)
    }
    seen.add(path)
  }
  const staging = mkdtempSync(join(tmpdir(), 'openalice-cli-verify-'))
  try {
    // Modern BSD/GNU tar reject extraction through archive symlinks. Preserve the
    // archived file modes rather than the verifier's umask; never execute payloads.
    execFileSync('tar', ['-xzpf', resolve(archivePath), '--no-same-owner', '-C', staging], tarOptions)
    const root = join(staging, releaseName)
    const metadataPath = join(root, 'release.json')
    if (!lstatSync(metadataPath).isFile()) throw new Error('release.json must be a regular file')
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
    if (metadata?.schemaVersion !== 1 || metadata.product !== 'OpenAlice CLI' || metadata.version !== version || metadata.platform !== platform || metadata.arch !== arch || metadata.bunVersion !== pinnedBunVersion() || metadata.executable !== `bin/${cliExecutableName(platform)}` || metadata.resourceRoot !== 'share/openalice' || !/^[a-f0-9]{16}$/.test(metadata.contentIdentity ?? '')) {
      throw new Error(`${archiveName} contains invalid release metadata`)
    }
    if (bunReleaseContentIdentity(metadata) !== metadata.contentIdentity) throw new Error(`${archiveName} content identity does not match its release manifest`)
    const files = []
    function walk(directory, prefix = '') {
      for (const name of readdirSync(directory)) {
        const path = prefix ? `${prefix}/${name}` : name
        if (path === 'release.json') continue
        const absolute = join(directory, name)
        const info = lstatSync(absolute)
        if (info.isDirectory()) walk(absolute, path)
        else if (info.isSymbolicLink()) {
          const target = readlinkSync(absolute)
          const destination = posix.normalize(posix.join(posix.dirname(path), target))
          if (posix.isAbsolute(target) || target.includes('\\') || destination === '..' || destination.startsWith('../')) throw new Error(`Unsafe CLI symlink: ${path}`)
          files.push({ path, type: 'symlink', target, bytes: Buffer.byteLength(target), sha256: hash(target) })
        } else if (info.isFile() && info.nlink === 1) {
          files.push({ path, type: 'file', bytes: info.size, mode: info.mode & 0o777, sha256: hash(readFileSync(absolute)) })
        } else throw new Error(`Unsupported CLI archive entry: ${path}`)
      }
    }
    walk(root)
    if (bunReleaseContentIdentity({ ...metadata, files }) !== metadata.contentIdentity) throw new Error(`${archiveName} actual files do not match its release manifest`)
    const executable = join(root, metadata.executable)
    if (!lstatSync(executable).isFile()) throw new Error('CLI executable must be a regular file')
    let signature
    if (platform === 'darwin') {
      signature = inspectMachOSignature(readFileSync(executable), arch)
      if (signature.identifier !== 'ai.openalice.cli') throw new Error('Unexpected CLI signing identifier')
    }
    return { archiveName, releaseName, checksumPath, checksum, metadata, entries, signature }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

export function verifyCliReleaseDirectory(directory) {
  const names = readdirSync(directory).filter(name => name.startsWith('openalice-cli-') && name.endsWith('.tar.gz'))
  if (!names.length) throw new Error('No CLI release archives to verify')
  return names.map(name => {
    const match = name.match(/^openalice-cli-(\d+\.\d+\.\d+(?:-[\w.-]+)?)-(darwin|linux|win32)-(arm64|x64)\.tar\.gz$/)
    if (!match) throw new Error(`Unexpected CLI archive: ${name}`)
    const [, version, platform, arch] = match
    const result = verifyCliReleaseArchive({ archivePath: join(directory, name), version, platform, arch })
    return { archive: name, sha256: result.checksum, bunVersion: result.metadata.bunVersion, contentIdentity: result.metadata.contentIdentity, signature: result.signature }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: verify-cli-release.mjs <archive-directory>')
    console.log(JSON.stringify(verifyCliReleaseDirectory(process.argv[2]), null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
