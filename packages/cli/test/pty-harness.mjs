import './xterm-node-polyfill.mjs'

import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import HeadlessXterm from '@xterm/headless'
import * as pty from 'node-pty'

const { Terminal } = HeadlessXterm

export class TuiPtyHarness {
  static async start(options = {}) {
    const root = await mkdtemp(join(tmpdir(), 'openalice-tui-pty-'))
    const home = join(root, 'home')
    const openaliceHome = join(root, 'openalice-home')
    const fixture = options.fixture
    const launch = await resolveLaunch(options, fixture)
    const columns = options.columns ?? 80
    const rows = options.rows ?? 24
    const terminal = pty.spawn(launch.command, launch.args, {
      cwd: options.cwd,
      cols: columns,
      rows: rows,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        OPENALICE_HOME: openaliceHome,
        TERM: 'xterm-256color',
        ...(options.noColor ? { NO_COLOR: '1' } : {}),
        ...launch.environment,
        ...options.environment,
      },
    })
    return new TuiPtyHarness({ root, terminal, columns, rows })
  }

  constructor({ root, terminal, columns, rows }) {
    this.root = root
    this.terminal = terminal
    this.pid = terminal.pid
    this.rawOutput = ''
    this.transcript = []
    this.exitResult = null
    this.xterm = new Terminal({
      cols: columns,
      rows,
      scrollback: 100,
      allowProposedApi: true,
      logLevel: 'off',
    })
    this.exitPromise = new Promise((resolvePromise) => {
      terminal.onExit((result) => {
        this.exitResult = result
        this.transcript.push({ type: 'exit', result })
        resolvePromise(result)
      })
    })
    terminal.onData((data) => {
      this.rawOutput += data
      this.transcript.push({ type: 'output', data })
      const core = this.xterm._core
      if (typeof core?.writeSync === 'function') core.writeSync(data)
      else this.xterm.write(data)
    })
  }

  send(data) {
    this.transcript.push({ type: 'input', data })
    this.terminal.write(data)
  }

  resize(columns, rows) {
    this.transcript.push({ type: 'resize', columns, rows })
    this.xterm.resize(columns, rows)
    this.terminal.resize(columns, rows)
  }

  signal(signal) {
    this.transcript.push({ type: 'signal', signal })
    this.terminal.kill(signal)
  }

  screen() {
    const buffer = this.xterm.buffer.active
    const lines = []
    for (let index = 0; index < this.xterm.rows; index += 1) {
      lines.push(buffer.getLine(index)?.translateToString(true) ?? '')
    }
    return lines.join('\n').replace(/\s+$/g, '')
  }

  async waitForScreen(expected, timeoutMs = 3_000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const screen = this.screen()
      if (typeof expected === 'string' ? screen.includes(expected) : expected.test(screen)) {
        this.transcript.push({ type: 'screen', screen })
        return screen
      }
      if (this.exitResult) break
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10))
    }
    throw new Error(`TUI PTY screen timed out waiting for ${String(expected)}:\n${this.diagnostics()}`)
  }

  async waitForExit(timeoutMs = 3_000) {
    if (this.exitResult) return this.exitResult
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        rejectPromise(new Error(`TUI PTY exit timed out:\n${this.diagnostics()}`))
      }, timeoutMs)
      this.exitPromise.then((result) => {
        clearTimeout(timeout)
        resolvePromise(result)
      })
    })
  }

  diagnostics() {
    return [
      `screen:\n${this.screen()}`,
      `raw:\n${JSON.stringify(this.rawOutput)}`,
      `transcript:\n${JSON.stringify(this.transcript, null, 2)}`,
    ].join('\n\n')
  }

  async dispose() {
    if (!this.exitResult) {
      this.terminal.kill()
      await this.waitForExit().catch(() => {})
    }
    this.xterm.dispose()
    await rm(this.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
}

async function resolveLaunch(options, fixture) {
  if (!fixture) throw new Error('TUI PTY fixture path is required')
  if (!options.gitBash) return { command: process.execPath, args: [fixture], environment: {} }
  if (process.platform !== 'win32') throw new Error('Git Bash PTY launch is available only on Windows')

  const candidates = [
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'usr', 'bin', 'bash.exe'),
  ]
  const bash = await firstAccessible(candidates)
  return {
    command: bash,
    args: [
      '--noprofile',
      '--norc',
      '-lc',
      'exec "$(cygpath -u "$OPENALICE_NODE")" "$(cygpath -u "$OPENALICE_TUI_FIXTURE")"',
    ],
    environment: {
      OPENALICE_NODE: process.execPath,
      OPENALICE_TUI_FIXTURE: fixture,
      MSYSTEM: 'MINGW64',
    },
  }
}

async function firstAccessible(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Try the next standard Git for Windows path.
    }
  }
  throw new Error(`Git Bash was not found at: ${candidates.join(', ')}`)
}
