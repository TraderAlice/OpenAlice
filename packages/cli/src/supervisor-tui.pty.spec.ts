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

  it('edits and persists selected-instance settings inside the TUI', async () => {
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
        } else if (!selectedPort && output.includes('OpenAlice setup · default')) {
          selectedPort = true
          child.write('\u001b[B\u001b[B\r')
        } else if (!submittedPort && output.includes('Set instance browser port')) {
          submittedPort = true
          child.write('49001\r')
        } else if (
          !closedSettings
          && output.includes('Saved browser port for instance "default".')
        ) {
          closedSettings = true
          child.write('\u001b')
        } else if (
          !detached
          && output.includes('port (instance.default.port)')
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
    expect(config.instances.default.port).toBe(49_001)
    expect(transcript).toContain('OpenAlice setup · default')
    expect(transcript).toContain('Set instance browser port')
    expect(transcript).toContain('Saved browser port for instance "default".')
    expect(transcript).toContain('port (instance.default.port)')
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
          && output.includes('This instance')
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

  it('creates, selects, remembers, and switches named instances inside the TUI', async () => {
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
      let openedInstances = false
      let requestedCreate = false
      let submittedName = false
      let acceptedHome = false
      let reopenedInstances = false
      let selectedDefault = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor instances TUI timed out:\n${output}`))
      }, 12_000)
      child.onData((data) => {
        output += data
        if (!openedInstances && output.includes('i Instances')) {
          openedInstances = true
          child.write('i')
        } else if (!requestedCreate && output.includes('+ Create instance')) {
          requestedCreate = true
          child.write('\u001b[B\r')
        } else if (
          !submittedName
          && output.includes('Instance name')
        ) {
          submittedName = true
          child.write('research\r')
        } else if (
          !acceptedHome
          && output.includes('Create instance · research')
          && output.includes('Data home')
        ) {
          acceptedHome = true
          child.write('\r')
        } else if (
          !reopenedInstances
          && output.includes('Created and selected instance research.')
          && output.includes('Instance: research')
        ) {
          reopenedInstances = true
          child.write('i')
        } else if (
          reopenedInstances
          && !selectedDefault
          && output.includes('research · current · default')
        ) {
          selectedDefault = true
          child.write('\u001b[A\r')
        } else if (
          !detached
          && output.includes('Selected instance default; future bare starts use it.')
          && output.includes('Instance: default')
        ) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor instances TUI exited ${exitCode}:\n${output}`))
      })
    })

    const config = JSON.parse(
      await readFile(join(supervisorHome, 'config.json'), 'utf8'),
    )
    expect(config.defaultInstance).toBeUndefined()
    expect(config.instances.research).toEqual({
      name: 'research',
      home: await realpath(join(isolatedHome, '.openalice-research')),
    })
    expect(transcript).toContain('OpenAlice instances')
    expect(transcript).toContain('Created and selected instance research.')
    expect(transcript).toContain('Selected instance default; future bare starts use it.')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 15_000)

  it('recovers in the instance picker when the remembered complete home is missing', async () => {
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
      let openedInstances = false
      let repairedDefault = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor instance recovery timed out:\n${output}`))
      }, 10_000)
      child.onData((data) => {
        output += data
        if (
          !openedInstances
          && output.includes('Using "default"; press i Instances to recover.')
          && output.includes('Instance: default')
        ) {
          openedInstances = true
          child.write('i')
        } else if (
          openedInstances
          && !repairedDefault
          && output.includes('default · current')
          && output.includes('+ Create instance')
        ) {
          repairedDefault = true
          child.write('\r')
        } else if (
          !detached
          && output.includes('Selected instance default; future bare starts use it.')
        ) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor instance recovery exited ${exitCode}:\n${output}`))
      })
    })

    const config = JSON.parse(
      await readFile(join(supervisorHome, 'config.json'), 'utf8'),
    )
    expect(config.defaultInstance).toBeUndefined()
    expect(config.instances.missing.home).toBe(join(isolatedHome, 'disconnected-home'))
    expect(transcript).toContain('Instance "missing" is missing.')
    expect(transcript).toContain('Using "default"; press i Instances to recover.')
    expect(transcript).toContain('+ Create instance')
    expect(transcript).toContain('Selected instance default; future bare starts use it.')
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

  it('shows CLI-selected instances as read-only instead of pretending to switch them', async () => {
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
        if (!openedInstances && output.includes('i Instances')) {
          openedInstances = true
          child.write('i')
        } else if (
          !closedInstances
          && output.includes('Instance selection is read-only.')
          && output.includes('research · current')
        ) {
          closedInstances = true
          child.write('\u001b')
        } else if (
          !detached
          && output.includes('Instance selection closed.')
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
    expect(transcript).toContain('research · current')
    expect(transcript).not.toContain('+ Create instance')
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
