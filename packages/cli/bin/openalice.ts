#!/usr/bin/env node

import { main } from '../src/main.ts'

main().then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`openalice: ${message}\n`)
    process.exitCode = isCliError(error) ? error.exitCode : 1
  },
)

function isCliError(error: unknown): error is Error & { exitCode: number } {
  return error instanceof Error
    && 'exitCode' in error
    && Number.isInteger(error.exitCode)
}
