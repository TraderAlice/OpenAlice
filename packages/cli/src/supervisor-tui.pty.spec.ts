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
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor TUI timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!detached && output.includes('q / Esc / Ctrl+C  Detach')) {
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
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  })
})
