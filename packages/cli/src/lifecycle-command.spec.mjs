import { join, resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  formatLifecycleHelp,
  formatRootHelp,
  formatShellCompletion,
  parseLifecycleArgs,
  runLifecycleCommand,
} from './lifecycle-command.mjs'

describe('OpenAlice top-level lifecycle commands', () => {
  it('parses background startup independently from browser opening', () => {
    expect(parseLifecycleArgs('up', [
      '/tmp/OpenAlice',
      '--instance', 'research',
      '--home', '/tmp/alice-home',
      '--port', '41000',
      '--log', '/tmp/openalice.log',
      '--wait', '15',
      '--open',
      '--json',
    ])).toEqual(expect.objectContaining({
      appDir: '/tmp/OpenAlice',
      instance: 'research',
      homeRoot: '/tmp/alice-home',
      port: 41000,
      logFile: '/tmp/openalice.log',
      waitMs: 15_000,
      openBrowser: true,
      json: true,
    }))
    expect(parseLifecycleArgs('up', [])).toEqual(expect.objectContaining({
      openBrowser: false,
      json: false,
    }))
  })

  it('keeps foreground run non-JSON and browserless', () => {
    expect(parseLifecycleArgs('run', ['--home', '/tmp/alice-home'])).toEqual(expect.objectContaining({
      homeRoot: '/tmp/alice-home',
      openBrowser: false,
      json: false,
    }))
    expect(() => parseLifecycleArgs('run', ['--open'])).toThrow('does not support --open')
    expect(() => parseLifecycleArgs('run', ['--json'])).toThrow('does not support --json')
  })

  it('uses explicit control timeouts and exit-code-2 usage errors', () => {
    expect(parseLifecycleArgs('status', ['--home', '/tmp/alice-home', '--wait', '3', '--json'])).toEqual({
      instance: null,
      homeRoot: '/tmp/alice-home',
      json: true,
      waitMs: 3_000,
    })
    expect(parseLifecycleArgs('down', [])).toEqual({
      instance: null,
      homeRoot: null,
      json: false,
      waitMs: 15_000,
    })
    expect(() => parseLifecycleArgs('open', ['--json'])).toThrow(expect.objectContaining({
      code: 'EUSAGE',
      exitCode: 2,
    }))
  })

  it('prints a stable success envelope for status', async () => {
    const stdout = output()
    await expect(runLifecycleCommand('status', parseLifecycleArgs('status', ['--json']), {
      inspectRuntime: async () => runningStatus(),
      stdout,
    })).resolves.toBe(0)
    expect(JSON.parse(stdout.text())).toEqual({
      schemaVersion: 1,
      command: 'status',
      ok: true,
      result: { status: runningStatus() },
    })
  })

  it('prints a stable error envelope and returns the lifecycle exit code', async () => {
    const stderr = output()
    const failure = new Error('Runtime is owned elsewhere')
    failure.code = 'EOWNED'
    failure.exitCode = 4
    await expect(runLifecycleCommand('down', parseLifecycleArgs('down', ['--json']), {
      stopRuntime: async () => { throw failure },
      stderr,
      stdout: output(),
    })).resolves.toBe(4)
    expect(JSON.parse(stderr.text())).toEqual({
      schemaVersion: 1,
      command: 'down',
      ok: false,
      error: {
        code: 'EOWNED',
        message: 'Runtime is owned elsewhere',
      },
    })
  })

  it('presents structured background readiness and optional browser opening', async () => {
    const stdout = output()
    const startRuntime = vi.fn(async (_options, dependencies) => {
      const result = startedResult()
      dependencies.emit({ type: 'ready', result })
      return result
    })
    const openRuntime = vi.fn(async () => ({
      opened: true,
      url: runningStatus().endpoints.web,
      status: runningStatus(),
    }))
    await expect(runLifecycleCommand('up', parseLifecycleArgs('up', ['--open']), {
      startRuntime,
      openRuntime,
      stdout,
    })).resolves.toBe(0)
    expect(stdout.text()).toContain('OpenAlice Runtime:')
    expect(stdout.text()).toContain('keep running')
    expect(stdout.text()).toContain('Opened OpenAlice Web UI')
    expect(openRuntime).toHaveBeenCalledOnce()
  })

  it('shares named-home and managed-Pi isolation with noninteractive startup', async () => {
    const startRuntime = vi.fn(async () => startedResult())
    await expect(runLifecycleCommand('up', parseLifecycleArgs('up', [
      '--instance', 'research',
      '--home', '/tmp/research-home',
    ]), {
      env: {
        OPENALICE_MANAGED_PI_PATH: '/managed/pi/cli.js',
        PI_CODING_AGENT_DIR: '/native/pi',
      },
      startRuntime,
      stdout: output(),
    })).resolves.toBe(0)

    expect(startRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        instance: 'research',
        homeRoot: resolve('/tmp/research-home'),
      }),
      expect.objectContaining({
        env: expect.objectContaining({
          PI_CODING_AGENT_DIR: join(resolve('/tmp/research-home'), 'runtime', 'pi'),
          PI_CODING_AGENT_SESSION_DIR: join(resolve('/tmp/research-home'), 'runtime', 'pi', 'sessions'),
        }),
      }),
    )
  })

  it('loads a TUI-registered named home for explicit lifecycle commands', async () => {
    const inspectRuntime = vi.fn(async () => absentStatus())
    await expect(runLifecycleCommand(
      'status',
      parseLifecycleArgs('status', ['--instance', 'research']),
      {
        env: {},
        homeDir: '/home/alice',
        platform: 'linux',
        readSupervisorConfig: async () => ({
          schemaVersion: 1,
          instances: {
            research: {
              name: 'research',
              home: '/srv/openalice-research',
            },
          },
        }),
        checkStoredHome: async () => {},
        inspectRuntime,
        stdout: output(),
      },
    )).resolves.toBe(0)

    expect(inspectRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        instance: 'research',
        homeRoot: resolve('/srv/openalice-research'),
      }),
      expect.any(Object),
    )
  })

  it('inherits stored start settings and leaves an unconfigured Web port automatic', async () => {
    const automaticStart = vi.fn(async () => startedResult())
    await expect(runLifecycleCommand(
      'up',
      parseLifecycleArgs('up', []),
      {
        env: {},
        homeDir: '/home/alice',
        platform: 'linux',
        readSupervisorConfig: async () => ({ schemaVersion: 1 }),
        startRuntime: automaticStart,
        stdout: output(),
      },
    )).resolves.toBe(0)
    expect(automaticStart).toHaveBeenCalledWith(
      expect.objectContaining({
        appDir: null,
        homeRoot: join('/home/alice', '.openalice'),
        port: undefined,
        checkUpdates: true,
      }),
      expect.any(Object),
    )

    const configuredStart = vi.fn(async () => startedResult())
    await expect(runLifecycleCommand(
      'up',
      parseLifecycleArgs('up', ['--instance', 'research']),
      {
        env: {},
        homeDir: '/home/alice',
        platform: 'linux',
        readSupervisorConfig: async () => ({
          schemaVersion: 1,
          instances: {
            research: {
              name: 'research',
              home: '/srv/openalice-research',
              appDir: '/srv/OpenAlice',
              port: 49_001,
              updateChecks: false,
            },
          },
        }),
        checkStoredHome: async () => {},
        startRuntime: configuredStart,
        stdout: output(),
      },
    )).resolves.toBe(0)
    expect(configuredStart).toHaveBeenCalledWith(
      expect.objectContaining({
        appDir: resolve('/srv/OpenAlice'),
        homeRoot: resolve('/srv/openalice-research'),
        port: 49_001,
        checkUpdates: false,
      }),
      expect.any(Object),
    )
  })

  it('does not redirect external Pi during source lifecycle commands', async () => {
    const inspectRuntime = vi.fn(async () => absentStatus())
    await expect(runLifecycleCommand('status', parseLifecycleArgs('status', [
      '--home', '/tmp/source-home',
    ]), {
      env: { PI_CODING_AGENT_DIR: '/native/pi' },
      inspectRuntime,
      stdout: output(),
    })).resolves.toBe(0)

    expect(inspectRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ homeRoot: resolve('/tmp/source-home') }),
      expect.objectContaining({
        env: expect.objectContaining({ PI_CODING_AGENT_DIR: '/native/pi' }),
      }),
    )
  })

  it('keeps already-absent down idempotent', async () => {
    const stdout = output()
    await expect(runLifecycleCommand('down', parseLifecycleArgs('down', []), {
      stopRuntime: async () => ({ stopped: false, status: absentStatus() }),
      stdout,
    })).resolves.toBe(0)
    expect(stdout.text()).toContain('is not running')
  })

  it('generates root help and four shell completions from one command registry', () => {
    const help = formatRootHelp()
    for (const command of ['up', 'run', 'down', 'status', 'logs', 'doctor', 'open', 'completion']) {
      expect(help).toContain(command)
    }
    expect(formatLifecycleHelp('up')).toContain('installed OpenAlice Runtime in the background')
    expect(formatLifecycleHelp('run')).toContain('foreground')
    expect(formatShellCompletion('bash')).toContain('complete -F _openalice_completion openalice')
    expect(formatShellCompletion('zsh')).toContain('#compdef openalice')
    expect(formatShellCompletion('fish')).toContain('complete -c openalice')
    expect(formatShellCompletion('powershell')).toContain('Register-ArgumentCompleter')
    expect(() => formatShellCompletion('tcsh')).toThrow(expect.objectContaining({
      code: 'EUSAGE',
      exitCode: 2,
    }))
  })
})

function output() {
  let value = ''
  return {
    write(chunk) {
      value += String(chunk)
    },
    text() {
      return value
    },
  }
}

function startedResult() {
  return {
    outcome: 'started',
    mode: 'detached',
    appDir: '/tmp/OpenAlice',
    homeRoot: '/tmp/alice-home',
    logPath: '/tmp/alice-home/logs/server.log',
    status: runningStatus(),
  }
}

function runningStatus() {
  return {
    protocol: 1,
    class: 'running',
    runtimeVersion: '0.87.0-beta',
    state: 'running',
    home: '/tmp/alice-home',
    owner: { surface: 'cli-server', pid: 123, instanceId: 'test', mode: 'detached' },
    endpoints: { web: 'http://127.0.0.1:41000' },
    components: { alice: 'ready', uta: 'disabled', connector: 'disabled' },
    capabilities: ['runtime.stop'],
  }
}

function absentStatus() {
  return {
    protocol: 1,
    class: 'absent',
    state: 'absent',
    home: '/tmp/alice-home',
    owner: null,
    endpoints: {},
    components: {},
    capabilities: [],
  }
}
