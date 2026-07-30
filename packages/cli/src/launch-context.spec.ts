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
      home: '/repo/flag-home',
      port: 44_000,
      appDir: '/repo/flag-app',
      updateChecks: true,
      supervisorRoot: '/Users/alice/Library/Application Support/OpenAlice/Supervisor',
      managedPi: {
        codingAgentDir: '/repo/flag-home/runtime/pi',
        sessionDir: '/repo/flag-home/runtime/pi/sessions',
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

    expect(context.home).toBe('/home/alice/env-home')
    expect(context.port).toBe(43_000)
    expect(context.updateChecks).toBe(false)
    expect(context.supervisorRoot).toBe('/xdg/openalice')
    expect(context.provenance.home.detail).toBe('OPENALICE_HOME')
  })

  it('requires a complete home for a named non-default instance', () => {
    expect(() => resolveLaunchContext({
      homeDir: '/home/alice',
      env: { OPENALICE_INSTANCE: 'research' },
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
      PI_CODING_AGENT_DIR: '/home/alice/.openalice/runtime/pi',
      PI_CODING_AGENT_SESSION_DIR: '/home/alice/.openalice/runtime/pi/sessions',
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
