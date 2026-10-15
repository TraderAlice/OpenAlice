#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, parse, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { verifyCliReleaseArchive as validateCliReleaseArchive } from './verify-cli-release.mjs'
import { CLI_RELEASE_TARGETS, cliExecutableName } from '../packages/cli/src/release-targets.mjs'

import { readDevBrokerCatalog } from './dev-broker-binding.mjs'

export { CLI_RELEASE_TARGETS }

export function prepareCliDevAssets({ inputDir, outputDir, commit, version, installerPath, windowsInstallerPath }) {
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
  const windowsInstallerSource = windowsInstallerPath ?? fileURLToPath(new URL('../install.ps1', import.meta.url))
  const windowsInstallerBytes = readFileSync(windowsInstallerSource)
  copyFileSync(windowsInstallerSource, join(immutableRoot, 'install.ps1'))

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

    const catalog = readDevBrokerCatalog(inputRoot, { commit, version, platform, arch }, immutableRoot)
    const bindingPath = `${archiveName.slice(0, -'.tar.gz'.length)}/share/openalice/broker-pack-source.json`
    const bindingBytes = execFileSync('tar', ['-xOzf', archivePath, bindingPath])
    const binding = JSON.parse(bindingBytes.toString('utf8'))
    const bindingEntry = metadata.files.find(entry => entry.path === 'share/openalice/broker-pack-source.json')
    if (bindingEntry?.sha256 !== createHash('sha256').update(bindingBytes).digest('hex') || bindingEntry?.bytes !== bindingBytes.length) {
      throw new Error('CLI content identity does not cover its broker catalog')
    }
    if (binding.schemaVersion !== 1 || binding.commit !== commit || JSON.stringify(binding.catalog) !== JSON.stringify(catalog)) {
      throw new Error('CLI broker binding differs from published catalog')
    }

    copyFileSync(archivePath, join(immutableRoot, archiveName))
    copyFileSync(checksumPath, join(immutableRoot, `${archiveName}.sha256`))

    const aliasName = `openalice-cli-dev-${platform}-${arch}.tar.gz`
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
    windowsInstaller: {
      url: 'https://download.openalice.ai/install.ps1',
      versionedUrl: `https://download.openalice.ai/cli/dev/releases/${commit}/install.ps1`,
      sha256: createHash('sha256').update(windowsInstallerBytes).digest('hex'),
    },
    targets: targets.filter((target) => target.platform !== 'win32'),
    additionalTargets: targets.filter((target) => target.platform === 'win32'),
  }
  writeFileSync(join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

export { verifyCliReleaseArchive as validateCliReleaseArchive } from './verify-cli-release.mjs'

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
