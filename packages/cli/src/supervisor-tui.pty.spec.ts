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
  it.each([
    ['default-no', 50, 'sends=0 aborted=false'],
    ['success', 100, 'sends=1 aborted=false'],
    ['auth-loss', 100, 'sends=0 aborted=false'],
    ['occupied', 100, 'sends=0 aborted=false'],
    ['checksum-retry', 100, 'sends=2 aborted=false'],
    ['cancel-retry', 100, 'sends=2 aborted=true'],
  ] as const)(
    'drives the remote transfer %s recovery path through a real PTY',
    async (scenario, cols, expectedResult) => {
      const child = pty.spawn(process.execPath, [transferFixtureEntry], {
        cols,
        rows: 30,
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
        const timeout = setTimeout(() => {
          child.kill()
          reject(new Error(`Supervisor transfer ${scenario} timed out at stage ${stage}:\n${output}`))
        }, 12_000)
        child.onData((data) => {
          output += data
          if (stage === 0 && output.includes('m Transfer')) {
            stage = 1
            child.write('m')
          } else if (stage === 1 && output.includes('destination Machine')) {
            stage = 2
            child.write('\r')
          } else if (stage === 2 && output.includes('Destination AliceProject key')) {
            stage = 3
            child.write('\r')
          } else if (stage === 3 && output.includes('Destination complete Home')) {
            stage = 4
            child.write('\r')
          } else if (stage === 4 && output.includes('Credentials')) {
            stage = 5
            child.write('\r')
          } else if (stage === 5 && output.includes('Exact-Session scheduled Issue owners')) {
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

    expect(transcript).toContain(`OpenAlice  ${cliVersion}  development`)
    expect(transcript).toContain('Runtime state: absent')
    expect(transcript).toContain('Supervisor controls')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  })

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
      let selectedRemote = false
      let drilledDown = false
      let returned = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor offline fleet timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!selectedRemote && output.includes('Cloud fixture') && output.includes('offline')) {
          selectedRemote = true
          child.resize(48, 24)
          child.write('\u001b[B\u001b[C')
        } else if (!drilledDown && output.includes('AliceProjects · Cloud fixture')) {
          drilledDown = true
          child.write('\u001b')
        } else if (drilledDown && !returned && output.includes('Enter / →  AliceProjects')) {
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

    expect(transcript).toContain('AliceProject: Research')
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
        if (!requestedStart && output.includes('Enter prepares anything missing')) {
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

    expect(transcript).toContain(`OpenAlice  ${cliVersion}  branch dev`)
    expect(transcript).toContain('installer-managed OpenAlice source branch dev')
    expect(transcript).not.toContain('Configure Runtime source')
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
      let submittedPort = false
      let closedSettings = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor settings TUI timed out:\n${output}`))
      }, 10_000)
      child.onData((data) => {
        output += data
        if (!openedSettings && output.includes('p Setup')) {
          openedSettings = true
          child.write('p')
        } else if (!selectedPort && output.includes('OpenAlice setup · Default AliceProject')) {
          selectedPort = true
          child.write('\u001b[B\u001b[B\r')
        } else if (!submittedPort && output.includes('Set AliceProject browser port')) {
          submittedPort = true
          child.write('49001\r')
        } else if (
          !closedSettings
          && output.includes('Saved browser port for AliceProject "Default AliceProject".')
        ) {
          closedSettings = true
          child.write('\u001b')
        } else if (
          !detached
          && output.includes('port (project.default.port)')
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
    expect(transcript).toContain('OpenAlice setup · Default AliceProject')
    expect(transcript).toContain('Set AliceProject browser port')
    expect(transcript).toContain('Saved browser port for AliceProject "Default AliceProject".')
    expect(transcript).toContain('port (project.default.port)')
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
        if (!openedSetup && output.includes('p Setup')) {
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
          && output.includes('port (machine.defaults.port)')
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
    expect(transcript).toContain('Set machine-default browser port')
    expect(transcript).toContain('Saved browser port for machine default.')
    expect(transcript).toContain('port (machine.defaults.port)')
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
      let selectedDefault = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor AliceProjects TUI timed out:\n${output}`))
      }, 12_000)
      child.onData((data) => {
        output += data
        if (!openedProjects && output.includes('i AliceProjects')) {
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
        } else if (
          !reopenedProjects
          && output.includes('Created and selected AliceProject Research.')
          && output.includes('AliceProject: Research')
        ) {
          reopenedProjects = true
          child.write('i')
        } else if (
          reopenedProjects
          && !selectedDefault
          && output.includes('Research · current · default')
        ) {
          selectedDefault = true
          child.write('\u001b[A\r')
        } else if (
          !detached
          && output.includes('Selected AliceProject Default AliceProject; future bare starts use it.')
          && output.includes('AliceProject: Default AliceProject')
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
    expect(transcript).toContain('OpenAlice AliceProjects')
    expect(transcript).toContain('Created and selected AliceProject Research.')
    expect(transcript).toContain('Selected AliceProject Default AliceProject; future bare starts use it.')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 15_000)

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
          && output.includes('AliceProject: Default AliceProject')
        ) {
          openedProjects = true
          child.write('i')
        } else if (
          openedProjects
          && !repairedDefault
          && output.includes('Default AliceProject · current')
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
        if (!openedSettings && output.includes('p Setup')) {
          openedSettings = true
          child.write('p')
        } else if (!selectedPort && output.includes('44000 · locked')) {
          selectedPort = true
          child.write('\u001b[B\u001b[B')
        } else if (!testedLockedPort && output.includes('Locked by --port.')) {
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
        if (!openedInstances && output.includes('i AliceProjects')) {
          openedInstances = true
          child.write('i')
        } else if (
          !closedInstances
          && output.includes('AliceProject selection is read-only.')
          && output.includes('Research · current')
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
    expect(transcript).toContain('Research · current')
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
      let requestedManaged = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor managed-source TUI timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!openedOverview && output.includes('m Transfer')) {
          openedOverview = true
          child.write(']')
        } else if (!requestedManaged && output.includes('m Managed')) {
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
