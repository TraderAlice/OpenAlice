import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { terminalSequences } from '../src/tui-renderer.mjs'
import { TuiPtyHarness } from './pty-harness.mjs'

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/tui-fixture.mjs')
const activeHarnesses = []

afterEach(async () => {
  await Promise.all(activeHarnesses.splice(0).map((harness) => harness.dispose()))
})

describe('Supervisor TUI PTY harness', { timeout: 10_000 }, () => {
  it('drives a real alternate-screen journey and restores raw mode on detach', async () => {
    const harness = await start()
    const screen = await harness.waitForScreen('OpenAlice 0.87.0-beta')
    expect(screen).toContain('RUNNING')
    expect(screen).toContain('Alice')
    expect(harness.rawOutput).toContain(terminalSequences.enterAlternateScreen)

    harness.send('q')
    const exit = await harness.waitForExit()

    expect(exit.exitCode).toBe(0)
    expect(harness.rawOutput).toContain(terminalSequences.leaveAlternateScreen)
    expect(harness.rawOutput).toContain('OPENALICE_TUI_RESTORED raw=false reason=detach')
  })

  it('treats Ctrl+C as detach and leaves the Runtime-oriented UI without a stop action', async () => {
    const harness = await start()
    await harness.waitForScreen('RUNNING')
    harness.send('\x03')

    expect((await harness.waitForExit()).exitCode).toBe(0)
    expect(harness.rawOutput).toContain('OPENALICE_TUI_RESTORED raw=false reason=ctrl-c')
  })

  it('parses Unicode through xterm, resizes to the narrow view, and honors NO_COLOR', async () => {
    const harness = await start({ noColor: true })
    expect(await harness.waitForScreen('爱丽丝')).toContain('q detach')
    harness.resize(48, 16)
    const screen = await harness.waitForScreen('Provider fixture')

    expect(screen).toContain('Alice: ready')
    expect(harness.rawOutput).not.toMatch(/\x1b\[(?:3[0-7]|9[0-7])m/)
    harness.send('q')
    expect((await harness.waitForExit()).exitCode).toBe(0)
  })

  it.skipIf(process.platform === 'win32')('restores the terminal before exiting on SIGTERM', async () => {
    const harness = await start()
    await harness.waitForScreen('RUNNING')
    harness.signal('SIGTERM')

    expect((await harness.waitForExit()).exitCode).toBe(143)
    expect(harness.rawOutput).toContain('OPENALICE_TUI_RESTORED raw=false reason=SIGTERM')
    expect(harness.rawOutput.indexOf(terminalSequences.leaveAlternateScreen))
      .toBeLessThan(harness.rawOutput.indexOf('OPENALICE_TUI_RESTORED'))
  })

  it('restores the terminal and emits a diagnostic when rendering throws', async () => {
    const harness = await start()
    await harness.waitForScreen('RUNNING')
    harness.send('e')

    expect((await harness.waitForExit()).exitCode).toBe(1)
    expect(harness.rawOutput).toContain(terminalSequences.leaveAlternateScreen)
    expect(harness.rawOutput).toContain('OPENALICE_TUI_RESTORED raw=false reason=error')
    expect(harness.rawOutput).toContain('intentional renderer failure')
  })

  it('keeps the TUI attached to its model when control disconnects', async () => {
    const harness = await start()
    await harness.waitForScreen('RUNNING')
    harness.send('z')

    const screen = await harness.waitForScreen('RECONNECTING')
    expect(screen).toContain('Control disconnected; retrying')
    expect(harness.exitResult).toBeNull()
    harness.send('q')
    expect((await harness.waitForExit()).exitCode).toBe(0)
  })

  it.runIf(process.platform === 'win32')('runs and restores through Git Bash on Windows', async () => {
    const harness = await start({ gitBash: true })
    await harness.waitForScreen('RUNNING')
    harness.resize(64, 20)
    harness.send('q')

    expect((await harness.waitForExit()).exitCode).toBe(0)
    expect(harness.rawOutput).toContain('OPENALICE_TUI_RESTORED raw=false reason=detach')
  })
})

async function start(options = {}) {
  const harness = await TuiPtyHarness.start({
    fixture,
    cwd: dirname(fixture),
    ...options,
  })
  activeHarnesses.push(harness)
  return harness
}
