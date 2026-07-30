#!/usr/bin/env node

import { writeFileSync, writeSync } from 'node:fs'

import { createSupervisorFrame } from '../../src/tui-frame.mjs'
import { createTerminalSession } from '../../src/tui-session.mjs'

const model = {
  productVersion: '0.87.0-beta',
  state: 'running',
  instance: 'default',
  endpoint: 'http://127.0.0.1:3000',
  home: `爱丽丝/${process.env.OPENALICE_HOME ?? '/tmp/openalice'}`,
  uptime: '2h 14m',
  provider: 'fixture',
  components: [
    ['Alice', 'ready'],
    ['UTA', 'optional'],
    ['Connector', 'stopped'],
  ],
  detail: 'Deterministic control fixture connected.',
}

let failRender = false

try {
  const session = createTerminalSession({
    render: ({ columns, rows, color }) => {
      if (failRender) throw new Error('intentional renderer failure')
      return createSupervisorFrame(model, { columns, rows, color })
    },
    onInput: (data, controls) => {
      for (const byte of data) {
        if (byte === 0x71 || byte === 0x03) {
          controls.finish(byte === 0x03 ? 'ctrl-c' : 'detach')
          return
        }
        if (byte === 0x7a) {
          model.state = 'reconnecting'
          model.detail = 'Control disconnected; retrying without stopping the TUI.'
          controls.redraw()
        }
        if (byte === 0x65) {
          failRender = true
          controls.redraw()
        }
      }
    },
  })
  const outcome = await session.waitForExit()
  const result = {
    reason: outcome.reason,
    raw: process.stdin.isRaw === true,
    errorMessage: null,
  }
  writeResult(result)
  writeTerminal(
    process.stdout,
    `\nOPENALICE_TUI_RESTORED raw=${result.raw} reason=${result.reason}\n`,
  )
  process.exitCode = outcome.reason === 'SIGINT' ? 130 : outcome.reason === 'SIGTERM' ? 143 : 0
} catch (error) {
  const result = {
    reason: 'error',
    raw: process.stdin.isRaw === true,
    errorMessage: error instanceof Error ? error.message : String(error),
  }
  writeResult(result)
  writeTerminal(
    process.stdout,
    `\nOPENALICE_TUI_RESTORED raw=${result.raw} reason=${result.reason}\n`,
  )
  writeTerminal(process.stderr, `OpenAlice TUI fixture failed: ${result.errorMessage}\n`)
  process.exitCode = 1
}

function writeResult(result) {
  const resultPath = process.env.OPENALICE_TUI_RESULT_PATH
  if (!resultPath) return
  writeFileSync(resultPath, `${JSON.stringify(result)}\n`, 'utf8')
}

function writeTerminal(stream, text) {
  // A pending stream callback does not keep an ESM top-level await alive on
  // every Windows ConPTY implementation. Commit the fixture's evidence before
  // publishing an explicit child exit code so node-pty never observes a half
  // written result or an unsettled-module failure.
  writeSync(stream.fd, text)
}
