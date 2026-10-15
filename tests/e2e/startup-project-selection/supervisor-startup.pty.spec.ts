import { cp, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import * as pty from 'node-pty'
import { describe, expect, it } from 'vitest'

import { cliEntry, launchpadFixtureEntry, cliPackageRoot, cliVersion, temporaryPaths, stripSgr } from '../../../packages/cli/src/__fixtures__/supervisor-pty-support.js'

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
      let hovered = false
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
        if (
          !hovered
          && plain.includes('OPENALICE LAUNCH · READY → START → CONNECT')
          && plain.includes('◆ [ Enter ] Start OpenAlice')
        ) {
          hovered = true
          child.write('\u001b[<35;100;18M')
        } else if (!started && plain.includes('› [ Enter ] Start OpenAlice')) {
          started = true
          child.write('\u001b[<0;100;18M')
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
    const operationStart = plain.indexOf('◆ OPERATION · LOCAL START')
    const flightStart = plain.indexOf('Launch Flight Recorder · LOCAL START · IN FLIGHT')
    const homeStart = plain.indexOf('◆ [Home] │ ● Inbox', flightStart)
    const flight = plain.slice(operationStart, homeStart)
    expect(operationStart).toBeGreaterThanOrEqual(0)
    expect(plain).toContain('◆ IN FLIGHT · This computer → Default AliceProject')
    expect(plain).toContain('✓ 01  Validate local target · DONE')
    expect(plain).toContain('◆ 02  Prepare and start Runtime · IN FLIGHT')
    expect(plain).toContain('◇ 03  Bind local target · WAITING')
    expect(plain).toContain('◇ CONTROL  Keep this terminal open')
    expect(plain).toContain('NEXT')
    expect(plain).toContain('› [ Enter ] Start OpenAlice')
    expect(plain).toContain('1 Start Runtime')
    expect(plain).toContain('2 Verify Web endpoint')
    expect(plain).toContain('3 Enter connected Home')
    expect(plain).toContain('◆ [ Enter ] Start OpenAlice')
    expect(flight).toContain('◆ OPERATION · LOCAL START')
    expect(flight).toContain('INPUT OWNED UNTIL READY')
    expect(flight).not.toContain('[Connect]')
    expect(flight).not.toContain('? Help')
    expect(flight).toContain('Operation owns input until ready; q detaches this TUI.')
    expect(flight).toContain('◆ OPERATION ACTIVE')
    expect(flight).toContain('[ q ] Detach')
    expect(flight).not.toContain('[ / ] Commands')
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
    expect(plain).toContain('OPENALICE LAUNCH · READY → START → CONNECT')
    expect(plain).toContain('1 MACHINE ✓ This computer')
    expect(plain).toContain('2 ALICEPROJECT ✓ Default')
    expect(plain).toContain('[ Enter ] Start OpenAlice')
    expect(plain).toContain('Launchpad · Default')
    expect(plain).toContain('◆ READY TO LAUNCH · READY TO START')
    expect(plain).toContain('1 Start Runtime')
    expect(plain).toContain('2 Verify Web endpoint')
    expect(plain).toContain('3 Enter connected Home')
    expect(plain).not.toContain('OWNER    none')
    expect(plain).not.toContain('Inbox')
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
        if (!hovered && output.includes('Your workspace is one step away') && output.includes('[ Enter ]')) {
          hovered = true
          child.write('\u001b[<35;60;13M')
        } else if (!clicked && stripSgr(output).includes('│ › [ Enter ]')) {
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

    expect(stripSgr(transcript)).toContain('│ › [ Enter ]')
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
        OPENALICE_TUI_FIXTURE_HOME_AVAILABLE: '0',
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
        } else if (!clicked && stripSgr(output).includes('│ › [ Enter ]')) {
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

    expect(stripSgr(transcript)).toContain('│ › [ Enter ]')
    expect(stripSgr(transcript)).toContain('HOME MISSING')
    expect(transcript).toContain('Opened the verified Web')
    expect(transcript).toContain('FIXTURE_RESULT starts=0 opens=1')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

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
        } else if (!detached && output.includes('Help · START · SEARCH · SWITCH · 1/3')) {
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
    expect(transcript).toContain('Help · START · SEARCH · SWITCH · 1/3')
    expect(transcript).toContain('NOW · [ Enter ] Start/connect/open')
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
  }, 10_000)

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
