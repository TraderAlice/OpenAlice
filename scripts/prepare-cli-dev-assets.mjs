#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, parse, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { bunReleaseContentIdentity } from './bun-release-content-identity.mjs'

export const CLI_RELEASE_TARGETS = [
  ['darwin', 'arm64'],
  ['darwin', 'x64'],
  ['linux', 'arm64'],
  ['linux', 'x64'],
]
const PINNED_BUN_VERSION = readFileSync(new URL('../.bun-version', import.meta.url), 'utf8').trim()

export function prepareCliDevAssets({ inputDir, outputDir, commit, version, installerPath }) {
  if (!/^[a-f0-9]{7,64}$/.test(commit)) {
    throw new Error(`invalid commit identity: ${commit}`)
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`invalid OpenAlice version: ${version}`)
  }

  const inputRoot = resolve(inputDir)
  const outputRoot = resolve(outputDir)
  if (
    outputRoot === parse(outputRoot).root
    || outputRoot === homedir()
    || outputRoot === resolve('.')
    || outputRoot === inputRoot
  ) {
    throw new Error(`refusing unsafe CLI dev output directory: ${outputRoot}`)
  }
  const immutableRoot = join(outputRoot, 'releases', commit)
  const aliasRoot = join(outputRoot, 'aliases')
  rmSync(outputRoot, { recursive: true, force: true })
  mkdirSync(immutableRoot, { recursive: true })
  mkdirSync(aliasRoot, { recursive: true })

  const installerSource = resolve(
    installerPath ?? fileURLToPath(new URL('../install', import.meta.url)),
  )
  const installerBytes = readFileSync(installerSource)
  const installerSha256 = createHash('sha256').update(installerBytes).digest('hex')
  copyFileSync(installerSource, join(immutableRoot, 'install'))

  const expectedArchives = new Set()
  const targets = []
  for (const [platform, arch] of CLI_RELEASE_TARGETS) {
    const archiveName = `openalice-cli-${version}-${platform}-${arch}.tar.gz`
    expectedArchives.add(archiveName)
    const archivePath = join(inputRoot, archiveName)
    const { checksum, checksumPath, metadata } = validateCliReleaseArchive({
      archivePath,
      version,
      platform,
      arch,
    })

    copyFileSync(archivePath, join(immutableRoot, archiveName))
    copyFileSync(checksumPath, join(immutableRoot, `${archiveName}.sha256`))

    const aliasName = `openalice-cli-dev-${platform}-${arch}.tar.gz`
    copyFileSync(archivePath, join(aliasRoot, aliasName))
    writeFileSync(join(aliasRoot, `${aliasName}.sha256`), `${checksum}  ${aliasName}\n`)
    targets.push({ platform, arch, archive: aliasName, sha256: checksum, contentIdentity: metadata.contentIdentity })
  }

  const unexpected = readdirSync(inputRoot)
    .filter((name) => /^openalice-cli-.*\.tar\.gz$/.test(name) && !expectedArchives.has(name))
  if (unexpected.length > 0) {
    throw new Error(`unexpected native CLI archives: ${unexpected.join(', ')}`)
  }

  const manifest = {
    schemaVersion: 1,
    channel: 'dev',
    repository: 'TraderAlice/OpenAlice',
    version,
    commit,
    installer: {
      url: 'https://download.openalice.ai/install',
      versionedUrl: `https://download.openalice.ai/cli/dev/releases/${commit}/install`,
      sha256: installerSha256,
    },
    targets,
  }
  writeFileSync(join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

export function validateCliReleaseArchive({ archivePath, version, platform, arch }) {
  const archiveName = basename(archivePath)
  const expectedName = `openalice-cli-${version}-${platform}-${arch}.tar.gz`
  if (archiveName !== expectedName) {
    throw new Error(`unexpected native CLI archive name: ${archiveName}`)
  }
  const checksumPath = `${archivePath}.sha256`
  const checksum = parseChecksum(readFileSync(checksumPath, 'utf8'), archiveName)
  const bytes = readFileSync(archivePath)
  const actualChecksum = createHash('sha256').update(bytes).digest('hex')
  if (checksum !== actualChecksum) {
    throw new Error(`${archiveName} does not match its SHA-256 sidecar`)
  }

  const releaseName = archiveName.slice(0, -'.tar.gz'.length)
  const metadata = JSON.parse(execFileSync('tar', [
    '-xOzf', archivePath, `${releaseName}/release.json`,
  ], { encoding: 'utf8' }))
  if (
    metadata?.schemaVersion !== 1
    || metadata?.product !== 'OpenAlice CLI'
    || metadata?.version !== version
    || metadata?.platform !== platform
    || metadata?.arch !== arch
    || metadata?.bunVersion !== PINNED_BUN_VERSION
    || !/^[a-f0-9]{16}$/.test(metadata?.contentIdentity ?? '')
  ) {
    throw new Error(`${archiveName} contains invalid release metadata`)
  }
  let contentIdentity
  try {
    contentIdentity = bunReleaseContentIdentity(metadata)
  } catch {
    throw new Error(`${archiveName} contains invalid release metadata`)
  }
  if (contentIdentity !== metadata.contentIdentity) {
    throw new Error(`${archiveName} content identity does not match its release manifest`)
  }
  const entries = execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
  if (entries.some((entry) => !entry.startsWith(`${releaseName}/`) || entry.includes('/../'))) {
    throw new Error(`${archiveName} contains entries outside its release root`)
  }
  if (!entries.includes(`${releaseName}/bin/openalice`)) {
    throw new Error(`${archiveName} does not contain bin/openalice`)
  }
  return { archiveName, releaseName, checksumPath, checksum, metadata, entries }
}

function parseChecksum(content, archiveName) {
  const match = content.trim().match(/^([a-f0-9]{64})  ([^/]+)$/)
  if (!match || match[2] !== archiveName) {
    throw new Error(`${archiveName}.sha256 is malformed or names a different archive`)
  }
  return match[1]
}

function parseArgs(argv) {
  if (argv.length !== 8 && argv.length !== 10) {
    throw new Error('Usage: prepare-cli-dev-assets.mjs --input-dir <dir> --output-dir <dir> --commit <sha> --version <version> [--installer <path>]')
  }
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!['--input-dir', '--output-dir', '--commit', '--version', '--installer'].includes(name) || !value) {
      throw new Error('Usage: prepare-cli-dev-assets.mjs --input-dir <dir> --output-dir <dir> --commit <sha> --version <version> [--installer <path>]')
    }
    options[name.slice(2)] = value
  }
  if (!options['input-dir'] || !options['output-dir'] || !options.commit || !options.version) {
    throw new Error('Usage: prepare-cli-dev-assets.mjs --input-dir <dir> --output-dir <dir> --commit <sha> --version <version> [--installer <path>]')
  }
  return {
    inputDir: options['input-dir'],
    outputDir: options['output-dir'],
    commit: options.commit,
    version: options.version,
    installerPath: options.installer,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const manifest = prepareCliDevAssets(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(manifest)}\n`)
  } catch (error) {
    process.stderr.write(`prepare CLI dev assets: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
