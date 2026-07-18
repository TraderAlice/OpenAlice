import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { buildCliPath, buildSpawnEnv } from './spawn-env.js'

/**
 * Guards the precedence the git-identity injection leans on: per-workspace
 * GIT_* vars are passed as `extras`, and extras must win over anything the
 * parent env leaked (e.g. a host ~/.gitconfig identity exported into the
 * shell). If a refactor stopped letting extras override the parent, workspace
 * commits would silently self-attribute to the host instead.
 */
describe('buildSpawnEnv', () => {
  it('passes extras through and they WIN over a colliding parent var', () => {
    const out = buildSpawnEnv(
      { GIT_AUTHOR_NAME: 'host-user', GIT_AUTHOR_EMAIL: 'host@example.com', KEEP: 'x' },
      { GIT_AUTHOR_NAME: 'Macro Research', GIT_AUTHOR_EMAIL: 'ws-1@workspace.local' },
    )
    // extras shadow the host-leaked identity
    expect(out['GIT_AUTHOR_NAME']).toBe('Macro Research')
    expect(out['GIT_AUTHOR_EMAIL']).toBe('ws-1@workspace.local')
    // non-colliding parent vars survive
    expect(out['KEEP']).toBe('x')
  })

  it('injects all four git identity vars when supplied as extras', () => {
    const out = buildSpawnEnv(
      {},
      {
        GIT_AUTHOR_NAME: 'tag',
        GIT_AUTHOR_EMAIL: 'id@workspace.local',
        GIT_COMMITTER_NAME: 'tag',
        GIT_COMMITTER_EMAIL: 'id@workspace.local',
      },
    )
    expect(out['GIT_AUTHOR_NAME']).toBe('tag')
    expect(out['GIT_COMMITTER_NAME']).toBe('tag')
    expect(out['GIT_AUTHOR_EMAIL']).toBe('id@workspace.local')
    expect(out['GIT_COMMITTER_EMAIL']).toBe('id@workspace.local')
  })

  it('overrides PWD to the spawn cwd when given', () => {
    const out = buildSpawnEnv({ PWD: '/somewhere/else' }, {}, '/ws/dir')
    expect(out['PWD']).toBe('/ws/dir')
  })

  it('emits one canonical PATH key after augmenting a Windows-style Path', () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-path-case-'))
    try {
      const shim = join(root, 'cli-bin')
      mkdirSync(shim, { recursive: true })

      const out = buildSpawnEnv(
        { Path: join(root, 'host-bin') },
        { OPENALICE_WORKSPACE_CLI_BIN_PATH: shim },
      )

      expect(Object.keys(out).filter((key) => key.toUpperCase() === 'PATH')).toEqual(['PATH'])
      expect(out['PATH'].split(delimiter)[0]).toBe(shim)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('strips launcher-owned tool/MCP and stale terminal color env from the parent', () => {
    const out = buildSpawnEnv(
      {
        OPENALICE_MCP_URL: 'http://stale/mcp',
        OPENALICE_TOOL_URL: 'http://stale/cli',
        OPENALICE_TOOL_SOCKET: '/tmp/stale.sock',
        OPENALICE_TERMINAL_THEME: 'light',
        COLORFGBG: '0;15',
        OPENCODE_CONFIG_CONTENT: '{"mcp":{"stale":true}}',
      },
      {
        OPENALICE_TOOL_URL: '/cli',
        OPENALICE_TOOL_SOCKET: '/tmp/current.sock',
      },
    )
    expect(out['OPENALICE_MCP_URL']).toBeUndefined()
    expect(out['OPENCODE_CONFIG_CONTENT']).toBeUndefined()
    expect(out['OPENALICE_TOOL_URL']).toBe('/cli')
    expect(out['OPENALICE_TOOL_SOCKET']).toBe('/tmp/current.sock')
    expect(out['OPENALICE_TERMINAL_THEME']).toBeUndefined()
    expect(out['COLORFGBG']).toBeUndefined()
  })

  it('defaults terminal locale to UTF-8 without overriding explicit locale', () => {
    expect(buildSpawnEnv({})['LANG']).toBe('en_US.UTF-8')
    expect(buildSpawnEnv({})['LC_CTYPE']).toBe('en_US.UTF-8')

    const explicit = buildSpawnEnv({ LANG: 'zh_CN.UTF-8', LC_CTYPE: 'zh_CN.UTF-8' })
    expect(explicit['LANG']).toBe('zh_CN.UTF-8')
    expect(explicit['LC_CTYPE']).toBe('zh_CN.UTF-8')

    const lcAll = buildSpawnEnv({ LC_ALL: 'C.UTF-8' })
    expect(lcAll['LC_CTYPE']).toBeUndefined()
  })

  it('drops inherited color-disable switches without erasing explicit color preferences', () => {
    const inherited = buildSpawnEnv({
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      CLICOLOR: '0',
    })
    expect(inherited['NO_COLOR']).toBeUndefined()
    expect(inherited['FORCE_COLOR']).toBeUndefined()
    expect(inherited['CLICOLOR']).toBeUndefined()

    const enabled = buildSpawnEnv({ FORCE_COLOR: '3', CLICOLOR: '1' })
    expect(enabled['FORCE_COLOR']).toBe('3')
    expect(enabled['CLICOLOR']).toBe('1')

    const explicit = buildSpawnEnv(
      { NO_COLOR: '1', FORCE_COLOR: '0', CLICOLOR: '0' },
      { FORCE_COLOR: '2', CLICOLOR: '1' },
    )
    expect(explicit['NO_COLOR']).toBeUndefined()
    expect(explicit['FORCE_COLOR']).toBe('2')
    expect(explicit['CLICOLOR']).toBe('1')
  })

  it.skipIf(process.platform === 'win32')('adds common user CLI bins missing from GUI app PATH', () => {
    const home = mkdtempSync(join(tmpdir(), 'openalice-home-'))
    try {
      const localBin = join(home, '.local/bin')
      const pnpmHome = join(home, 'Library/pnpm')
      mkdirSync(localBin, { recursive: true })
      mkdirSync(pnpmHome, { recursive: true })

      const path = buildCliPath({ HOME: home, PATH: '/usr/bin:/bin' })
        .split(delimiter)

      expect(path).toContain(localBin)
      expect(path).toContain(pnpmHome)
      expect(path).toContain('/usr/bin')
      expect(path).toContain('/bin')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('honors OPENALICE_EXTRA_AGENT_PATH for custom CLI installs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'openalice-agent-bin-'))
    try {
      const path = buildCliPath({
        HOME: tmpdir(),
        PATH: '/usr/bin:/bin',
        OPENALICE_EXTRA_AGENT_PATH: dir,
      }).split(delimiter)

      expect(path[0]).toBe(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prepends OpenAlice shim, managed Pi, then managed toolchain paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-managed-runtime-'))
    try {
      const shim = join(root, 'cli-bin')
      const piDir = join(root, 'pi')
      const pi = join(piDir, 'pi')
      const toolBin = join(root, 'tool-bin')
      mkdirSync(shim, { recursive: true })
      mkdirSync(piDir, { recursive: true })
      mkdirSync(toolBin, { recursive: true })
      writeFileSync(pi, '')

      const path = buildCliPath({
        HOME: tmpdir(),
        PATH: '/usr/bin:/bin',
        OPENALICE_WORKSPACE_CLI_BIN_PATH: shim,
        OPENALICE_MANAGED_PI_PATH: pi,
        OPENALICE_MANAGED_TOOLCHAIN_PATH: toolBin,
      }).split(delimiter)

      expect(path.slice(0, 3)).toEqual([shim, piDir, toolBin])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not add the managed Pi npm cli directory to PATH', () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-managed-pi-npm-'))
    try {
      const shim = join(root, 'cli-bin')
      const piDist = join(root, 'vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist')
      const piCli = join(piDist, 'cli.js')
      const toolBin = join(root, 'tool-bin')
      mkdirSync(shim, { recursive: true })
      mkdirSync(piDist, { recursive: true })
      mkdirSync(toolBin, { recursive: true })
      writeFileSync(piCli, '')

      const path = buildCliPath({
        HOME: tmpdir(),
        PATH: '/usr/bin:/bin',
        OPENALICE_WORKSPACE_CLI_BIN_PATH: shim,
        OPENALICE_MANAGED_PI_PATH: piCli,
        OPENALICE_MANAGED_PI_NODE_PATH: '/Applications/OpenAlice.app/Contents/MacOS/OpenAlice',
        OPENALICE_MANAGED_TOOLCHAIN_PATH: toolBin,
      }).split(delimiter)

      expect(path.slice(0, 2)).toEqual([shim, toolBin])
      expect(path).not.toContain(piDist)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('augments an explicit PATH override from spawn extras', () => {
    const home = mkdtempSync(join(tmpdir(), 'openalice-home-'))
    try {
      const localBin = join(home, '.local/bin')
      mkdirSync(localBin, { recursive: true })

      const out = buildSpawnEnv(
        { HOME: home, PATH: '/usr/bin:/bin' },
        { PATH: '/app/cli-bin:/usr/bin:/bin' },
      )
      const path = out['PATH'].split(delimiter)

      expect(path).toContain('/app/cli-bin')
      expect(path).toContain(localBin)
      expect(path).toContain('/usr/bin')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
