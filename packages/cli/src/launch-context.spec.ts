import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildManagedPiEnv,
  parseTuiLaunchArgs,
  resolveLaunchContext,
} from './launch-context.ts'

describe('ResolvedLaunchContext', () => {
  it('resolves defaults < machine < instance < env < CLI with field provenance', () => {
    const context = resolveLaunchContext({
      homeDir: '/Users/alice',
      cwd: '/repo',
      platform: 'darwin',
      machineConfig: {
        defaultInstance: 'desk',
        defaults: {
          home: '/machine-home',
          port: 41_000,
          appDir: '/machine-app',
          updateChecks: false,
        },
      },
      instanceConfig: {
        name: 'desk',
        home: '/instance-home',
        port: 42_000,
        appDir: '/instance-app',
        updateChecks: true,
      },
      env: {
        OPENALICE_HOME: '/env-home',
        OPENALICE_WEB_PORT: '43000',
        OPENALICE_APP_HOME: '/env-app',
        OPENALICE_NO_UPDATE_CHECK: '1',
      },
      flags: {
        instance: 'desk',
        home: './flag-home',
        port: 44_000,
        appDir: './flag-app',
        updateChecks: true,
      },
    })

    expect(context).toMatchObject({
      instance: 'desk',
      home: resolve('/repo', 'flag-home'),
      port: 44_000,
      appDir: resolve('/repo', 'flag-app'),
      updateChecks: true,
      supervisorRoot: join('/Users/alice', 'Library', 'Application Support', 'OpenAlice', 'Supervisor'),
      managedPi: {
        codingAgentDir: join(resolve('/repo', 'flag-home'), 'runtime', 'pi'),
        sessionDir: join(resolve('/repo', 'flag-home'), 'runtime', 'pi', 'sessions'),
      },
      provenance: {
        instance: { source: 'cli-flag', detail: '--instance' },
        home: { source: 'cli-flag', detail: '--home' },
        port: { source: 'cli-flag', detail: '--port' },
        appDir: { source: 'cli-flag', detail: '--app-dir' },
        updateChecks: { source: 'cli-flag', detail: '--update-check' },
      },
    })
    expect(Object.isFrozen(context)).toBe(true)
    expect(Object.isFrozen(context.provenance)).toBe(true)
  })

  it('uses environment values above both configuration layers', () => {
    const context = resolveLaunchContext({
      homeDir: '/home/alice',
      cwd: '/repo',
      platform: 'linux',
      machineConfig: {
        defaultInstance: 'research',
        defaults: { port: 41_000, updateChecks: true },
      },
      instanceConfig: {
        name: 'research',
        home: '/instance-home',
        port: 42_000,
        updateChecks: true,
      },
      env: {
        OPENALICE_INSTANCE: 'research',
        OPENALICE_HOME: '~/env-home',
        OPENALICE_WEB_PORT: '43000',
        OPENALICE_NO_UPDATE_CHECK: 'true',
        XDG_CONFIG_HOME: '/xdg',
      },
    })

    expect(context.home).toBe(resolve('/home/alice', 'env-home'))
    expect(context.port).toBe(43_000)
    expect(context.updateChecks).toBe(false)
    expect(context.supervisorRoot).toBe(join(resolve('/xdg'), 'openalice'))
    expect(context.provenance.home.detail).toBe('OPENALICE_HOME')
  })

  it('uses the installed Runtime below stored and explicit source overrides', () => {
    const installed = resolveLaunchContext({
      homeDir: '/home/alice',
      cwd: '/repo',
      platform: 'linux',
      env: {
        OPENALICE_MANAGED_RUNTIME_PATH: '/installed/runtime',
        OPENALICE_MANAGED_RUNTIME_CONTENT_IDENTITY: '0123456789abcdef',
      },
    })

    expect(installed.appDir).toBe(resolve('/installed/runtime'))
    expect(installed.runtimeProvider).toEqual({
      kind: 'bundle',
      contentIdentity: '0123456789abcdef',
    })
    expect(installed.provenance.appDir).toEqual({
      source: 'installed-runtime',
      detail: 'installed OpenAlice Runtime',
    })

    const configured = resolveLaunchContext({
      homeDir: '/home/alice',
      cwd: '/repo',
      platform: 'linux',
      machineConfig: { defaults: { appDir: '/configured/source' } },
      env: {
        OPENALICE_MANAGED_RUNTIME_PATH: '/installed/runtime',
        OPENALICE_MANAGED_RUNTIME_CONTENT_IDENTITY: '0123456789abcdef',
      },
    })
    expect(configured.appDir).toBe(resolve('/configured/source'))
    expect(configured.runtimeProvider).toEqual({
      kind: 'source',
      contentIdentity: null,
    })
  })

  it('refuses an installed Runtime without its paired content identity', () => {
    expect(() => resolveLaunchContext({
      env: {
        OPENALICE_MANAGED_RUNTIME_PATH: '/installed/runtime',
      },
    })).toThrow(/CONTENT_IDENTITY/)
  })

  it('requires a complete home for a named non-default instance', () => {
    expect(() => resolveLaunchContext({
      homeDir: '/home/alice',
      env: { OPENALICE_INSTANCE: 'research' },
    })).toThrow(/needs an explicit complete home/)
    expect(() => resolveLaunchContext({
      homeDir: '/home/alice',
      machineConfig: {
        defaultInstance: 'research',
        defaults: { home: '/shared-machine-home' },
      },
      instanceConfig: { name: 'research' },
      env: {},
    })).toThrow(/needs an explicit complete home/)
  })

  it('rejects malformed instance, port, and boolean environment values', () => {
    expect(() => resolveLaunchContext({
      env: { OPENALICE_INSTANCE: '../escape', OPENALICE_HOME: '/tmp/home' },
    })).toThrow(/Invalid OpenAlice instance/)
    expect(() => resolveLaunchContext({
      env: { OPENALICE_WEB_PORT: 'nope' },
    })).toThrow(/integer between 1 and 65535/)
    expect(() => resolveLaunchContext({
      env: { OPENALICE_NO_UPDATE_CHECK: 'sometimes' },
    })).toThrow(/must be one of/)
  })

  it('projects instance-private Pi roots without mutating the caller environment', () => {
    const base = {
      PATH: '/bin',
      OPENALICE_MANAGED_PI_PATH: '/managed/pi/cli.js',
      PI_CODING_AGENT_DIR: '/native/pi',
    }
    const context = resolveLaunchContext({
      homeDir: '/home/alice',
      env: {},
    })

    const managed = buildManagedPiEnv(context, base)

    expect(base.PI_CODING_AGENT_DIR).toBe('/native/pi')
    expect(managed).toMatchObject({
      PATH: '/bin',
      PI_CODING_AGENT_DIR: join('/home/alice', '.openalice', 'runtime', 'pi'),
      PI_CODING_AGENT_SESSION_DIR: join('/home/alice', '.openalice', 'runtime', 'pi', 'sessions'),
    })
  })

  it('preserves native Pi state when the Runtime has no managed Pi', () => {
    const context = resolveLaunchContext({
      homeDir: '/home/alice',
      env: {},
    })

    expect(buildManagedPiEnv(context, {
      PATH: '/bin',
      PI_CODING_AGENT_DIR: '/native/pi',
      PI_CODING_AGENT_SESSION_DIR: '/native/pi/sessions',
    })).toEqual({
      PATH: '/bin',
      PI_CODING_AGENT_DIR: '/native/pi',
      PI_CODING_AGENT_SESSION_DIR: '/native/pi/sessions',
    })
  })
})

describe('TUI launch flags', () => {
  it('parses the launch-affecting flags before terminal startup', () => {
    expect(parseTuiLaunchArgs([
      '--instance', 'research',
      '--home', './state',
      '--port', '44000',
      '--app-dir', './checkout',
      '--no-update-check',
    ])).toEqual({
      instance: 'research',
      home: './state',
      port: 44_000,
      appDir: './checkout',
      updateChecks: false,
    })
  })

  it('rejects unknown flags before terminal startup', () => {
    expect(() => parseTuiLaunchArgs(['--wat'])).toThrow(/Unknown TUI option/)
  })
})
