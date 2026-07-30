import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as pty from 'node-pty'
import { afterEach, describe, expect, it } from 'vitest'

const cliEntry = join(dirname(fileURLToPath(import.meta.url)), '../bin/openalice.ts')
const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )))
})

describe.skipIf(process.platform === 'win32')('Supervisor TUI PTY', () => {
  it('starts from the bare command and restores the terminal on detach', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-tui-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let openedHelp = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor TUI timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!openedHelp && output.includes('q / Esc / Ctrl+C  Detach without stopping')) {
          openedHelp = true
          child.write('?')
        } else if (!detached && output.includes('Supervisor controls')) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor TUI exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('OpenAlice  0.87.0-beta  development')
    expect(transcript).toContain('Runtime state: absent')
    expect(transcript).toContain('Supervisor controls')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  })

  it('renders an explicitly selected launch context before detach', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-context-'))
    temporaryPaths.push(isolatedHome)
    const instanceHome = join(isolatedHome, 'research')
    const child = pty.spawn(process.execPath, [
      cliEntry,
      '--instance', 'research',
      '--home', instanceHome,
      '--port', '44000',
      '--no-update-check',
    ], {
      cols: 120,
      rows: 28,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor launch-context TUI timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!detached && output.includes('Resolved: home (--home) · port (--port)')) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor launch-context TUI exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Instance: research')
    expect(transcript).toContain(`Home: ${instanceHome}`)
    expect(transcript).toContain('Resolved: home (--home) · port (--port)')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  })

  it('opens an in-TUI source prompt when startup has no checkout', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-source-prompt-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 100,
      rows: 28,
      cwd: isolatedHome,
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_SUPERVISOR_HOME: join(isolatedHome, 'supervisor'),
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let requestedStart = false
      let submittedInvalidPath = false
      let cancelledPrompt = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor source prompt timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!requestedStart && output.includes('c Source')) {
          requestedStart = true
          child.write('s')
        } else if (!submittedInvalidPath && output.includes('Configure Runtime source')) {
          submittedInvalidPath = true
          child.write('\u0005\u0015/definitely/not/openalice\r')
        } else if (!cancelledPrompt && output.includes('Could not use that checkout')) {
          cancelledPrompt = true
          child.write('\u001b')
        } else if (!detached && output.includes('Source configuration cancelled.')) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor source prompt exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Configure Runtime source')
    expect(transcript).toContain('Could not use that checkout')
    expect(transcript).toContain('Source configuration cancelled.')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  })

  it('explains when managed source is unavailable from a source-run CLI', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-managed-source-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 110,
      rows: 28,
      cwd: isolatedHome,
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_SUPERVISOR_HOME: join(isolatedHome, 'supervisor'),
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let requestedManaged = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor managed-source TUI timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!requestedManaged && output.includes('m Managed')) {
          requestedManaged = true
          child.write('m')
        } else if (!detached && output.includes('Managed source preparation is available from an installed')) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor managed-source TUI exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain(
      'Managed source preparation is available from an installed',
    )
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  })
})
