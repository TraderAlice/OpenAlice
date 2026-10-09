import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import * as pty from 'node-pty'
import { describe, expect, it } from 'vitest'

import { cliEntry, launchpadFixtureEntry, temporaryPaths, stripSgr, projectCreateFixtureEntry } from '../../../packages/cli/src/__fixtures__/supervisor-pty-support.js'

describe.skipIf(process.platform === 'win32')('Supervisor TUI PTY', () => {
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

  it('previews a compact remote switch without dropping the active target', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-switch-target-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_BOOT: '0',
        OPENALICE_TUI_MOTION: '0',
        OPENALICE_TUI_START_VIEW: 'connect',
        OPENALICE_TUI_FIXTURE_RUNTIME: 'running',
        OPENALICE_TUI_FIXTURE_FLEET_ROWS: '1',
        OPENALICE_TUI_FIXTURE_REMOTE: '1',
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let stage = 0
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor switch target timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        const plain = stripSgr(output)
        if (stage === 0 && plain.includes('Alice Session · OpenAlice')) {
          stage = 1
          child.write(']]')
        } else if (stage === 1 && plain.includes('Machines · 1/2')) {
          stage = 2
          child.write('\u001b[B')
        } else if (stage === 2 && plain.includes('▶ Cloud Lab')) {
          stage = 3
          child.write('\t')
        } else if (stage === 3 && plain.includes('[ Enter ] Connect & Switch')) {
          stage = 4
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && stage === 4) resolve(output)
        else reject(new Error(`Supervisor switch target exited ${exitCode}:\n${output}`))
      })
    })

    const plain = stripSgr(transcript)
    expect(plain).toContain('AliceProjects · Cloud Lab · 1/1')
    expect(plain).toContain('Switch Target')
    expect(plain).toContain('◇ SWITCH CANDIDATE')
    expect(plain).toContain('[ Enter ] Connect & Switch')
    expect(plain).toContain('current target stays live until ready')
    expect(plain).toMatch(/This computer\s+● ACTIVE · 1/u)
    expect(plain).toContain('⌂ This comp… · LOCAL  ›  ● LIVE')
    expect(transcript).toContain('FIXTURE_RESULT starts=0 opens=0 loads=0 diagnoses=0')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('keeps the live source visible during a remote switch flight', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-switch-flight-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_BOOT: '0',
        OPENALICE_TUI_MOTION: '0',
        OPENALICE_TUI_START_VIEW: 'connect',
        OPENALICE_TUI_FIXTURE_RUNTIME: 'running',
        OPENALICE_TUI_FIXTURE_FLEET_ROWS: '1',
        OPENALICE_TUI_FIXTURE_REMOTE: '1',
        OPENALICE_TUI_FIXTURE_REMOTE_READY_DELAY_MS: '500',
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let stage = 0
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor switch flight timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        const plain = stripSgr(output)
        if (stage === 0 && plain.includes('Alice Session · OpenAlice')) {
          stage = 1
          child.write(']]')
        } else if (stage === 1 && plain.includes('Machines · 1/2')) {
          stage = 2
          child.write('\u001b[B')
        } else if (stage === 2 && plain.includes('▶ Cloud Lab')) {
          stage = 3
          child.write('\t')
        } else if (stage === 3 && plain.includes('[ Enter ] Connect & Switch')) {
          stage = 4
          child.write('\r')
        } else if (stage === 4 && plain.includes('◆ TO    Cloud Lab / Research · SSH FORWARD')) {
          stage = 5
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && stage === 5) resolve(output)
        else reject(new Error(`Supervisor switch flight exited ${exitCode}:\n${output}`))
      })
    })

    const plain = stripSgr(transcript)
    expect(plain).toContain('Launch Flight Recorder · REMOTE CONNECT · IN FLIGHT')
    expect(plain).toContain('● FROM  This computer / Default AliceProject · LOCAL · LIVE')
    expect(plain).toContain('◆ TO    Cloud Lab / Research · SSH FORWARD')
    expect(plain).toContain('◆ 02  Open SSH forward · IN FLIGHT')
    expect(plain).toContain('◆ OPERATION ACTIVE')
    expect(plain).toContain('FIXTURE_RESULT starts=0 opens=0 loads=0 diagnoses=0 disconnects=1')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

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
          && closedSettings && output.slice(output.lastIndexOf('Saved browser port')).includes('Alice Session · OpenAlice')
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
    expect(transcript).toContain('Alice Session · OpenAlice')
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
    const child = pty.spawn(process.execPath, [join(dirname(cliEntry), '../src/__fixtures__/supervisor-project-create-fixture.ts')], {
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
      let prepared = false
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
          child.write('research\r')
        } else if (
          !acceptedHome
          && output.includes('Create AliceProject · research')
          && output.includes('Complete home')
        ) {
          acceptedHome = true
          child.write('\r')
        } else if (!prepared && output.includes('Choose workspaces')) {
          prepared = true
          child.write('\r')
        } else if (
          !reopenedProjects
          && output.includes('OpenAlice started and opened in your browser.')
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
          && output.includes('Opened AliceProject Default AliceProject')
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
    expect(config.defaultTarget).toEqual({ machine: 'local', project: 'default' })
    expect(config.projects.research).toEqual({
      name: 'research',
      home: await realpath(join(isolatedHome, '.openalice-research')),
    })
    expect(transcript).toContain('AliceProject Switchboard · 1 PROJECT')
    expect(transcript).toContain('[ Enter ] Continue')
    expect(transcript).toContain('Create & start')
    expect(transcript).toContain('Choose workspaces')
    expect(JSON.parse(await readFile(join(isolatedHome, '.openalice-research/workspace-setup.json'), 'utf8')).pending).toEqual(['chat', 'auto-quant', 'auto-prediction'])
    expect(transcript).toContain('Opened AliceProject Default AliceProject')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 15_000)

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
    const child = pty.spawn(process.execPath, [projectCreateFixtureEntry], {
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
          && output.includes('Opened AliceProject Research; Default updated.')
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
    expect(config.defaultProject).toBeUndefined()
    expect(config.defaultTarget).toEqual({ machine: 'local', project: 'research' })
    expect(config.projects.research.home).toBe(researchHome)
    expect(transcript).toContain('› Research')
    expect(transcript).toContain('› [ Enter ] Select')
    expect(transcript).toContain('Opened AliceProject Research; Default updated.')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
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

    expect(transcript).toContain('Locked by --project.')
    expect(transcript).toContain('Research')
    expect(transcript).toContain('CURRENT')
    expect(transcript).toContain('READ ONLY')
    expect(transcript).not.toContain('+ Create AliceProject')
  }, 15_000)


})
