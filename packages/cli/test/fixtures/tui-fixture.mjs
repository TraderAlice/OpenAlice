#!/usr/bin/env node

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
  process.stdout.write(`\nOPENALICE_TUI_RESTORED raw=${process.stdin.isRaw === true} reason=${outcome.reason}\n`)
  if (outcome.reason === 'SIGINT') process.exitCode = 130
  if (outcome.reason === 'SIGTERM') process.exitCode = 143
} catch (error) {
  process.stdout.write(`\nOPENALICE_TUI_RESTORED raw=${process.stdin.isRaw === true} reason=error\n`)
  process.stderr.write(`OpenAlice TUI fixture failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
