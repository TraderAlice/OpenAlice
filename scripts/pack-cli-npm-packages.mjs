#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, parse, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

export function packCliNpmPackages({
  inputDir,
  outputDir,
  npm = process.platform === 'win32' ? 'npm.cmd' : 'npm',
}) {
  const inputRoot = resolve(inputDir)
  const outputRoot = resolve(outputDir)
  assertSafeOutputRoot(outputRoot, inputRoot)
  const metaRoot = join(inputRoot, 'openalice')
  if (!existsSync(join(metaRoot, 'package.json'))) {
    throw new Error(`OpenAlice npm meta package is missing: ${metaRoot}`)
  }

  const meta = readPackage(metaRoot)
  const platformNames = Object.keys(meta.optionalDependencies ?? {}).sort()
  if (platformNames.length === 0) throw new Error('OpenAlice npm meta package has no platform packages')
  for (const name of platformNames) {
    const packageRoot = join(inputRoot, name)
    const platformPackage = readPackage(packageRoot)
    if (platformPackage.name !== name || platformPackage.version !== meta.version) {
      throw new Error(`platform package does not match ${name}@${meta.version}`)
    }
    if (meta.optionalDependencies[name] !== meta.version) {
      throw new Error(`meta package does not pin ${name} to ${meta.version}`)
    }
  }

  rmSync(outputRoot, { recursive: true, force: true })
  mkdirSync(outputRoot, { recursive: true })
  const packages = []
  for (const name of [...platformNames, meta.name]) {
    const packed = pack(join(inputRoot, name), outputRoot, npm)
    packages.push({
      name,
      version: meta.version,
      filename: packed.filename,
      shasum: packed.shasum,
      integrity: packed.integrity,
    })
  }
  const manifest = {
    schemaVersion: 1,
    version: meta.version,
    publishOrder: packages.map(({ name }) => name),
    packages,
  }
  writeFileSync(join(outputRoot, 'npm-publish-order.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

function pack(packageRoot, outputRoot, npm) {
  const result = spawnSync(npm, [
    'pack', packageRoot, '--json', '--pack-destination', outputRoot,
  ], {
    encoding: 'utf8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`npm pack failed for ${packageRoot}:\n${result.stdout}\n${result.stderr}`)
  }
  const report = JSON.parse(result.stdout)
  if (!Array.isArray(report) || report.length !== 1) {
    throw new Error(`npm pack returned an invalid report for ${packageRoot}`)
  }
  const packed = report[0]
  if (
    typeof packed.filename !== 'string'
    || typeof packed.shasum !== 'string'
    || typeof packed.integrity !== 'string'
  ) {
    throw new Error(`npm pack omitted integrity metadata for ${packageRoot}`)
  }
  return packed
}

function readPackage(root) {
  const path = join(root, 'package.json')
  if (!existsSync(path)) throw new Error(`npm package is missing: ${path}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function assertSafeOutputRoot(outputRoot, inputRoot) {
  if (
    outputRoot === parse(outputRoot).root
    || outputRoot === homedir()
    || outputRoot === repositoryRoot
    || outputRoot === inputRoot
    || inputRoot.startsWith(`${outputRoot}/`)
    || outputRoot.startsWith(`${inputRoot}/`)
  ) {
    throw new Error(`refusing unsafe npm package output directory: ${outputRoot}`)
  }
}

function parseArgs(argv) {
  const options = { npm: process.platform === 'win32' ? 'npm.cmd' : 'npm' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (['--input-dir', '--output-dir', '--npm'].includes(arg)) {
      const value = argv[++index]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      options[arg.slice(2).replaceAll('-', '')] = value
    } else {
      throw new Error(`unknown option: ${arg}`)
    }
  }
  if (!options.inputdir || !options.outputdir) {
    throw new Error('Usage: pack-cli-npm-packages.mjs --input-dir <dir> --output-dir <dir> [--npm <path>]')
  }
  return { inputDir: options.inputdir, outputDir: options.outputdir, npm: options.npm }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(packCliNpmPackages(parseArgs(process.argv.slice(2))))}\n`)
  } catch (error) {
    process.stderr.write(`pack CLI npm packages: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
