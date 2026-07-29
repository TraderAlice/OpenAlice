#!/usr/bin/env node

import { writeFile } from 'node:fs/promises'

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
  await writeResult(result)
  await writeTerminal(
    process.stdout,
    `\nOPENALICE_TUI_RESTORED raw=${result.raw} reason=${result.reason}\n`,
  )
  if (outcome.reason === 'SIGINT') process.exitCode = 130
  if (outcome.reason === 'SIGTERM') process.exitCode = 143
} catch (error) {
  const result = {
    reason: 'error',
    raw: process.stdin.isRaw === true,
    errorMessage: error instanceof Error ? error.message : String(error),
  }
  await writeResult(result)
  await writeTerminal(
    process.stdout,
    `\nOPENALICE_TUI_RESTORED raw=${result.raw} reason=${result.reason}\n`,
  )
  await writeTerminal(process.stderr, `OpenAlice TUI fixture failed: ${result.errorMessage}\n`)
  process.exitCode = 1
}

async function writeResult(result) {
  const resultPath = process.env.OPENALICE_TUI_RESULT_PATH
  if (!resultPath) return
  await writeFile(resultPath, `${JSON.stringify(result)}\n`, 'utf8')
}

function writeTerminal(stream, text) {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      stream.off('error', finish)
      resolve()
    }
    stream.once('error', finish)
    try {
      stream.write(text, finish)
    } catch {
      finish()
    }
  })
}
