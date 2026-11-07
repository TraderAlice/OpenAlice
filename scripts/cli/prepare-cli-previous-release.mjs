#!/usr/bin/env node

import { pathToFileURL } from 'node:url'

import { preparePreviousCliReleaseArchives } from './cli-release-fixture.mjs'

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!['--input-dir', '--output-dir', '--version'].includes(name) || !value) {
      throw new Error('Usage: prepare-cli-previous-release.mjs --input-dir <dir> --output-dir <dir> --version <version>')
    }
    options[name.slice(2)] = value
  }
  if (argv.length !== 6 || Object.keys(options).length !== 3) {
    throw new Error('Usage: prepare-cli-previous-release.mjs --input-dir <dir> --output-dir <dir> --version <version>')
  }
  return {
    inputDir: options['input-dir'],
    outputDir: options['output-dir'],
    version: options.version,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const manifest = preparePreviousCliReleaseArchives(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(manifest)}\n`)
  } catch (error) {
    process.stderr.write(`prepare previous CLI release: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
