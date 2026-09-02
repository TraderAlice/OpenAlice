import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as pty from 'node-pty'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const cliEntry = join(dirname(fileURLToPath(import.meta.url)), '../bin/openalice.ts')
const transferFixtureEntry = join(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/supervisor-transfer-tui-fixture.ts',
)
const confirmationFixtureEntry = join(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/supervisor-confirmation-tui-fixture.ts',
)
const launchpadFixtureEntry = join(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/supervisor-launchpad-tui-fixture.ts',
)
const doctorPrimaryFixtureEntry = join(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/supervisor-doctor-primary-tui-fixture.ts',
)
const releaseFixtureEntry = join(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/supervisor-release-tui-fixture.ts',
)
const eventLensFixtureEntry = join(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/supervisor-event-lens-tui-fixture.ts',
)
const cliPackageRoot = dirname(dirname(cliEntry))
const cliVersion = JSON.parse(
  await readFile(join(cliPackageRoot, 'package.json'), 'utf8'),
).version
const temporaryPaths: string[] = []
const originalStartView = process.env.OPENALICE_TUI_START_VIEW

beforeAll(() => {
  process.env.OPENALICE_TUI_START_VIEW = 'home'
})

afterAll(() => {
  if (originalStartView === undefined) delete process.env.OPENALICE_TUI_START_VIEW
  else process.env.OPENALICE_TUI_START_VIEW = originalStartView
})

function stripSgr(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/gu, '')
}

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )))
})

describe.skipIf(process.platform === 'win32')('Supervisor TUI PTY', () => {
  it('shows a truthful Launch Flight Recorder while starting a local Runtime', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-launch-flight-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 110,
      rows: 30,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_START_VIEW: 'connect',
        OPENALICE_TUI_BOOT: '0',
        OPENALICE_TUI_MOTION: '0',
        OPENALICE_TUI_FIXTURE_FLEET_ROWS: '1',
        OPENALICE_TUI_FIXTURE_START_DELAY_MS: '250',
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let started = false
      let sawFlight = false
      let reachedHome = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor launch flight timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        const plain = stripSgr(output)
        if (!started && plain.includes('OPENALICE LAUNCH · SELECT → START → CONNECT')) {
          started = true
          child.write('\r')
        }
        if (!sawFlight && plain.includes('Launch Flight Recorder · LOCAL START · IN FLIGHT')) {
          sawFlight = true
        }
        if (sawFlight && !reachedHome && plain.includes('◆ [Home] │ ● Inbox')) {
          reachedHome = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && sawFlight && reachedHome) resolve(output)
        else reject(new Error(`Supervisor launch flight exited ${exitCode}:\n${output}`))
      })
    })

    const plain = stripSgr(transcript)
    expect(plain).toContain('◆ IN FLIGHT · This computer → Default AliceProject')
    expect(plain).toContain('✓ 01  Validate local target · DONE')
    expect(plain).toContain('◆ 02  Prepare and start Runtime · IN FLIGHT')
    expect(plain).toContain('◇ 03  Bind local target · WAITING')
    expect(plain).toContain('◇ CONTROL  Keep this terminal open')
    expect(plain).toContain('◇ HANDOFF · THIS TUI STAYS IN CONTROL')
    expect(plain).toContain('1 Start Runtime')
    expect(plain).toContain('2 Verify Web endpoint')
    expect(plain).toContain('3 Enter connected Home')
    expect(plain).toContain('NEXT     Use [ Enter ] Start OpenAlice from this Briefing.')
    expect(plain).toContain('FIXTURE_RESULT starts=1 opens=0 loads=0 diagnoses=0')
    expect(transcript).toContain('\u001b[?25h')
  }, 12_000)

  it('opens a stopped AliceProject in the connection-first Launcher by default', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-launcher-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 100,
      rows: 28,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_START_VIEW: 'connect',
        OPENALICE_TUI_BOOT: '0',
        OPENALICE_TUI_MOTION: '0',
        OPENALICE_TUI_FIXTURE_FLEET_ROWS: '1',
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let launched = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Launcher timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!launched && output.includes('3 RUNTIME ○ READY')) {
          launched = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && launched) resolve(output)
        else reject(new Error(`Supervisor Launcher exited ${exitCode}:\n${output}`))
      })
    })

    const plain = stripSgr(transcript)
    expect(plain).toContain('◆ [Connect]·1')
    expect(plain).toContain('OPENALICE LAUNCH · SELECT → START → CONNECT')
    expect(plain).toContain('1 MACHINE ✓ This computer')
    expect(plain).toContain('2 ALICEPROJECT ✓ Default')
    expect(plain).toContain('[ Enter ] Start OpenAlice')
    expect(plain).toContain('Launch Briefing · AliceProject')
    expect(plain).toContain('◆ LAUNCH READY · READY TO START')
    expect(plain).toContain('1 Start Runtime')
    expect(plain).toContain('2 Verify Web endpoint')
    expect(plain).toContain('3 Enter connected Home')
    expect(plain).not.toContain('OWNER    none')
    expect(plain).not.toContain('Inbox')
    expect(transcript).toContain('\u001b[?25h')
  }, 12_000)

  it('connects and explicitly disconnects one remote target through a real PTY', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-remote-target-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 110,
      rows: 30,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_START_VIEW: 'connect',
        OPENALICE_TUI_BOOT: '0',
        OPENALICE_TUI_MOTION: '0',
        OPENALICE_TUI_FIXTURE_FLEET_ROWS: '1',
        OPENALICE_TUI_FIXTURE_REMOTE: '1',
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let connecting = false
      let disconnecting = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor remote target timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        const plain = stripSgr(output)
        if (!connecting && plain.includes('OPENALICE LAUNCH')) {
          connecting = true
          child.write('\u001b[B')
          child.write('\t')
          child.write('\r')
        } else if (connecting && !disconnecting && plain.includes('⌁ Cloud Lab · SSH')) {
          disconnecting = true
          child.write('x')
        } else if (disconnecting
          && plain.includes('Disconnected from Cloud Lab / Research')
          && plain.includes('OPENALICE LAUNCH')) {
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && disconnecting) resolve(output)
        else reject(new Error(`Supervisor remote target exited ${exitCode}:\n${output}`))
      })
    })

    const plain = stripSgr(transcript)
    expect(plain).toContain('⌁ Cloud Lab · SSH')
    expect(plain).toContain('⌁ Cloud Lab · SSH')
    expect(plain).toContain('Disconnected from Cloud Lab / Research')
    expect(plain).toContain('FIXTURE_RESULT starts=0 opens=0 loads=0 diagnoses=0 disconnects=1 probes=0')
    expect(transcript).toContain('\u001b[?25h')
  }, 12_000)

  it('shows remote degradation and recovers in place through a real PTY', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-remote-health-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 110,
      rows: 30,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_START_VIEW: 'connect',
        OPENALICE_TUI_BOOT: '0',
        OPENALICE_TUI_MOTION: '0',
        OPENALICE_TUI_FIXTURE_FLEET_ROWS: '1',
        OPENALICE_TUI_FIXTURE_REMOTE: '1',
        OPENALICE_TUI_FIXTURE_HEALTH: 'flap',
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let connected = false
      let unreachable = false
      let openedRuntime = false
      let exiting = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor remote health timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        const plain = stripSgr(output)
        if (!connected && plain.includes('OPENALICE LAUNCH')) {
          connected = true
          child.write('\u001b[B')
          child.write('\t')
          child.write('\r')
        } else if (connected && !unreachable && plain.includes('× UNREACHABLE')) {
          unreachable = true
        } else if (!openedRuntime && unreachable && plain.includes('Connection to Cloud Lab / Research is healthy.')) {
          openedRuntime = true
          child.write('\u001b[D')
        } else if (!exiting
          && openedRuntime
          && plain.includes('Runtime Observatory')
          && plain.includes('RECOVERED')
          && plain.includes('UNREACHABLE')
          && plain.includes('DEGRADED')) {
          exiting = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && unreachable) resolve(output)
        else reject(new Error(`Supervisor remote health exited ${exitCode}:\n${output}`))
      })
    })

    const plain = stripSgr(transcript)
    expect(plain).toContain('! DEGRADED')
    expect(plain).toContain('× UNREACHABLE')
    expect(plain).toContain('Press Enter or r to retry')
    expect(plain).toContain('Connection to Cloud Lab / Research is healthy.')
    expect(plain).toContain('Runtime Observatory · CONNECTED · REMOTE')
    expect(plain).toContain('RUNTIME')
    expect(plain).toContain('ROUTE')
    expect(plain).toContain('SERVICES')
    expect(plain).toContain('RECOVERED')
    expect(plain).toContain('FIXTURE_RESULT starts=0 opens=0 loads=0 diagnoses=0 disconnects=1 probes=4')
    expect(transcript).toContain('\u001b[?25h')
  }, 12_000)

  it('skips the Boot Sequence with raw pointer input without click-through', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-boot-pointer-'))
    temporaryPaths.push(isolatedHome)
    const childEnv = { ...process.env }
    delete childEnv.NO_COLOR
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...childEnv,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_BOOT: '1',
        OPENALICE_TUI_FIXTURE_RUNTIME: 'running',
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let skipped = false
      let entered = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Boot Sequence pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!skipped && output.includes('O P E N A L I C E')) {
          skipped = true
          child.write('\u001b[<35;20;9M')
          child.write('\u001b[<0;20;9M')
        } else if (skipped && !entered && output.includes('OpenAlice Supervisor')) {
          entered = true
          setTimeout(() => child.write('q'), 100)
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && skipped && entered) resolve(output)
        else reject(new Error(`Supervisor Boot Sequence pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('O P E N A L I C E')
    expect(transcript).toContain('◆ ALICEPROJECT')
    expect(transcript).toContain('OpenAlice Supervisor')
    expect(transcript).toContain('FIXTURE_RESULT starts=0 opens=0 loads=0 diagnoses=0')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('detaches directly from the Boot Sequence with q', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-boot-detach-'))
    temporaryPaths.push(isolatedHome)
    const childEnv = { ...process.env }
    delete childEnv.NO_COLOR
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...childEnv,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_BOOT: '1',
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Boot Sequence detach timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!detached && output.includes('O P E N A L I C E')) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && detached) resolve(output)
        else reject(new Error(`Supervisor Boot Sequence detach exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('O P E N A L I C E')
    expect(transcript).not.toContain('OpenAlice Supervisor')
    expect(transcript).toContain('FIXTURE_RESULT starts=0 opens=0 loads=0 diagnoses=0')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('selects a release lane and clicks the Channel Brief action with raw pointer input', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-release-pointer-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [releaseFixtureEntry], {
      cols: 110,
      rows: 30,
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
      let opened = false
      let laneHovered = false
      let laneSelected = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Release Observatory pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('◆ [Home]')) {
          opened = true
          child.write('\u001b[<35;90;1M')
          child.write('\u001b[<0;90;1M')
        } else if (!laneHovered && output.includes('Release Observatory · 3 LANES')) {
          laneHovered = true
          setTimeout(() => child.write('\u001b[<35;20;7M'), 100)
        } else if (!laneSelected && output.includes('│ › Dev')) {
          laneSelected = true
          child.write('\u001b[<0;20;7M')
          setTimeout(() => {
            child.write('\u001b[<35;70;10M')
            setTimeout(() => {
              child.write('\u001b[<0;70;10M')
              setTimeout(() => child.write('q'), 300)
            }, 100)
          }, 100)
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor Release Observatory pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('│ › Dev')
    expect(transcript).toContain('Channel Brief · 3/3 · INSTALLED BETA')
    expect(transcript).toContain('› [ Enter ] Check')
    expect(transcript).toContain('OpenAlice is current on dev.')
    expect(transcript).toContain('FIXTURE_RESULT checked=dev')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('opens Setup from the single-spine Command Dock', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-action-shelf-pointer-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
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

    let overlayIdleOutput = ''
    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let dockOpened = false
      let queried = false
      let clicked = false
      let closed = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Command Dock pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!dockOpened && output.includes('Alice Session · OpenAlice')) {
          dockOpened = true
          child.write('/')
        } else if (!queried && output.includes('Command Dock')) {
          queried = true
          child.write('setup')
        } else if (!clicked && output.includes('›   Setup')) {
          clicked = true
          child.write('\r')
        } else if (!closed && clicked && output.includes('╭ Setup Studio · Default AliceProject')) {
          closed = true
          const pausedAt = output.length
          setTimeout(() => {
            overlayIdleOutput = output.slice(pausedAt)
            child.write('\u001b')
          }, 650)
        } else if (!detached && closed && output.includes('Setup closed.')) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor Command Dock pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Alice Session · OpenAlice')
    expect(stripSgr(transcript)).not.toContain('Runtime Signal Deck')
    expect(stripSgr(overlayIdleOutput)).not.toContain('OpenAlice Supervisor')
    expect(transcript).not.toContain('CONTROL CONSOLE')
    expect(transcript).toContain('MATCH “setup”')
    expect(transcript).toContain('›   Setup')
    expect(transcript).toContain('╭ Setup Studio · Default AliceProject')
    expect(transcript).toContain('FIXTURE_RESULT starts=0 opens=0')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('hovers and clicks the quiet compact Runtime Lens reload segment', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-signal-scope-pointer-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        TERM: 'xterm-256color',
        OPENALICE_TUI_MOTION: '0',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let hovered = false
      let clicked = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Signal Scope pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('◆ [ Enter ]  Start OpenAlice')) {
          opened = true
          child.write('l')
        } else if (!hovered && output.includes('Runtime Lens · QUIET · 0 EVENTS')) {
          hovered = true
          child.write('\u001b[<35;30;7M')
        } else if (!clicked && output.includes('› [ l ] Reload Runtime snapshot')) {
          clicked = true
          child.write('\u001b[<0;30;7M')
        } else if (!detached && clicked) {
          detached = true
          setTimeout(() => child.write('q'), 250)
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor Signal Scope pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Runtime Lens · QUIET · 0 EVENTS')
    expect(transcript).toContain('○ QUIET · No Runtime events · all events · bounded/redacted')
    expect(stripSgr(transcript)).toContain(
      '◇  Tip: No Runtime events in this lens; l reloads the bounded snapshot.',
    )
    expect(stripSgr(transcript)).toContain('◆ [ l ] Reload Runtime snapshot')
    expect(stripSgr(transcript)).not.toContain('[ ↑↓ ] Scroll')
    expect(stripSgr(transcript)).not.toContain('[ End ] Latest')
    expect(transcript).toContain('› [ l ] Reload Runtime snapshot')
    expect(transcript).toContain('FIXTURE_RESULT starts=0 opens=0 loads=2')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
    expect(transcript).toContain('\u001b[?1006l')
  }, 12_000)

  it('hovers and clicks the no-check Diagnostic Radar rerun segment', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-diagnostic-radar-pointer-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        TERM: 'xterm-256color',
        OPENALICE_TUI_MOTION: '0',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let hovered = false
      let clicked = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Diagnostic Radar pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('◆ [ Enter ]  Start OpenAlice')) {
          opened = true
          child.write('d')
        } else if (!hovered && output.includes('Diagnostic Radar · NO CHECKS · 0F/0W/0P')) {
          hovered = true
          child.write('\u001b[<35;24;10M')
        } else if (!clicked && output.includes('› [ d ] Rerun Runtime Doctor')) {
          clicked = true
          child.write('\u001b[<0;24;10M')
        } else if (!detached && clicked) {
          detached = true
          setTimeout(() => child.write('q'), 250)
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor Diagnostic Radar pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Diagnostic Radar · NO CHECKS · 0F/0W/0P')
    expect(transcript).toContain('○  NO CHECKS')
    expect(transcript).toContain('› [ d ] Rerun Runtime Doctor')
    expect(stripSgr(transcript)).toContain('◆ [ d ] Rerun Runtime Doctor')
    expect(stripSgr(transcript)).not.toContain('[ ↑↓ ] Inspect')
    expect(stripSgr(transcript)).not.toContain('[ Home ] First')
    expect(transcript).toContain('FIXTURE_RESULT starts=0 opens=0 loads=0 diagnoses=2')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
    expect(transcript).toContain('\u001b[?1006l')
  }, 12_000)

  it('hovers and selects an Event Lens row with raw pointer input', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-event-lens-pointer-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [eventLensFixtureEntry], {
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
      let opened = false
      let hovered = false
      let clicked = false
      let copyClicked = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Event Lens pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('Alice Session · OpenAlice')) {
          opened = true
          child.write('l')
        } else if (!hovered && output.includes('Event Lens · LINE 10 · INFO · TEXT')) {
          hovered = true
          child.write('\u001b[<35;20;11M')
        } else if (!clicked && output.includes('│ » !  9  03:04:09Z Fixture event 9')) {
          clicked = true
          child.write('\u001b[<0;20;11M')
        } else if (!copyClicked && clicked && output.includes('Event Lens · LINE 9 · WARNING · JSON')) {
          copyClicked = true
          child.write('y')
        } else if (copyClicked && output.includes('Sent Runtime event 9')) {
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor Event Lens pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('│ » !  9  03:04:09Z Fixture event 9')
    expect(transcript).toContain('Event Lens · LINE 9 · WARNING · JSON')
    expect(transcript).toContain('Sent Runtime event 9')
    expect(transcript).toContain(
      `\u001b]52;c;${Buffer.from('{"ts":"2026-09-02T03:04:09Z","level":"warn","msg":"Fixture event 9","scope":"pty"}').toString('base64')}\u0007`,
    )
    expect(transcript).toContain('█')
    expect(transcript).toContain('FIXTURE_RESULT event-lens')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('scrubs the Event Lens rail with raw hover, press, drag, and release reports', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-event-rail-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [eventLensFixtureEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_MOTION: '0',
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let hovered = false
      let pressed = false
      let dragged = false
      let released = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Event rail timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('Alice Session · OpenAlice')) {
          opened = true
          child.write('l')
        } else if (!hovered && output.includes('4–10/10 · ALL · LATEST')) {
          hovered = true
          child.write('\u001b[<35;78;6M')
        } else if (hovered && !pressed && output.includes('Runtime event 1/10')) {
          pressed = true
          child.write('\u001b[<0;78;6M')
        } else if (pressed && !dragged && output.includes('Event Lens · LINE 1 · INFO · TEXT')) {
          dragged = true
          child.write('\u001b[<32;78;12M')
        } else if (dragged && !released && output.includes('Event Lens · LINE 10 · INFO · TEXT')) {
          released = true
          child.write('\u001b[<0;78;12m')
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && released) resolve(output)
        else reject(new Error(`Supervisor Event rail exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Runtime event 1/10')
    expect(transcript).toContain('Event Lens · LINE 1 · INFO · TEXT')
    expect(transcript).toContain('Event Lens · LINE 10 · INFO · TEXT')
    expect(transcript).toContain('FIXTURE_RESULT event-lens')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('uses a 120x32 Operational Canvas for twenty clickable Runtime events', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-event-canvas-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [eventLensFixtureEntry], {
      cols: 120,
      rows: 32,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_FIXTURE_EVENT_ROWS: '20',
        OPENALICE_TUI_MOTION: '0',
        TERM: 'xterm-256color',
      },
    })

    let expandedFrame = ''
    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let hovered = false
      let clicked = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Event Canvas timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('Alice Session · OpenAlice')) {
          opened = true
          child.write('l')
        } else if (!hovered && output.includes('1–20/20 · ALL · LATEST')) {
          hovered = true
          expandedFrame = output.slice(output.lastIndexOf('Event stream · 1–20/20'))
          child.write('\u001b[<35;20;24M')
        } else if (!clicked && output.includes('» · 19  fixture event 19')) {
          clicked = true
          child.write('\u001b[<0;20;24M')
        } else if (clicked && output.includes('Event Lens · LINE 19 · INFO · TEXT')) {
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && clicked) resolve(output)
        else reject(new Error(`Supervisor Event Canvas exited ${exitCode}:\n${output}`))
      })
    })

    expect(stripSgr(expandedFrame)).toContain('1–20/20 · ALL · LATEST')
    expect(stripSgr(expandedFrame)).not.toContain('█')
    expect(transcript).toContain('» · 19  fixture event 19')
    expect(transcript).toContain('› · 19  fixture event 19')
    expect(transcript).toContain('Event Lens · LINE 19 · INFO · TEXT')
    expect(transcript).toContain('╰─ [ / ] Commands')
    expect(transcript).not.toContain('CONTROL CONSOLE')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('hovers and clicks the Session Stage primary surface outside its keycap', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-launchpad-pointer-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
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
      let hovered = false
      let clicked = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Launchpad pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!hovered && output.includes('Start OpenAlice for this AliceProject') && output.includes('[ Enter ]')) {
          hovered = true
          child.write('\u001b[<35;60;13M')
        } else if (!clicked && output.includes('│ › [ Enter ]')) {
          clicked = true
          child.write('\u001b[<0;60;13M')
        } else if (clicked && output.includes('OpenAlice started')) {
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor Launchpad pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('│ › [ Enter ]')
    expect(transcript).toContain('FIXTURE_RESULT starts=1 opens=1')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('opens the verified Web UI by clicking the running Session Stage primary', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-signal-hotspot-'))
    temporaryPaths.push(isolatedHome)
    const childEnv = { ...process.env }
    delete childEnv.NO_COLOR
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...childEnv,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_FIXTURE_RUNTIME: 'running',
        OPENALICE_TUI_MOTION: '0',
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let hovered = false
      let clicked = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Signal Hotspot pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!hovered && output.includes('Runtime is live; AliceProject home is missing') && output.includes('[ Enter ]')) {
          hovered = true
          child.write('\u001b[<35;70;13M')
        } else if (!clicked && output.includes('│ › [ Enter ]')) {
          clicked = true
          child.write('\u001b[<0;70;13M')
        } else if (!detached && clicked && output.includes('FIXTURE_RESULT') === false && output.includes('Opened the verified Web')) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor Signal Hotspot pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('│ › [ Enter ]')
    expect(stripSgr(transcript)).toContain('HOME MISSING')
    expect(transcript).toContain('Opened the verified Web')
    expect(transcript).toContain('FIXTURE_RESULT starts=0 opens=1')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('routes Home Enter to unread Inbox work before opening the Workspace', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-home-inbox-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_FIXTURE_RUNTIME: 'running',
        OPENALICE_TUI_FIXTURE_INBOX_UNREAD: '2',
        OPENALICE_TUI_MOTION: '0',
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let openedInbox = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Home Inbox route timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!openedInbox && output.includes('[ Enter ]  Review 2 unread reports')) {
          openedInbox = true
          child.write('\r')
        } else if (!detached && openedInbox && output.includes('Message stream') && output.includes('2 UNREAD')) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && openedInbox) resolve(output)
        else reject(new Error(`Supervisor Home Inbox route exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('◆ Inbox  2 unread reports')
    expect(transcript).toContain('[ Enter ]  Review 2 unread reports')
    expect(transcript).toContain('Message stream')
    expect(transcript).toContain('2 UNREAD')
    expect(transcript).toContain('FIXTURE_RESULT starts=0 opens=0')
    expect(transcript).toContain('\u001b[?25h')
  }, 12_000)

  it('integrates the wide Alice mark without breaking Session Stage pointer geometry', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-integrated-launchpad-'))
    temporaryPaths.push(isolatedHome)
    const childEnv = { ...process.env }
    delete childEnv.NO_COLOR
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 120,
      rows: 30,
      cwd: dirname(cliEntry),
      env: {
        ...childEnv,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let hovered = false
      let clicked = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor integrated Launchpad pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        const plainOutput = output.replace(/\u001b\[[0-9;?<>]*[A-Za-z~]/gu, '')
        if (
          !hovered
          && plainOutput.includes('Alice Session · OpenAlice')
          && plainOutput.includes('▄▀▄ █   ▀█▀ ▄▀▀ █▀▀')
        ) {
          hovered = true
          child.write('\u001b[<35;70;20M')
        } else if (!clicked && plainOutput.includes('│ › [ Enter ]')) {
          clicked = true
          child.write('\u001b[<0;70;20M')
        } else if (clicked && plainOutput.includes('OpenAlice started')) {
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor integrated Launchpad pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Alice Session · OpenAlice')
    expect(stripSgr(transcript)).toContain('▄▀▄ █   ▀█▀ ▄▀▀ █▀▀')
    expect(stripSgr(transcript)).toContain('OpenAlice is ready to start.')
    expect(stripSgr(transcript)).toContain('ALICEPROJECT')
    expect(stripSgr(transcript)).toContain('ATTENTION')
    expect(stripSgr(transcript)).toContain('RECENT')
    expect(stripSgr(transcript)).not.toContain('COMPONENT TELEMETRY')
    expect(transcript).toContain('\u001b[1;38;2;')
    expect(transcript).not.toMatch(
      /\u001b\[1;38;2;183;255;248;48;2;18;54;59m[^\u001b\r\n]*Uptime/u,
    )
    expect(transcript.replace(/\u001b\[[0-9;?<>]*[A-Za-z~]/gu, '')).toContain('│ › [ Enter ]')
    expect(transcript).toContain('FIXTURE_RESULT starts=1 opens=1')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('runs Doctor from the degraded Launchpad primary action', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-doctor-primary-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [doctorPrimaryFixtureEntry], {
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
      let invoked = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Doctor primary timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (
          !invoked
          && output.includes('[ Enter ]  Run Runtime Doctor')
        ) {
          invoked = true
          child.write('\r')
        } else if (invoked && output.includes('Fixture Runtime protocol mismatch')) {
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor Doctor primary exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('[ Enter ]  Run Runtime Doctor')
    expect(transcript).not.toContain('No primary action is available')
    expect(transcript).toContain('Fixture Runtime protocol mismatch')
    expect(transcript).toContain('FIXTURE_RESULT diagnoses=1')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('opens contextual Help and explores it with raw pointer input', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-navigation-pointer-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
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
      let clicked = false
      let inspected = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor navigation pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!clicked && output.includes('◆ [Home]')) {
          clicked = true
          child.write('?')
        } else if (!inspected && clicked && output.includes('Control atlas · 1/3 · Navigation')) {
          inspected = true
          child.write('\u001b[<35;10;7M')
          child.write('\u001b[<0;10;7M')
        } else if (inspected && output.includes('Control atlas · 2/3 · Runtime')) {
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor navigation pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Control atlas · 1/3 · Navigation')
    expect(transcript).toContain('Control atlas · 2/3 · Runtime')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('focuses a complete wide Help section from any command row', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-help-board-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 120,
      rows: 32,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_BOOT: '0',
        OPENALICE_TUI_MOTION: '0',
        OPENALICE_TUI_FIXTURE_RUNTIME: 'running',
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let hovered = false
      let selected = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Help Board pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        const plain = stripSgr(output)
        if (!opened && plain.includes('[ / ] Commands') && plain.includes('◆ OVERVIEW')) {
          opened = true
          child.write('?')
        } else if (!hovered && plain.includes('Control Atlas Board · 3 SYSTEMS')) {
          hovered = true
          child.write('\u001b[<35;70;16M')
        } else if (!selected && plain.includes('» ● RUNTIME  //  READ STATE, THEN ACT')) {
          selected = true
          child.write('\u001b[<0;70;16M')
        } else if (selected && plain.includes('› ● RUNTIME  //  READ STATE, THEN ACT')) {
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && selected) resolve(output)
        else reject(new Error(`Supervisor Help Board pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(stripSgr(transcript)).toContain('» ● RUNTIME  //  READ STATE, THEN ACT')
    expect(stripSgr(transcript)).toContain('› ● RUNTIME  //  READ STATE, THEN ACT')
    expect(stripSgr(transcript)).toContain('[ / ] Open the Command Dock')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it.each([
    ['default-no', 80, 24, 'sends=0 aborted=false'],
    ['success', 110, 30, 'sends=1 aborted=false'],
    ['auth-loss', 100, 30, 'sends=0 aborted=false'],
    ['occupied', 100, 30, 'sends=0 aborted=false'],
    ['checksum-retry', 100, 30, 'sends=2 aborted=false'],
    ['cancel-retry', 100, 30, 'sends=2 aborted=true'],
  ] as const)(
    'drives the remote transfer %s recovery path through a real PTY',
    async (scenario, cols, rows, expectedResult) => {
      const child = pty.spawn(process.execPath, [transferFixtureEntry], {
        cols,
        rows,
        cwd: dirname(cliEntry),
        env: {
          ...process.env,
          OPENALICE_TUI_TRANSFER_SCENARIO: scenario,
          TERM: 'xterm-256color',
        },
      })

      const transcript = await new Promise<string>((resolve, reject) => {
        let output = ''
        let stage = 0
        let openedFleet = false
        let movedToProjects = false
        const timeout = setTimeout(() => {
          child.kill()
          reject(new Error(`Supervisor transfer ${scenario} timed out at stage ${stage}:\n${output}`))
        }, 12_000)
        child.onData((data) => {
          output += data
          if (
            !openedFleet
            && output.includes('Start OpenAlice & open Workspace')
            && output.includes('◆ [Home]')
          ) {
            openedFleet = true
            child.write('\t\t')
          } else if (stage === 0 && !movedToProjects && output.includes('[ Enter ] Browse projects')) {
            movedToProjects = true
            child.write('\t')
          } else if (stage === 0 && output.includes('[ m ] Transfer')) {
            stage = 1
            child.write('m')
          } else if (stage === 1 && output.includes('destination Machine')) {
            stage = 2
            if (scenario === 'success') {
              child.write('\u001b[<35;50;7M')
              child.write('\u001b[<0;50;7M')
            } else {
              child.write('\r')
            }
          } else if (stage === 2 && output.includes('Destination AliceProject key')) {
            if (scenario === 'success') {
              stage = 22
              child.write('\u0005\u0015Bad Key')
              setTimeout(() => {
                child.write('\u001b[<35;10;29M')
                setTimeout(() => child.write('\u001b[<0;10;29M'), 300)
              }, 100)
            } else {
              stage = 3
              child.write('\r')
            }
          } else if (
            stage === 22
            && output.includes('! Destination AliceProject key · FIX')
          ) {
            stage = 3
            child.write('\u0005\u0015source')
            setTimeout(() => {
              child.write('\u001b[<35;10;29M')
              setTimeout(() => child.write('\u001b[<0;10;29M'), 300)
            }, 100)
          } else if (stage === 3 && output.includes('Destination complete Home')) {
            stage = 4
            child.write('\r')
          } else if (stage === 4 && output.includes('◆ Credentials')) {
            stage = 5
            child.write('\r')
          } else if (stage === 5 && output.includes('◆ Exact-Session scheduled Issue owners')) {
            stage = 6
            child.write('\r')
          } else if (stage === 6 && (scenario === 'auth-loss' || scenario === 'occupied')) {
            const expected = scenario === 'auth-loss'
              ? 'SSH authentication required after destination selection.'
              : 'Destination key or Home became occupied before planning.'
            if (output.includes(expected)) {
              stage = 20
              if (scenario === 'auth-loss') {
                child.write('\u001b[<35;90;2M')
                setTimeout(() => child.write('\u001b[<0;90;2M'), 300)
              } else {
                child.write('\r')
              }
            }
          } else if (stage === 6 && output.includes('◆ Transfer manifest · READY')) {
            stage = scenario === 'default-no' ? 10 : 7
            child.write(scenario === 'default-no' ? 'n' : 'y')
          } else if (stage === 7 && scenario === 'checksum-retry' && output.includes('Synthetic checksum mismatch')) {
            stage = 8
            child.write('\u001b[<35;50;10M')
            setTimeout(() => child.write('\u001b[<0;50;10M'), 300)
          } else if (stage === 7 && scenario === 'cancel-retry' && output.includes('◈ Transfer in flight · STREAMING')) {
            stage = 9
            child.write('\u001b')
          } else if (stage === 9 && output.includes('Synthetic transfer cancellation acknowledged.')) {
            stage = 8
            child.write('\u001b[<35;50;10M')
            setTimeout(() => child.write('\u001b[<0;50;10M'), 300)
          } else if ((stage === 7 || stage === 8) && output.includes('✓ AliceProject arrived · PUBLISHED')) {
            stage = 20
            child.write('\r')
          } else if (stage === 10 && output.includes('Transfer cancelled.')) {
            stage = 21
            child.write('q')
          } else if (stage === 20 && (
            output.includes('Transfer closed. Source remains unchanged.')
            || output.includes('Transferred cloud/source.')
          )) {
            stage = 21
            child.write('q')
          }
        })
        child.onExit(({ exitCode }) => {
          clearTimeout(timeout)
          if (exitCode === 0 && stage === 21) resolve(output)
          else reject(new Error(`Supervisor transfer ${scenario} exited ${exitCode} at stage ${stage}:\n${output}`))
        })
      })

      expect(transcript).toContain(`FIXTURE_RESULT scenario=${scenario} ${expectedResult}`)
      if (scenario === 'success') {
        expect(transcript).toContain('Flight Deck · 1/8 · DESTINATION')
        expect(transcript).toContain('Mission Brief · Source → Cloud fixture')
        expect(transcript).toContain('! Destination AliceProject key · FIX')
        expect(transcript).toContain('› [ Enter ] Continue')
      } else if (scenario === 'default-no') {
        expect(transcript).toContain('Transfer Flight Deck')
      }
      if (scenario !== 'default-no') {
        expect(transcript).toContain('◇ BUILD v0.91.0-beta.3 · DEV')
        expect(transcript).toContain('◆ FOCUS · TRANSFER')
        expect(transcript).toContain('TRANSFER FLIGHT DECK')
        expect(transcript).toContain('◆ TRANSFER')
        expect(transcript).toContain('◆ [ Enter ] Continue  │  [ ↑↓ ] Move choice  │  [ Esc ] Step back')
        expect(transcript).toContain('◆ FOCUS WORKSPACE  ›  [ Esc ] Back')
      }
      expect(transcript).toContain('◆ Destination AliceProject key')
      expect(transcript).toContain('◆ Credentials')
      expect(transcript).toContain('◆ [ Enter ] Choose')
      if (scenario !== 'auth-loss' && scenario !== 'occupied' && scenario !== 'default-no') {
        expect(transcript).toContain('◆ Transfer manifest · READY')
        expect(transcript).toContain('◈ Transfer in flight · STREAMING')
      }
      if (scenario === 'checksum-retry' || scenario === 'cancel-retry') {
        expect(transcript).toContain('Flight Deck · 7/8 · STREAM')
        expect(transcript).toContain('› [ r ] Retry')
      }
      if (scenario === 'auth-loss') {
        expect(transcript).toContain('SSH authentication required after destination selection.')
      } else if (scenario === 'occupied') {
        expect(transcript).toContain('Destination key or Home became occupied before planning.')
      } else {
        expect(transcript).toContain('Sessions  0 imported')
      }
      if (scenario === 'success' || scenario === 'checksum-retry' || scenario === 'cancel-retry') {
        expect(transcript).toContain('✓ AliceProject arrived · PUBLISHED')
        expect(transcript).toContain('◆ [ s ] Start')
      }
      expect(transcript).toContain('\u001b[?25h')
      expect(transcript).toContain('\u001b[?2004l')
    },
    15_000,
  )

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
        if (!openedHelp && output.includes('[ / ] Commands') && output.includes('[ q ] Detach')) {
          openedHelp = true
          child.write('?')
        } else if (!detached && output.includes('Control atlas · 1/3 · Navigation')) {
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

    expect(transcript).toContain('OpenAlice Supervisor')
    expect(transcript).toContain(`v${cliVersion} · DEV`)
    expect(transcript).toContain('○ STOPPED')
    expect(transcript).toContain('Control atlas · 1/3 · Navigation')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  })

  it('uses raw pointer input inside the centered Setup overlay', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-overlay-pointer-'))
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
      let setupOpened = false
      let clickedScope = false
      let closed = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor overlay pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!setupOpened && output.includes('[ / ] Commands') && output.includes('[ q ] Detach')) {
          setupOpened = true
          child.write('p')
        } else if (!clickedScope && output.includes('Setup Studio · Default AliceProject') && output.includes('Editing')) {
          clickedScope = true
          child.write('\u001b[<32;10;3M')
          child.write('\u001b[<0;10;3M')
        } else if (!closed && output.includes('› Editing') && output.includes('Current · Machine defaults')) {
          closed = true
          child.write('\u001b')
          setTimeout(() => child.write('q'), 50)
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && closed) resolve(output)
        else reject(new Error(`Supervisor overlay pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Current · Machine defaults')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('clicks the wide Setup Studio Inspector action outside its keycap', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-setup-studio-action-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 110,
      rows: 30,
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
      let opened = false
      let hovered = false
      let clicked = false
      let closed = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Setup Studio action timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('Alice Session · OpenAlice')) {
          opened = true
          child.write('p')
        } else if (!hovered && output.includes('Setup Studio · Default AliceProject') && output.includes('Cycle value')) {
          hovered = true
          child.write('\u001b[<35;75;9M')
        } else if (!clicked && output.includes('› [ Enter ] Cycle value')) {
          clicked = true
          child.write('\u001b[<0;75;9M')
        } else if (!closed && clicked && output.includes('Current · Machine defaults')) {
          closed = true
          child.write('\u001b')
          setTimeout(() => child.write('q'), 50)
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && closed) resolve(output)
        else reject(new Error(`Supervisor Setup Studio action exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('› [ Enter ] Cycle value')
    expect(transcript).toContain('Current · Machine defaults')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('gives a focused confirmation modal an isolated Decision Gate', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-confirmation-modal-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [confirmationFixtureEntry], {
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
      let requested = false
      let hoveredCancel = false
      let clickedCancel = false
      let cancelled = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor confirmation modal timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!requested && output.includes('[ / ] Commands') && output.includes('○ COLD')) {
          requested = true
          child.write('m')
        } else if (!hoveredCancel && output.includes('Confirm Managed Source') && output.includes('◆ [ Enter ] Prepare source')) {
          hoveredCancel = true
          child.write('\u001b[<35;40;23M')
        } else if (!clickedCancel && output.includes('│ › [ Esc ] Not now')) {
          clickedCancel = true
          child.write('\u001b[<0;40;23M')
        } else if (!cancelled && output.includes('STATUS   Action cancelled.')) {
          cancelled = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && cancelled) resolve(output)
        else reject(new Error(`Supervisor confirmation modal exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Confirm Managed Source')
    expect(transcript).toContain('◆  CONFIRMATION REQUIRED')
    expect(transcript).toContain('IMPACT')
    expect(transcript).toContain('[ Enter ] Prepare source')
    expect(transcript).toContain('[ Esc ] Not now')
    expect(transcript).toContain('│ › [ Esc ] Not now')
    expect(transcript).toContain('◆ FOCUS · PREPARE SOURCE')
    expect(transcript).toContain('DECISION GATE')
    expect(transcript).toContain('[ Esc ] Not now')
    expect(transcript).toContain('◇ BUILD')
    expect(transcript).toContain('◆ [ Enter ] Prepare source')
    expect(transcript).toContain('[ Esc ] Not now')
    expect(transcript).toContain('STATUS   Action cancelled.')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('cancels a Decision Gate from its action-specific Mission Header', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-confirmation-header-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [confirmationFixtureEntry], {
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
      let requested = false
      let hovered = false
      let clicked = false
      let cancelled = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor confirmation Header timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!requested && output.includes('[ / ] Commands') && output.includes('○ COLD')) {
          requested = true
          child.write('m')
        } else if (!hovered && output.includes('◆ FOCUS · PREPARE SOURCE') && output.includes('[ Esc ] Not now')) {
          hovered = true
          child.write('\u001b[<35;70;2M')
        } else if (!clicked && output.includes('› [ Esc ] Not now')) {
          clicked = true
          child.write('\u001b[<0;70;2M')
        } else if (!cancelled && output.includes('STATUS   Action cancelled.')) {
          cancelled = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && cancelled) resolve(output)
        else reject(new Error(`Supervisor confirmation Header exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('◆ FOCUS · PREPARE SOURCE')
    expect(transcript).toContain('DECISION GATE')
    expect(transcript).toContain('› [ Esc ] Not now')
    expect(transcript).toContain('STATUS   Action cancelled.')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('opens Setup by clicking a bottom Command Dock result', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-command-dock-'))
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
      let opened = false
      let typedUnicode = false
      let typedSearch = false
      let clickedSetup = false
      let setupOpened = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Command Dock timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('[ / ] Commands') && output.includes('○ COLD')) {
          opened = true
          child.write('/')
        } else if (!typedSearch && output.includes('Command Dock') && output.includes('› ◆ Start OpenAlice')) {
          if (!typedUnicode) {
            typedUnicode = true
            child.write('日志')
            return
          }
          if (!output.includes('MATCH “日志”') || !output.includes('⌕  日志')) return
          typedSearch = true
          child.write('\x15')
          setTimeout(() => child.write('setup'), 50)
        } else if (
          !clickedSetup
          && output.includes('MATCH “setup”')
          && output.includes('⌕  setup▌')
          && output.includes('›   Setup')
        ) {
          clickedSetup = true
          child.write('\u001b[<32;32;19M')
          child.write('\u001b[<0;32;19M')
        } else if (!setupOpened && output.includes('Setup Studio · Default AliceProject')) {
          setupOpened = true
          child.write('\u001b')
          setTimeout(() => child.write('q'), 50)
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && setupOpened) resolve(output)
        else reject(new Error(`Supervisor Command Dock exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Command Dock')
    expect(transcript).toContain('MATCH “日志”')
    expect(transcript).toContain('⌕  日志')
    expect(transcript).toContain('MATCH “setup”')
    expect(transcript).toContain('⌕  setup▌')
    expect(transcript).toContain('Alice Session · OpenAlice')
    expect(transcript).toContain('Setup Studio · Default AliceProject')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('keeps every visible Command Spine control segment clickable', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-context-ribbon-'))
    temporaryPaths.push(isolatedHome)
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: isolatedHome,
      OPENALICE_HOME: join(isolatedHome, 'state'),
      TERM: 'xterm-256color',
    }
    delete childEnv.NO_COLOR
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: childEnv,
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let clickedProject = false
      let closedOverlay = false
      let clickedAfterNotice = false
      let openedPalette = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Command Spine timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (
          !clickedProject
          && output.includes('[ i ] Default AliceProject')
          && output.includes('○ COLD')
        ) {
          clickedProject = true
          child.write('\u001b[<32;56;24M')
          child.write('\u001b[<0;56;24M')
        } else if (!closedOverlay && output.includes('AliceProject Switchboard · 1 PROJECT')) {
          closedOverlay = true
          child.write('\u001b')
        } else if (
          closedOverlay
          && !clickedAfterNotice
          && output.includes('STATUS   AliceProject selection')
        ) {
          clickedAfterNotice = true
          child.write('\u001b[<0;6;24M')
        } else if (!openedPalette && output.includes('Command Dock')) {
          openedPalette = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && openedPalette) resolve(output)
        else reject(new Error(`Supervisor Command Spine exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('AliceProject Switchboard · 1 PROJECT')
    expect(transcript).toContain('STATUS   AliceProject selection')
    expect(transcript).toContain('Command Dock')
    expect(transcript).toContain('╰─ ')
    expect(transcript).toContain('  ›  ')
    expect(transcript).toContain(' ─╯')
    expect(transcript).toContain('\u001b[38;2;199;235;239;48;2;10;34;39m')
    expect(transcript).toContain('\u001b[1;38;2;240;249;255;48;2;10;34;39m[ i ] Default AliceProject')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('keeps the 46-column Command Spine continuously closed around the Command Dock', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-narrow-command-spine-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 46,
      rows: 30,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        TERM: 'xterm-256color',
        OPENALICE_TUI_MOTION: '0',
      },
    })

    const closedSpine = '╰─ [ / ] Commands  ›  [ q ] Detach ──────────╯'
    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let closingAt = -1
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Narrow Supervisor Command Spine timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes(closedSpine)) {
          opened = true
          child.write('\u001b[<0;6;30M')
        } else if (opened && closingAt < 0 && output.includes('Command Dock · 1/10 · ABSENT')) {
          closingAt = output.length
          child.write('\u001b[<35;6;30M')
          child.write('\u001b[<0;6;30M')
          child.write('\u001b[<35;1;4M')
        } else if (closingAt >= 0 && output.slice(closingAt).includes(closedSpine)) {
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && closingAt >= 0) resolve(output)
        else reject(new Error(`Narrow Supervisor Command Spine exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain(closedSpine)
    expect(transcript).not.toContain('[ q ] Detach ───────  ─╯')
    expect(transcript).toContain('Command Dock · 1/10 · ABSENT')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
    expect(transcript).toContain('\u001b[?1006l')
  }, 12_000)

  it('renders an offline registered Machine and preserves drill-down across resize', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-fleet-offline-'))
    temporaryPaths.push(isolatedHome)
    const supervisorHome = join(isolatedHome, 'supervisor')
    await mkdir(supervisorHome, { recursive: true })
    await writeFile(join(supervisorHome, 'machines.json'), `${JSON.stringify({
      schemaVersion: 1,
      machines: {
        cloud: {
          displayName: 'Cloud fixture',
          sshTarget: '127.0.0.1',
          sshPort: 1,
        },
      },
    })}\n`)
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 100,
      rows: 28,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_SUPERVISOR_HOME: supervisorHome,
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let openedFleet = false
      let selectedRemote = false
      let drilledDown = false
      let returned = false
      let returnOffset = 0
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor offline fleet timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!openedFleet && output.includes('[Home]') && output.includes('Connections')) {
          openedFleet = true
          child.write('\t\t')
        } else if (!selectedRemote && output.includes('Cloud fixture') && output.includes('offline')) {
          selectedRemote = true
          child.resize(48, 24)
          setTimeout(() => child.write('\u001b[B\u001b[C'), 120)
        } else if (!drilledDown && output.includes('AliceProjects · Cloud fixture')) {
          drilledDown = true
          returnOffset = output.length
          setTimeout(() => child.write('\u001b[D'), 120)
        } else if (
          drilledDown
          && !returned
          && output.slice(returnOffset).includes('Machines · ')
          && output.slice(returnOffset).includes('▶ Cloud fixture')
        ) {
          returned = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor offline fleet exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Cloud fixture')
    expect(transcript).toContain('offline')
    expect(transcript).toContain('AliceProjects · Cloud fixture')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  })

  it('reveals and clicks a sixth Fleet row before showing a scroll rail', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-fleet-viewport-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 120,
      rows: 32,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_FIXTURE_FLEET_ROWS: '6',
        OPENALICE_TUI_MOTION: '0',
        TERM: 'xterm-256color',
      },
    })

    let expandedFleet = ''
    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let openedFleet = false
      let hoveredSixth = false
      let clickedSixth = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor expanded Fleet timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!openedFleet && output.includes('[Home]')) {
          openedFleet = true
          child.write(']]')
        } else if (!hoveredSixth && output.includes('Local Project 6')) {
          hoveredSixth = true
          expandedFleet = output.slice(output.lastIndexOf('Machines · 1/1'))
          child.write('\u001b[<35;70;11M')
        } else if (!clickedSixth && output.includes('» Local Project 6')) {
          clickedSixth = true
          child.write('\u001b[<0;70;11M')
        } else if (clickedSixth && output.includes('AliceProjects · This computer · 6/6')) {
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && clickedSixth) resolve(output)
        else reject(new Error(`Supervisor expanded Fleet exited ${exitCode}:\n${output}`))
      })
    })

    expect(stripSgr(expandedFleet)).toContain('Local Project 6')
    expect(stripSgr(expandedFleet)).not.toContain('█')
    expect(transcript).toContain('» Local Project 6')
    expect(transcript).toContain('▶ Local Project 6')
    expect(transcript).toContain('AliceProjects · This computer · 6/6')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('keeps the wide Fleet Selection Constellation pointer-passive', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-fleet-constellation-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 120,
      rows: 32,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_BOOT: '0',
        OPENALICE_TUI_MOTION: '0',
        OPENALICE_TUI_FIXTURE_RUNTIME: 'running',
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let clicked = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Fleet Constellation timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        const plain = stripSgr(output)
        if (!opened && plain.includes('◆ OVERVIEW')) {
          opened = true
          child.write(']]')
        } else if (!clicked && plain.includes('Selection Constellation · AliceProject')) {
          clicked = true
          child.write('\u001b[<35;70;18M')
          child.write('\u001b[<0;70;18M')
          setTimeout(() => child.write('q'), 150)
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && clicked) resolve(output)
        else reject(new Error(`Supervisor Fleet Constellation exited ${exitCode}:\n${output}`))
      })
    })

    expect(stripSgr(transcript)).toContain('◇ CONTROL ROUTE')
    expect(stripSgr(transcript)).toContain('Runtime is live; AliceProject home is missing')
    expect(stripSgr(transcript)).toContain('Web route.')
    expect(stripSgr(transcript)).toContain('◆ running · home missing')
    expect(stripSgr(transcript)).toContain('◆ LIVE · HOME MISSING')
    expect(stripSgr(transcript)).not.toContain('◇ missing')
    expect(stripSgr(transcript)).toContain('↗ WEB  http://127.0.0.1:47331')
    expect(stripSgr(transcript)).toContain('CAPS     inspect · lifecycle · tunnel')
    expect(transcript).toContain('FIXTURE_RESULT starts=0 opens=0 loads=0 diagnoses=0')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

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
        if (!detached && output.includes('Research') && output.includes('Alice Session · OpenAlice')) {
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

    expect(transcript).toContain('Research')
    expect(transcript).not.toContain(instanceHome)
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  })

  it('opens an in-TUI source prompt when startup has no checkout', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-source-prompt-'))
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
        if (!requestedStart && output.includes('Start OpenAlice & open Workspace')) {
          requestedStart = true
          child.write('s')
        } else if (!submittedInvalidPath && output.includes('Source route · SELECT CHECKOUT')) {
          submittedInvalidPath = true
          child.write('\u0005\u0015/definitely/not/openalice')
          setTimeout(() => {
            child.write('\u001b[<35;63;10M')
            setTimeout(() => child.write('\u001b[<0;63;10M'), 100)
          }, 100)
        } else if (!cancelledPrompt && output.includes('Could not use that checkout')) {
          cancelledPrompt = true
          child.write('\u001b')
        } else if (!detached && output.includes('Source configuration')) {
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

    expect(transcript).toContain('Source route · SELECT CHECKOUT')
    expect(transcript).toContain('Runtime Source · AliceProject setting')
    expect(transcript).toContain('› [ Enter ] Save & start')
    expect(transcript).toContain('Source route · REJECTED')
    expect(transcript).toContain('Could not use that checkout')
    expect(transcript).toContain('Source configuration')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  })

  it('keeps the complete Source Launch Bay route at the 80-column baseline', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-source-narrow-'))
    temporaryPaths.push(isolatedHome)
    const childEnv = { ...process.env }
    delete childEnv.OPENALICE_HOME
    delete childEnv.OPENALICE_INSTANCE
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...childEnv,
        HOME: isolatedHome,
        OPENALICE_SUPERVISOR_HOME: join(isolatedHome, 'supervisor'),
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let closed = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor narrow Source Launch Bay timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('Start OpenAlice & open Workspace')) {
          opened = true
          child.write('c')
        } else if (!closed && output.includes('Source Launch Bay · SELECT CHECKOUT')) {
          closed = true
          child.write('\u001b')
        } else if (!detached && output.includes('Source configuration')) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor narrow Source Launch Bay exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Source Launch Bay · SELECT CHECKOUT')
    expect(transcript).toContain('◆ Select  → Validate  → Save  → Launch')
    expect(transcript).toContain('Runtime Source · AliceProject setting')
    expect(transcript).toContain('◆ CONTRACT')
    expect(transcript).toContain('Source configuration')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  })

  it('uses installed provenance to offer managed Runtime setup from Enter', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-installed-enter-'))
    temporaryPaths.push(isolatedHome)
    const installRoot = join(isolatedHome, 'install')
    const releaseRoot = join(
      installRoot,
      'cli-versions',
      'dev-fixture-1234567890abcdef',
    )
    await mkdir(releaseRoot, { recursive: true })
    await Promise.all([
      cp(join(cliPackageRoot, 'bin'), join(releaseRoot, 'bin'), { recursive: true }),
      cp(join(cliPackageRoot, 'src'), join(releaseRoot, 'src'), { recursive: true }),
      cp(join(cliPackageRoot, 'package.json'), join(releaseRoot, 'package.json')),
      symlink(join(cliPackageRoot, 'node_modules'), join(releaseRoot, 'node_modules')),
      writeFile(join(releaseRoot, 'install-source.json'), JSON.stringify({
        schemaVersion: 1,
        repository: 'TraderAlice/OpenAlice',
        cliVersion,
        selector: { kind: 'branch', value: 'dev' },
        installerUrl: 'https://openalice.ai/install',
      })),
    ])
    const installedEntry = join(releaseRoot, 'bin', 'openalice.ts')
    const unrelatedCwd = join(isolatedHome, 'empty')
    await mkdir(unrelatedCwd)
    const child = pty.spawn(process.execPath, [installedEntry], {
      cols: 100,
      rows: 28,
      cwd: unrelatedCwd,
      env: {
        ...process.env,
        HOME: join(isolatedHome, 'home'),
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_SUPERVISOR_HOME: join(isolatedHome, 'supervisor'),
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let requestedStart = false
      let cancelledPlan = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Installed Supervisor first start timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!requestedStart && output.includes('Start OpenAlice & open Workspace')) {
          requestedStart = true
          child.write('\r')
        } else if (
          !cancelledPlan
          && output.includes('installer-managed OpenAlice source branch dev')
        ) {
          cancelledPlan = true
          child.write('n')
        } else if (!detached && output.includes('Action cancelled.')) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Installed Supervisor first start exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('OpenAlice Supervisor')
    expect(transcript).toContain(`v${cliVersion} · DEV`)
    expect(transcript).toContain('installer-managed OpenAlice source branch dev')
    expect(transcript).not.toContain('Runtime Source · AliceProject setting')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  })

  it('edits and persists selected-AliceProject settings inside the TUI', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-settings-'))
    temporaryPaths.push(isolatedHome)
    const supervisorHome = join(isolatedHome, 'supervisor')
    const childEnv = { ...process.env }
    delete childEnv.OPENALICE_HOME
    delete childEnv.OPENALICE_INSTANCE
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 110,
      rows: 30,
      cwd: dirname(cliEntry),
      env: {
        ...childEnv,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_SUPERVISOR_HOME: supervisorHome,
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let openedSettings = false
      let selectedPort = false
      let submittedInvalidPort = false
      let submittedPort = false
      let closedSettings = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor settings TUI timed out:\n${output}`))
      }, 10_000)
      child.onData((data) => {
        output += data
        if (!openedSettings && output.includes('Alice Session · OpenAlice')) {
          openedSettings = true
          child.write('p')
        } else if (!selectedPort && output.includes('Setup Studio · Default AliceProject')) {
          selectedPort = true
          child.write('\u001b[B\u001b[B\r')
        } else if (!submittedInvalidPort && output.includes('Set AliceProject browser port')) {
          submittedInvalidPort = true
          child.write('99999')
          setTimeout(() => {
            child.write('\u001b[<35;65;10M')
            setTimeout(() => child.write('\u001b[<0;65;10M'), 300)
          }, 100)
        } else if (
          !submittedPort
          && output.includes('Layer Context · PROJECT · FIX')
          && output.includes('Browser port must be a whole number')
        ) {
          submittedPort = true
          child.write('\u0005\u001549001')
          setTimeout(() => {
            child.write('\u001b[<35;65;10M')
            setTimeout(() => child.write('\u001b[<0;65;10M'), 300)
          }, 100)
        } else if (
          !closedSettings
          && output.includes('Saved browser port for AliceProject "Default AliceProject".')
        ) {
          closedSettings = true
          child.write('\u001b')
        } else if (
          !detached
          && output.includes('STATUS   Setup closed.')
        ) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor settings TUI exited ${exitCode}:\n${output}`))
      })
    })

    const config = JSON.parse(
      await readFile(join(supervisorHome, 'config.json'), 'utf8'),
    )
    expect(config.projects.default.port).toBe(49_001)
    expect(transcript).toContain('Setup Studio · Default AliceProject')
    expect(transcript).toContain('Layer Context · PROJECT · EDIT')
    expect(transcript).toContain('Set AliceProject browser port')
    expect(transcript).toContain('› [ Enter ] Validate & save')
    expect(transcript).toContain('Layer Context · PROJECT · FIX')
    expect(transcript).toContain('Browser port must be a whole number')
    expect(transcript).toContain('Saved browser port for AliceProject "Default AliceProject".')
    expect(transcript).toContain('STATUS   Setup closed.')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 15_000)

  it('switches setup scope and persists machine defaults inside the TUI', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-machine-settings-'))
    temporaryPaths.push(isolatedHome)
    const supervisorHome = join(isolatedHome, 'supervisor')
    const childEnv = { ...process.env }
    delete childEnv.OPENALICE_HOME
    delete childEnv.OPENALICE_INSTANCE
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...childEnv,
        HOME: isolatedHome,
        OPENALICE_SUPERVISOR_HOME: supervisorHome,
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let openedSetup = false
      let selectedMachineScope = false
      let selectedPort = false
      let submittedPort = false
      let closedSetup = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor machine settings timed out:\n${output}`))
      }, 10_000)
      child.onData((data) => {
        output += data
        if (!openedSetup && output.includes('Alice Session · OpenAlice')) {
          openedSetup = true
          child.write('p')
        } else if (
          !selectedMachineScope
          && output.includes('Editing')
          && output.includes('This AliceProject')
        ) {
          selectedMachineScope = true
          child.write('\r')
        } else if (
          !selectedPort
          && output.includes('Editing machine defaults.')
        ) {
          selectedPort = true
          child.write('\u001b[B\u001b[B\r')
        } else if (
          !submittedPort
          && output.includes('Set machine-default browser port')
        ) {
          submittedPort = true
          child.write('49002\r')
        } else if (
          !closedSetup
          && output.includes('Saved browser port for machine default.')
        ) {
          closedSetup = true
          child.write('\u001b')
        } else if (
          !detached
          && output.includes('STATUS   Setup closed.')
        ) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor machine settings exited ${exitCode}:\n${output}`))
      })
    })

    const config = JSON.parse(
      await readFile(join(supervisorHome, 'config.json'), 'utf8'),
    )
    expect(config.defaults.port).toBe(49_002)
    expect(transcript).toContain('Editing machine defaults.')
    expect(transcript).toContain('Setup Workbench · MACHINE · EDIT')
    expect(transcript).toContain('◆ Edit  → Validate  → Save')
    expect(transcript).toContain('Set machine-default browser port')
    expect(transcript).toContain('Saved browser port for machine default.')
    expect(transcript).toContain('STATUS   Setup closed.')
  }, 15_000)

  it('creates, selects, remembers, and switches named AliceProjects inside the TUI', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-instances-'))
    temporaryPaths.push(isolatedHome)
    const supervisorHome = join(isolatedHome, 'supervisor')
    const childEnv = { ...process.env }
    delete childEnv.OPENALICE_HOME
    delete childEnv.OPENALICE_INSTANCE
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 110,
      rows: 32,
      cwd: dirname(cliEntry),
      env: {
        ...childEnv,
        HOME: isolatedHome,
        OPENALICE_SUPERVISOR_HOME: supervisorHome,
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let openedProjects = false
      let requestedCreate = false
      let submittedName = false
      let acceptedHome = false
      let reopenedProjects = false
      let focusedDefault = false
      let defaultFocusOffset = 0
      let selectedDefault = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor AliceProjects TUI timed out:\n${output}`))
      }, 12_000)
      child.onData((data) => {
        output += data
        if (!openedProjects && output.includes('Start OpenAlice & open Workspace')) {
          openedProjects = true
          child.write('i')
        } else if (!requestedCreate && output.includes('+ Create AliceProject')) {
          requestedCreate = true
          child.write('\u001b[B\r')
        } else if (
          !submittedName
          && output.includes('AliceProject key')
        ) {
          submittedName = true
          child.write('research')
          setTimeout(() => {
            child.write('\u001b[<35;60;10M')
            setTimeout(() => child.write('\u001b[<0;60;10M'), 100)
          }, 100)
        } else if (
          !acceptedHome
          && output.includes('Create AliceProject · research')
          && output.includes('Complete home')
        ) {
          acceptedHome = true
          child.write('\u001b[<35;64;10M')
          setTimeout(() => child.write('\u001b[<0;64;10M'), 100)
        } else if (
          !reopenedProjects
          && output.includes('Created and selected AliceProject Research')
          && output.includes('Research')
        ) {
          reopenedProjects = true
          child.write('i')
        } else if (
          reopenedProjects
          && !focusedDefault
          && !selectedDefault
          && output.includes('Research')
          && output.includes('CURRENT·DEFAULT')
        ) {
          focusedDefault = true
          defaultFocusOffset = output.length
          setTimeout(() => child.write('\u001b[A'), 50)
        } else if (
          focusedDefault
          && !selectedDefault
          && output.slice(defaultFocusOffset).includes('◆ Default AliceProject · 1/3')
        ) {
          selectedDefault = true
          child.write('\r')
        } else if (
          !detached
          && output.includes('Selected AliceProject Default AliceProject')
          && output.includes('Default AliceProject')
        ) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor AliceProjects TUI exited ${exitCode}:\n${output}`))
      })
    })

    const config = JSON.parse(
      await readFile(join(supervisorHome, 'config.json'), 'utf8'),
    )
    expect(config.defaultProject).toBeUndefined()
    expect(config.projects.research).toEqual({
      name: 'research',
      home: await realpath(join(isolatedHome, '.openalice-research')),
    })
    expect(transcript).toContain('AliceProject Switchboard · 1 PROJECT')
    expect(transcript).toContain('› [ Enter ] Continue')
    expect(transcript).toContain('› [ Enter ] Create & select')
    expect(transcript).toContain('Created and selected AliceProject Research')
    expect(transcript).toContain('Selected AliceProject Default AliceProject')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 15_000)

  it('keeps the Foundry identity step complete at the 80-column baseline', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-foundry-narrow-'))
    temporaryPaths.push(isolatedHome)
    const childEnv = { ...process.env }
    delete childEnv.OPENALICE_HOME
    delete childEnv.OPENALICE_INSTANCE
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...childEnv,
        HOME: isolatedHome,
        OPENALICE_SUPERVISOR_HOME: join(isolatedHome, 'supervisor'),
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let requestedCreate = false
      let foundry = false
      let returned = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor narrow Foundry timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('Start OpenAlice & open Workspace')) {
          opened = true
          child.write('i')
        } else if (!requestedCreate && output.includes('+ Create AliceProject')) {
          requestedCreate = true
          child.write('\u001b[B\r')
        } else if (!foundry && output.includes('AliceProject Foundry · 1/2 · IDENTITY')) {
          foundry = true
          child.write('\u001b')
        } else if (foundry && !returned && data.includes('AliceProject Switchboard')) {
          returned = true
          child.write('\u001b')
        } else if (returned && output.includes('AliceProject selection')) {
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor narrow Foundry exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('AliceProject Foundry · 1/2 · IDENTITY')
    expect(transcript).toContain('◆ Identity  → Complete Home')
    expect(transcript).toContain('Create AliceProject · Project key')
    expect(transcript).toContain('◆ CONTRACT')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('selects a wide Switchboard row and clicks its Inspector action outside the keycap', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-switchboard-action-'))
    temporaryPaths.push(isolatedHome)
    const supervisorHome = join(isolatedHome, 'supervisor')
    const researchHome = join(isolatedHome, 'research-home')
    await mkdir(supervisorHome, { recursive: true })
    await mkdir(researchHome, { recursive: true })
    await writeFile(join(supervisorHome, 'config.json'), `${JSON.stringify({
      schemaVersion: 2,
      projects: {
        research: {
          name: 'research',
          home: researchHome,
        },
      },
    }, null, 2)}\n`)
    const childEnv = { ...process.env }
    delete childEnv.OPENALICE_HOME
    delete childEnv.OPENALICE_INSTANCE
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 110,
      rows: 30,
      cwd: dirname(cliEntry),
      env: {
        ...childEnv,
        HOME: isolatedHome,
        OPENALICE_SUPERVISOR_HOME: supervisorHome,
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let rowHovered = false
      let actionHovered = false
      let actionClicked = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Switchboard action timed out:\n${output}`))
      }, 10_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('[ i ] Default AliceProject')) {
          opened = true
          child.write('i')
        } else if (
          !rowHovered
          && output.includes('AliceProject Switchboard · 2 PROJECTS')
          && output.includes('Research')
        ) {
          rowHovered = true
          child.write('\u001b[<35;20;6M')
        } else if (
          !actionHovered
          && output.includes('› Research')
          && output.includes('Inspector · 2/3')
        ) {
          actionHovered = true
          child.write('\u001b[<35;75;10M')
        } else if (!actionClicked && output.includes('› [ Enter ] Select')) {
          actionClicked = true
          child.write('\u001b[<0;75;10M')
        } else if (
          !detached
          && output.includes('Selected AliceProject Research')
        ) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && detached) resolve(output)
        else reject(new Error(`Supervisor Switchboard action exited ${exitCode}:\n${output}`))
      })
    })

    const config = JSON.parse(await readFile(join(supervisorHome, 'config.json'), 'utf8'))
    expect(config.defaultProject).toBe('research')
    expect(transcript).toContain('› Research')
    expect(transcript).toContain('› [ Enter ] Select')
    expect(transcript).toContain('Selected AliceProject Research')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 15_000)

  it('keeps the Switchboard Inspector and status complete in an 80x20 terminal', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-switchboard-short-'))
    temporaryPaths.push(isolatedHome)
    const childEnv = { ...process.env }
    delete childEnv.OPENALICE_HOME
    delete childEnv.OPENALICE_INSTANCE
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 80,
      rows: 20,
      cwd: dirname(cliEntry),
      env: {
        ...childEnv,
        HOME: isolatedHome,
        OPENALICE_SUPERVISOR_HOME: join(isolatedHome, 'supervisor'),
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let closed = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Short Supervisor Switchboard timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('[ i ] Default AliceProject')) {
          opened = true
          child.write('i')
        } else if (
          !closed
          && output.includes('Inspector · 1/2 · SELECT & CREATE')
          && output.includes('Switchboard status · Default AliceProject')
          && output.includes('Copy AI credentials with openalice project copy-ai-creds.')
        ) {
          closed = true
          child.write('\u001b')
          setTimeout(() => child.write('q'), 40)
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && closed) resolve(output)
        else reject(new Error(`Short Supervisor Switchboard exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('AliceProject Switchboard · 1 PROJECT')
    expect(transcript).toContain('Inspector · 1/2 · SELECT & CREATE')
    expect(transcript).toContain('Switchboard status · Default AliceProject')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('recovers in the AliceProject picker when the remembered complete home is missing', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-instance-recovery-'))
    temporaryPaths.push(isolatedHome)
    const supervisorHome = join(isolatedHome, 'supervisor')
    await mkdir(supervisorHome, { recursive: true })
    await writeFile(join(supervisorHome, 'config.json'), `${JSON.stringify({
      schemaVersion: 1,
      defaultInstance: 'missing',
      instances: {
        missing: {
          name: 'missing',
          home: join(isolatedHome, 'disconnected-home'),
        },
      },
    }, null, 2)}\n`)
    const childEnv = { ...process.env }
    delete childEnv.OPENALICE_HOME
    delete childEnv.OPENALICE_INSTANCE
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 120,
      rows: 32,
      cwd: dirname(cliEntry),
      env: {
        ...childEnv,
        HOME: isolatedHome,
        OPENALICE_SUPERVISOR_HOME: supervisorHome,
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let openedProjects = false
      let repairedDefault = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor AliceProject recovery timed out:\n${output}`))
      }, 10_000)
      child.onData((data) => {
        output += data
        if (
          !openedProjects
          && output.includes('Using "default"; press i Alice')
          && output.includes('Default AliceProject')
        ) {
          openedProjects = true
          child.write('i')
        } else if (
          openedProjects
          && !repairedDefault
          && output.includes('AliceProject Switchboard')
          && output.includes('Default AliceProject')
          && output.includes('CURRENT')
          && output.includes('+ Create AliceProject')
        ) {
          repairedDefault = true
          child.write('\r')
        } else if (
          !detached
          && output.includes('Selected AliceProject Default AliceProject')
        ) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor AliceProject recovery exited ${exitCode}:\n${output}`))
      })
    })

    const config = JSON.parse(
      await readFile(join(supervisorHome, 'config.json'), 'utf8'),
    )
    expect(config.defaultProject).toBeUndefined()
    expect(config.projects.missing.home).toBe(join(isolatedHome, 'disconnected-home'))
    expect(transcript).toContain('AliceProject "missing" is missing.')
    expect(transcript).toContain('Using "default"; press i Alice')
    expect(transcript).toContain('+ Create AliceProject')
    expect(transcript).toContain('Selected AliceProject Default AliceProject')
  }, 15_000)

  it('shows higher-priority CLI overrides as locked settings', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-settings-lock-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [
      cliEntry,
      '--port', '44000',
    ], {
      cols: 110,
      rows: 30,
      cwd: dirname(cliEntry),
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
      let openedSettings = false
      let selectedPort = false
      let testedLockedPort = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor locked-settings TUI timed out:\n${output}`))
      }, 10_000)
      child.onData((data) => {
        output += data
        if (!openedSettings && output.includes('Alice Session · OpenAlice')) {
          openedSettings = true
          child.write('p')
        } else if (!selectedPort && output.includes('Setup Studio · Default AliceProject')) {
          selectedPort = true
          child.write('\u001b[B\u001b[B')
        } else if (
          !testedLockedPort
          && output.includes('Current · 44000 · locked')
          && output.includes('Locked by --port.')
        ) {
          testedLockedPort = true
          child.write('\r')
          setTimeout(() => child.write('\u001b'), 50)
        } else if (!detached && output.includes('Setup closed.')) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor locked-settings TUI exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('44000 · locked')
    expect(transcript).toContain('Locked by --port.')
    expect(transcript).not.toContain('Set browser port')
  })

  it('shows CLI-selected AliceProjects as read-only instead of pretending to switch them', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-instance-lock-'))
    temporaryPaths.push(isolatedHome)
    const instanceHome = join(isolatedHome, 'research-home')
    const child = pty.spawn(process.execPath, [
      cliEntry,
      '--instance', 'research',
      '--home', instanceHome,
    ], {
      cols: 110,
      rows: 30,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_SUPERVISOR_HOME: join(isolatedHome, 'supervisor'),
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let openedInstances = false
      let closedInstances = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor instance-lock TUI timed out:\n${output}`))
      }, 10_000)
      child.onData((data) => {
        output += data
        if (!openedInstances && output.includes('Start OpenAlice & open Workspace')) {
          openedInstances = true
          child.write('i')
          setTimeout(() => {
            closedInstances = true
            child.write('\u001b')
            setTimeout(() => {
              detached = true
              child.write('q')
            }, 200)
          }, 300)
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor instance-lock TUI exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Locked by --instance.')
    expect(transcript).toContain('Research')
    expect(transcript).toContain('CURRENT')
    expect(transcript).toContain('READ ONLY')
    expect(transcript).not.toContain('+ Create AliceProject')
  }, 15_000)

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
      let openedOverview = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor managed-source TUI timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!openedOverview && output.includes('Start OpenAlice & open Workspace')) {
          openedOverview = true
          child.write('m')
        } else if (!detached && output.includes('Managed source is unavailable')) {
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
      'Managed source is unavailable',
    )
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)
})
