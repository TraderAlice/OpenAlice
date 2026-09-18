#!/usr/bin/env node

import { runNativeBootstrap } from '../src/native-bootstrap.mjs'

runNativeBootstrap(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error) => {
    process.stderr.write(`openalice-bootstrap: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1
  },
)
