#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, parse, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { NPM_PACKAGE_NAMES } from './preflight-public-cli-authority.mjs'

const EXPECTED_PUBLISH_ORDER = Object.freeze([
  ...NPM_PACKAGE_NAMES.filter((name) => name !== 'openalice').sort(),
  'openalice',
])

export function publishCliNpmPackages({
  packagesDir,
  npm = process.platform === 'win32' ? 'npm.cmd' : 'npm',
  runNpm = (args) => spawnSync(npm, args, { encoding: 'utf8', stdio: 'pipe' }),
  logger = console,
} = {}) {
  const root = resolve(packagesDir ?? process.cwd())
  const manifest = readManifest(root)
  const packages = validateManifest(manifest)

  for (const entry of packages) {
    const tarballPath = resolveTarball(root, entry.filename)
    verifyTarball(tarballPath, entry)
    const current = readPublishedIntegrity(runNpm, entry)
    if (current === entry.integrity) {
      logger.log(`[npm-publish] ${entry.name}@${entry.version} already matches; skipping`)
      continue
    }
    if (current !== null) {
      throw new Error(`${entry.name}@${entry.version} is already published with different integrity`)
    }

    const published = runNpm(['publish', tarballPath, '--access', 'public', '--provenance'])
    if (published.error) throw published.error
    if (published.status !== 0) {
      const afterFailure = readPublishedIntegrity(runNpm, entry)
      if (afterFailure === entry.integrity) {
        logger.log(`[npm-publish] ${entry.name}@${entry.version} became visible with accepted integrity`)
        continue
      }
      throw new Error(`npm publish failed for ${entry.name}@${entry.version}: ${commandDetail(published)}`)
    }
    logger.log(`[npm-publish] published ${entry.name}@${entry.version}`)
  }

  return { version: manifest.version, packages: packages.map(({ name }) => name) }
}

function readManifest(root) {
  const path = resolve(root, 'npm-publish-order.json')
  if (!existsSync(path)) throw new Error(`npm publish manifest is missing: ${path}`)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error(`npm publish manifest is invalid JSON: ${path}`)
  }
}

function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || typeof manifest.version !== 'string') {
    throw new Error('npm publish manifest has an unsupported shape')
  }
  if (!Array.isArray(manifest.packages) || !Array.isArray(manifest.publishOrder)) {
    throw new Error('npm publish manifest omits packages or publishOrder')
  }
  const names = manifest.packages.map((entry) => entry?.name)
  if (
    names.length !== EXPECTED_PUBLISH_ORDER.length
    || names.some((name, index) => name !== EXPECTED_PUBLISH_ORDER[index])
    || manifest.publishOrder.some((name, index) => name !== EXPECTED_PUBLISH_ORDER[index])
    || manifest.publishOrder.length !== EXPECTED_PUBLISH_ORDER.length
  ) {
    throw new Error(`npm publish order must be ${EXPECTED_PUBLISH_ORDER.join(', ')}`)
  }
  for (const entry of manifest.packages) {
    if (
      entry.version !== manifest.version
      || typeof entry.filename !== 'string'
      || typeof entry.shasum !== 'string'
      || typeof entry.integrity !== 'string'
    ) {
      throw new Error(`npm publish entry is invalid for ${entry.name ?? 'unknown package'}`)
    }
  }
  return manifest.packages
}

function resolveTarball(root, filename) {
  if (filename !== basename(filename)) throw new Error(`unsafe npm tarball filename: ${filename}`)
  const path = resolve(root, filename)
  if (path === parse(path).root || path === root || !existsSync(path)) {
    throw new Error(`npm tarball is missing or unsafe: ${filename}`)
  }
  return path
}

function verifyTarball(path, entry) {
  const bytes = readFileSync(path)
  const shasum = createHash('sha1').update(bytes).digest('hex')
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  if (shasum !== entry.shasum || integrity !== entry.integrity) {
    throw new Error(`npm tarball integrity mismatch for ${entry.filename}`)
  }
}

function readPublishedIntegrity(runNpm, entry) {
  const result = runNpm(['view', `${entry.name}@${entry.version}`, 'dist.integrity', '--json'])
  if (result.error) throw result.error
  if (result.status === 0) {
    try {
      const integrity = JSON.parse(result.stdout.trim())
      if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) throw new Error()
      return integrity
    } catch {
      throw new Error(`npm returned invalid integrity for ${entry.name}@${entry.version}`)
    }
  }
  const detail = commandDetail(result)
  if (/\bE404\b|404 Not Found/i.test(detail)) return null
  throw new Error(`npm view failed for ${entry.name}@${entry.version}: ${detail}`)
}

function commandDetail(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim() || `npm exited ${result.status}`
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--packages-dir' || arg === '--npm') {
      const value = argv[++index]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      options[arg === '--packages-dir' ? 'packagesDir' : 'npm'] = value
    } else {
      throw new Error(`unknown option: ${arg}`)
    }
  }
  if (!options.packagesDir) {
    throw new Error('Usage: publish-cli-npm-packages.mjs --packages-dir <dir> [--npm <path>]')
  }
  return options
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    publishCliNpmPackages(parseArgs(process.argv.slice(2)))
  } catch (error) {
    process.stderr.write(`publish CLI npm packages: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
