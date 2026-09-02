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
import { afterEach, describe, expect, it } from 'vitest'

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

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )))
})

describe.skipIf(process.platform === 'win32')('Supervisor TUI PTY', () => {
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
        if (!opened && output.includes('◆ [Overview]')) {
          opened = true
          child.write('u')
        } else if (!laneHovered && output.includes('Release Observatory · 3 LANES')) {
          laneHovered = true
          setTimeout(() => child.write('\u001b[<35;20;13M'), 100)
        } else if (!laneSelected && output.includes('│ › Dev')) {
          laneSelected = true
          child.write('\u001b[<0;20;13M')
          setTimeout(() => {
            child.write('\u001b[<35;70;16M')
            setTimeout(() => {
              child.write('\u001b[<0;70;16M')
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

  it('hovers and clicks an Action Shelf label outside its keycap', async () => {
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

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let hovered = false
      let clicked = false
      let closed = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Action Shelf pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!hovered && output.includes('[ p ] Setup')) {
          hovered = true
          child.write('\u001b[<35;62;21M')
        } else if (!clicked && output.includes('│ › [ p ] Setup')) {
          clicked = true
          child.write('\u001b[<0;62;21M')
        } else if (!closed && clicked && output.includes('╭ Setup Studio · Default AliceProject')) {
          closed = true
          child.write('\u001b')
        } else if (!detached && closed && output.includes('Setup closed.')) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor Action Shelf pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('│ › [ p ] Setup')
    expect(transcript).toContain('╭ Setup Studio · Default AliceProject')
    expect(transcript).toContain('FIXTURE_RESULT starts=0 opens=0')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
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
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Event Lens pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('[ l ] Logs')) {
          opened = true
          child.write('l')
        } else if (!hovered && output.includes('Event Lens · LINE 10 · INFO · TEXT')) {
          hovered = true
          child.write('\u001b[<35;20;11M')
        } else if (!clicked && output.includes('│ » !  9  03:04:09Z Fixture event 9')) {
          clicked = true
          child.write('\u001b[<0;20;11M')
        } else if (clicked && output.includes('Event Lens · LINE 9 · WARNING · JSON')) {
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
    expect(transcript).toContain('█')
    expect(transcript).toContain('FIXTURE_RESULT event-lens')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('hovers and clicks the Launchpad primary surface outside its keycap', async () => {
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
        if (!hovered && output.includes('◆ LAUNCH READY') && output.includes('[ Enter ]')) {
          hovered = true
          child.write('\u001b[<35;60;10M')
        } else if (!clicked && output.includes('│ › [ Enter ]')) {
          clicked = true
          child.write('\u001b[<0;60;10M')
        } else if (clicked && output.includes('OpenAlice started and opened in your browser.')) {
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

  it('clicks the navigation rail and explores Help with raw pointer input', async () => {
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
        if (!clicked && output.includes('◆ [Overview]') && output.includes('? Help')) {
          clicked = true
          child.write('\u001b[<35;52;3M')
          child.write('\u001b[<0;52;3M')
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
        const timeout = setTimeout(() => {
          child.kill()
          reject(new Error(`Supervisor transfer ${scenario} timed out at stage ${stage}:\n${output}`))
        }, 12_000)
        child.onData((data) => {
          output += data
          if (
            !openedFleet
            && output.includes('Start OpenAlice & open Workspace')
            && (output.includes('Fleet') || output.includes('Machines'))
          ) {
            openedFleet = true
            child.write('\t')
          } else if (stage === 0 && output.includes('[ m ] Transfer')) {
            stage = 1
            child.write('m')
          } else if (stage === 1 && output.includes('destination Machine')) {
            stage = 2
            if (scenario === 'success') {
              child.write('\u001b[<35;50;12M')
              child.write('\u001b[<0;50;12M')
            } else {
              child.write('\r')
            }
          } else if (stage === 2 && output.includes('Destination AliceProject key')) {
            if (scenario === 'success') {
              stage = 22
              child.write('\u0005\u0015Bad Key')
              setTimeout(() => {
                child.write('\u001b[<35;65;15M')
                setTimeout(() => child.write('\u001b[<0;65;15M'), 300)
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
              child.write('\u001b[<35;65;15M')
              setTimeout(() => child.write('\u001b[<0;65;15M'), 300)
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
              child.write('\r')
            }
          } else if (stage === 6 && output.includes('Review AliceProject transfer')) {
            stage = scenario === 'default-no' ? 10 : 7
            child.write(scenario === 'default-no' ? 'n' : 'y')
          } else if (stage === 7 && scenario === 'checksum-retry' && output.includes('Synthetic checksum mismatch')) {
            stage = 8
            child.write('r')
          } else if (stage === 7 && scenario === 'cancel-retry' && output.includes('Transferring')) {
            stage = 9
            child.write('\u001b')
          } else if (stage === 9 && output.includes('Synthetic transfer cancellation acknowledged.')) {
            stage = 8
            child.write('r')
          } else if ((stage === 7 || stage === 8) && output.includes('AliceProject transfer complete')) {
            stage = 20
            child.write('\r')
          } else if (stage === 10 && output.includes('Transfer cancelled. Nothing changed.')) {
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
      } else {
        expect(transcript).toContain('Transfer Flight Deck')
      }
      expect(transcript).toContain('◆ Destination AliceProject key')
      expect(transcript).toContain('◆ Credentials')
      expect(transcript).toContain('◆ [ Enter ] Choose')
      if (scenario === 'checksum-retry' || scenario === 'cancel-retry') {
        expect(transcript).toContain('Transfer Flight Deck · 7/8 · STREAM')
      }
      if (scenario === 'auth-loss') {
        expect(transcript).toContain('SSH authentication required after destination selection.')
      } else if (scenario === 'occupied') {
        expect(transcript).toContain('Destination key or Home became occupied before planning.')
      } else {
        expect(transcript).toContain('Sessions  0 imported')
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
        if (!opened && output.includes('[ p ] Setup')) {
          opened = true
          child.write('p')
        } else if (!hovered && output.includes('Setup Studio · Default AliceProject') && output.includes('Cycle value')) {
          hovered = true
          child.write('\u001b[<35;75;15M')
        } else if (!clicked && output.includes('› [ Enter ] Cycle value')) {
          clicked = true
          child.write('\u001b[<0;75;15M')
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

  it('keeps the application frame stable behind a focused confirmation modal', async () => {
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
        } else if (!hoveredCancel && output.includes('Confirm Managed Source') && output.includes('[ Esc ] Not now')) {
          hoveredCancel = true
          child.write('\u001b[<32;49;16M')
        } else if (!clickedCancel && output.includes('│ › [ Esc ] Not now')) {
          clickedCancel = true
          child.write('\u001b[<0;49;16M')
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
    expect(transcript).toContain('[ / ] Commands')
    expect(transcript).toContain('STATUS   Action cancelled.')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('opens Setup by clicking a command-palette overlay row', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-command-palette-overlay-'))
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
      let clickedSetup = false
      let setupOpened = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor command palette overlay timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('[ / ] Commands') && output.includes('○ COLD')) {
          opened = true
          child.write('/')
        } else if (!clickedSetup && output.includes('Command Palette') && output.includes('› ◆ Start OpenAlice')) {
          clickedSetup = true
          child.write('\u001b[<32;6;12M')
          child.write('\u001b[<0;6;12M')
        } else if (!setupOpened && output.includes('Setup Studio · Default AliceProject')) {
          setupOpened = true
          child.write('\u001b')
          setTimeout(() => child.write('q'), 50)
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && setupOpened) resolve(output)
        else reject(new Error(`Supervisor command palette overlay exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Command Palette')
    expect(transcript).toContain('╭ Launchpad · AliceProject')
    expect(transcript).toContain('Setup Studio · Default AliceProject')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('keeps project and Runtime context in a clickable status ribbon', async () => {
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
        reject(new Error(`Supervisor context ribbon timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (
          !clickedProject
          && output.includes('[ i ] Default AliceProject')
          && output.includes('○ COLD · OVERVIEW')
        ) {
          clickedProject = true
          child.write('\u001b[<32;36;22M')
          child.write('\u001b[<0;36;22M')
        } else if (!closedOverlay && output.includes('AliceProject Switchboard · 1 PROJECT')) {
          closedOverlay = true
          child.write('\u001b')
        } else if (
          closedOverlay
          && !clickedAfterNotice
          && output.includes('STATUS   AliceProject selection closed.')
        ) {
          clickedAfterNotice = true
          child.write('\u001b[<0;2;22M')
        } else if (!openedPalette && output.includes('Command Palette')) {
          openedPalette = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && openedPalette) resolve(output)
        else reject(new Error(`Supervisor context ribbon exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('AliceProject Switchboard · 1 PROJECT')
    expect(transcript).toContain('STATUS   AliceProject selection closed.')
    expect(transcript).toContain('Command Palette')
    expect(transcript).toContain('\u001b[38;2;199;235;239;48;2;10;34;39m')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
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
        if (!openedFleet && output.includes('[Overview]') && output.includes('Machines')) {
          openedFleet = true
          child.write('\t')
        } else if (!selectedRemote && output.includes('Cloud fixture') && output.includes('offline')) {
          selectedRemote = true
          child.resize(48, 24)
          child.write('\u001b[B\u001b[C')
        } else if (!drilledDown && output.includes('AliceProjects · Cloud fixture')) {
          drilledDown = true
          returnOffset = output.length
          child.write('\u001b[D')
        } else if (
          drilledDown
          && !returned
          && output.slice(returnOffset).includes('Machines · ')
          && output.slice(returnOffset).includes('[ Enter ] Browse projects')
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
        if (!detached && output.includes('Research') && output.includes(instanceHome)) {
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
    expect(transcript).toContain(instanceHome)
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
            child.write('\u001b[<35;63;14M')
            setTimeout(() => child.write('\u001b[<0;63;14M'), 100)
          }, 100)
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

    expect(transcript).toContain('Source route · SELECT CHECKOUT')
    expect(transcript).toContain('Runtime Source · AliceProject setting')
    expect(transcript).toContain('› [ Enter ] Save & start')
    expect(transcript).toContain('Source route · REJECTED')
    expect(transcript).toContain('Could not use that checkout')
    expect(transcript).toContain('Source configuration cancelled.')
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
        } else if (!detached && output.includes('Source configuration cancelled.')) {
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
    expect(transcript).toContain('Source configuration cancelled.')
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
        if (!openedSettings && output.includes('[ p ] Setup')) {
          openedSettings = true
          child.write('p')
        } else if (!selectedPort && output.includes('Setup Studio · Default AliceProject')) {
          selectedPort = true
          child.write('\u001b[B\u001b[B\r')
        } else if (!submittedInvalidPort && output.includes('Set AliceProject browser port')) {
          submittedInvalidPort = true
          child.write('99999')
          setTimeout(() => {
            child.write('\u001b[<35;65;15M')
            setTimeout(() => child.write('\u001b[<0;65;15M'), 300)
          }, 100)
        } else if (
          !submittedPort
          && output.includes('Layer Context · PROJECT · FIX')
          && output.includes('Browser port must be a whole number')
        ) {
          submittedPort = true
          child.write('\u0005\u001549001')
          setTimeout(() => {
            child.write('\u001b[<35;65;15M')
            setTimeout(() => child.write('\u001b[<0;65;15M'), 300)
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
        if (!openedSetup && output.includes('[ p ] Setup')) {
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
            child.write('\u001b[<35;60;17M')
            setTimeout(() => child.write('\u001b[<0;60;17M'), 100)
          }, 100)
        } else if (
          !acceptedHome
          && output.includes('Create AliceProject · research')
          && output.includes('Complete home')
        ) {
          acceptedHome = true
          child.write('\u001b[<35;64;17M')
          setTimeout(() => child.write('\u001b[<0;64;17M'), 100)
        } else if (
          !reopenedProjects
          && output.includes('Created and selected AliceProject Research.')
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
          child.write('\u001b[A')
        } else if (
          focusedDefault
          && !selectedDefault
          && output.slice(defaultFocusOffset).includes('◆ Default AliceProject · 1/3')
        ) {
          selectedDefault = true
          child.write('\r')
        } else if (
          !detached
          && output.includes('Selected AliceProject Default AliceProject; future bare starts use it.')
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
    expect(transcript).toContain('Created and selected AliceProject Research.')
    expect(transcript).toContain('Selected AliceProject Default AliceProject; future bare starts use it.')
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
        } else if (returned && output.includes('AliceProject selection closed.')) {
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
          child.write('\u001b[<35;20;11M')
        } else if (
          !actionHovered
          && output.includes('› Research')
          && output.includes('Inspector · 2/3')
        ) {
          actionHovered = true
          child.write('\u001b[<35;75;15M')
        } else if (!actionClicked && output.includes('› [ Enter ] Select')) {
          actionClicked = true
          child.write('\u001b[<0;75;15M')
        } else if (
          !detached
          && output.includes('Selected AliceProject Research; future bare starts use it.')
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
    expect(transcript).toContain('Selected AliceProject Research; future bare starts use it.')
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
          && output.includes('Using "default"; press i AliceProjects to recover.')
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
          && output.includes('Selected AliceProject Default AliceProject; future bare starts use it.')
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
    expect(transcript).toContain('Using "default"; press i AliceProjects to recover.')
    expect(transcript).toContain('+ Create AliceProject')
    expect(transcript).toContain('Selected AliceProject Default AliceProject; future bare starts use it.')
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
        if (!openedSettings && output.includes('[ p ] Setup')) {
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
        } else if (
          !closedInstances
          && output.includes('AliceProject selection is read-only.')
          && output.includes('AliceProject Switchboard')
          && output.includes('Research')
          && output.includes('CURRENT')
          && output.includes('READ ONLY')
        ) {
          closedInstances = true
          child.write('\u001b')
        } else if (
          !detached
          && output.includes('AliceProject selection closed.')
        ) {
          detached = true
          child.write('q')
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
