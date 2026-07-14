#!/usr/bin/env node

import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { formatLocalStartHelp, parseLocalStartArgs, startLocal } from '../src/local-start.mjs'
import { connectSsh, formatSshHelp, parseSshConnectArgs } from '../src/ssh-connect.mjs'

export async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv
  if (command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(formatHelp())
    return 0
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    process.stdout.write(`${readVersion()}\n`)
    return 0
  }
  if (!command || command === 'start' || command.startsWith('-')) {
    const startArgs = command === 'start' ? args : argv
    if (startArgs.includes('--help') || startArgs.includes('-h')) {
      process.stdout.write(formatLocalStartHelp())
      return 0
    }
    return startLocal(parseLocalStartArgs(startArgs))
  }
  if (command === 'ssh') {
    if (args.includes('--help') || args.includes('-h')) {
      process.stdout.write(formatSshHelp())
      return 0
    }
    return connectSsh(parseSshConnectArgs(args))
  }
  throw new Error(`Unknown command: ${command}\n\n${formatHelp()}`)
}

function formatHelp() {
  return `OpenAlice CLI

Usage:
  openalice
  openalice start [path] [options]
  openalice ssh <user@host> [options]

Commands:
  start     Start OpenAlice from a source checkout on local loopback (default)
  ssh       Open a loopback-only SSH tunnel to an already-running OpenAlice

Run "openalice start --help" or "openalice ssh --help" for details.
`
}

function readVersion() {
  const packageUrl = new URL('../package.json', import.meta.url)
  return JSON.parse(readFileSync(packageUrl, 'utf8')).version
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => { process.exitCode = code },
    (error) => {
      process.stderr.write(`openalice: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    },
  )
}
