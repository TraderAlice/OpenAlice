import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import * as pty from 'node-pty'
import { describe, expect, it } from 'vitest'

import { cliEntry, transferFixtureEntry, launchpadFixtureEntry, doctorPrimaryFixtureEntry, cliVersion, temporaryPaths, stripSgr } from '../../../packages/cli/src/__fixtures__/supervisor-pty-support.js'

describe.skipIf(process.platform === 'win32')('Supervisor TUI PTY', () => {
  it('recovers from a failed local launch through Retry-or-Back guidance', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-launch-failure-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_START_VIEW: 'connect',
        OPENALICE_TUI_BOOT: '0',
        OPENALICE_TUI_MOTION: '0',
        OPENALICE_TUI_FIXTURE_FLEET_ROWS: '1',
        OPENALICE_TUI_FIXTURE_START_FAILURE: '1',
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let stage = 0
      let failureOffset = 0
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor launch failure timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        const plain = stripSgr(output)
        if (stage === 0 && plain.includes('OPENALICE LAUNCH · READY → START → CONNECT')) {
          stage = 1
          child.write('\r')
        } else if (stage === 1 && plain.includes('RECOVERABLE FAILURE')) {
          stage = 2
          failureOffset = plain.lastIndexOf('Launch Flight Recorder')
          child.write('\u001b')
        } else if (stage === 2
          && plain.slice(failureOffset).includes('OPENALICE LAUNCH · READY → START → CONNECT')) {
          stage = 3
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && stage === 3) resolve(output)
        else reject(new Error(`Supervisor launch failure exited ${exitCode}:\n${output}`))
      })
    })

    const plain = stripSgr(transcript)
    expect(plain).toContain('× RECOVERABLE FAILURE · This computer → Default AliceProject')
    expect(plain).toContain('× 02  Prepare and start Runtime · FAILED')
    expect(plain).toContain('Starting Runtime failed: Fixture Runtime…')
    expect(plain).toContain('[ Enter ] Retry selected target')
    expect(plain).toContain('[ Esc ] Back to targets')
    expect(plain).toContain('Enter retries; Esc returns to targets; q detaches this TUI.')
    expect(plain).toContain('Default AliceProject · LOCAL › ○ COLD')
    expect(plain).toContain('FIXTURE_RESULT starts=1 opens=0 loads=0 diagnoses=0')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
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
    expect(transcript).toContain('[ d ] Rerun Runtime Doctor')
    expect(transcript).toContain('FIXTURE_RESULT diagnoses=1')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it.each([
    ['default-no compact', 'default-no', 80, 24, 'sends=0 aborted=false', true],
    ['success wide', 'success', 110, 30, 'sends=1 aborted=false', false],
    ['success compact', 'success', 80, 24, 'sends=1 aborted=false', true],
    ['auth-loss', 'auth-loss', 100, 30, 'sends=0 aborted=false', false],
    ['occupied', 'occupied', 100, 30, 'sends=0 aborted=false', false],
    ['checksum-retry', 'checksum-retry', 100, 30, 'sends=2 aborted=false', false],
    ['cancel-retry', 'cancel-retry', 100, 30, 'sends=2 aborted=true', false],
  ] as const)(
    'drives the remote transfer %s recovery path through a real PTY',
    async (_caseName, scenario, cols, rows, expectedResult, compact) => {
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
            if (scenario === 'success' && !compact) {
              child.write('\u001b[<35;50;7M')
              child.write('\u001b[<0;50;7M')
            } else {
              child.write('\r')
            }
          } else if (stage === 2 && output.includes('Destination AliceProject key')) {
            if (scenario === 'success' && !compact) {
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
        if (!compact) expect(transcript).toContain('! Destination AliceProject key · FIX')
      } else if (scenario === 'default-no') {
        expect(transcript).toContain('Transfer Flight Deck')
      }
      if (scenario !== 'default-no') {
        expect(transcript).toContain(`◇ BUILD v${cliVersion} · DEV`)
        expect(transcript).toContain('◆ FOCUS · TRANSFER')
        expect(transcript).toContain('TRANSFER FLIGHT DECK')
        expect(transcript).toContain('◆ TRANSFER')
        expect(transcript).toContain('◆ [ Enter ] Choose / next  │  [ ↑↓ ] Move choice')
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

  it('keeps an unavailable remembered Default detached while the Project picker offers recovery', async () => {
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
      let attemptedSelection = false
      let closeOffset = -1
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor AliceProject recovery timed out:\n${output}`))
      }, 10_000)
      child.onData((data) => {
        output += data
        if (
          !openedProjects
          && output.includes('Alice Session · OpenAlice')
          && output.includes('Default AliceProject')
        ) {
          openedProjects = true
          child.write('i')
        } else if (
          openedProjects
          && !attemptedSelection
          && output.includes('AliceProject Switchboard')
          && output.includes('Default AliceProject')
          && output.includes('CURRENT')
          && output.includes('+ Create AliceProject')
        ) {
          attemptedSelection = true
          child.write('\r')
        } else if (
          !detached
          && attemptedSelection && output.includes('Could not switch AliceProject:')
        ) {
          if (closeOffset < 0) {
            closeOffset = output.length
            child.write('\u001b')
          } else if (output.slice(closeOffset).includes('Alice Session · OpenAlice')) {
            detached = true
            child.write('q')
          }
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
    expect(config.defaultTarget).toEqual({ machine: 'local', project: 'missing' })
    expect(transcript).toContain('Could not switch AliceProject:')
    expect(transcript).not.toContain('Using "default"')
    expect(transcript).not.toContain('READ ONLY')
    expect(transcript).toContain('+ Create AliceProject')
    expect(transcript).not.toContain('Selected AliceProject Default AliceProject')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 15_000)


})
