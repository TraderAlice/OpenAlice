import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath, symlink } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { buildDesktopPackagedSmokePlan, desktopSmokeStateEnv } from '../../../scripts/desktop-packaged-smoke-plan.mjs'
import { piAdapter, syncPiProjectTrust } from '../../../src/workspaces/adapters/pi.js'
import { buildSpawnEnv } from '../../../src/workspaces/spawn-env.js'
import { ompAgentDir } from '../../../src/workspaces/adapters/omp.js'

it.each([[], ['--onboarding'], ['--workspace-acceptance'], ['--trading-mode']])('isolates native directory overrides and Pi trust/session access in temporary mode %j', async (...args) => {
  const parent = await mkdtemp(join(tmpdir(), 'oa-pi-sentinel-'))
  try {
    const sentinel = join(parent, 'inherited-pi')
    await mkdir(sentinel)
    await writeFile(join(sentinel, 'sentinel'), 'do not change')
    // Model a process-level override too: the adapter reads process.env.
    vi.stubEnv('PI_CODING_AGENT_SESSION_DIR', sentinel)
    const root = join(parent, 'smoke')
    const cwd = join(root, 'workspace')
    const target = join(root, 'workspace-target')
    await mkdir(target, { recursive: true })
    await symlink(target, cwd, process.platform === 'win32' ? 'junction' : 'dir')
    const plan = buildDesktopPackagedSmokePlan(args, {})
    expect(plan.options.tempData).toBe(true)
    const inherited = {
      PI_CODING_AGENT_DIR: sentinel, PI_CODING_AGENT_SESSION_DIR: sentinel,
      CODEX_HOME: sentinel, CLAUDE_CONFIG_DIR: sentinel,
      CURSOR_DATA_DIR: sentinel, GROK_HOME: sentinel,
      OPENAI_API_KEY: 'sentinel-not-a-real-key', ANTHROPIC_API_KEY: 'sentinel-not-a-real-key',
      ANTHROPIC_AUTH_TOKEN: 'sentinel-not-a-real-token', AWS_ACCESS_KEY_ID: 'sentinel-not-a-real-key',
      OPENAI_BASE_URL: 'http://127.0.0.1:1/forbidden', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1/forbidden',
      OPENCODE_CONFIG: join(sentinel, 'config.json'), NODE_OPTIONS: '--require=forbidden',
      PATH: process.env.PATH, DISPLAY: ':sentinel',
      OMP_PROFILE: '../../inherited-pi', PI_PROFILE: '../../inherited-pi', PI_CONFIG_DIR: '../inherited-pi',
    }
    const env = buildSpawnEnv(desktopSmokeStateEnv(root, inherited), {}, cwd)
    expect(env.PI_CODING_AGENT_SESSION_DIR).toBeUndefined()
    for (const [key, dir] of [['CODEX_HOME', 'codex'], ['CLAUDE_CONFIG_DIR', 'claude'], ['CURSOR_DATA_DIR', 'cursor'], ['GROK_HOME', 'grok']]) {
      expect(env[key]).toBe(join(root, dir))
    }
    const blocked = ['PI_CODING_AGENT_SESSION_DIR', 'OMP_PROFILE', 'PI_PROFILE', 'PI_CONFIG_DIR', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'AWS_ACCESS_KEY_ID', 'OPENAI_BASE_URL', 'ANTHROPIC_BASE_URL', 'OPENCODE_CONFIG', 'NODE_OPTIONS']
    for (const key of blocked) {
      expect(env[key]).toBeUndefined()
    }
    expect(env.DISPLAY).toBe(':sentinel')
    const child = await promisify(execFile)(process.execPath, ['-e',
      `process.stdout.write(JSON.stringify(${JSON.stringify(blocked)}.map(key => Object.hasOwn(process.env, key))))`,
    ], { cwd, env })
    expect(JSON.parse(child.stdout)).toEqual(blocked.map(() => false))
    expect(ompAgentDir(env)).toBe(env.PI_CODING_AGENT_DIR)
    await syncPiProjectTrust(cwd, env)
    expect(await readdir(sentinel)).toEqual(['sentinel'])
    expect(await readFile(join(sentinel, 'sentinel'), 'utf8')).toBe('do not change')
    const files = await readdir(env.PI_CODING_AGENT_DIR)
    expect(files.length).toBe(1)
    expect(JSON.parse(await readFile(join(env.PI_CODING_AGENT_DIR, files[0]), 'utf8'))).toEqual({ [await realpath(cwd)]: true })
    const sessionId = '00000000-0000-4000-8000-000000000001'
    // Trust uses the canonical path; Pi's session bucket uses the lexical
    // absolute path. The symlink fixture deliberately keeps them different.
    const sessionDir = join(env.PI_CODING_AGENT_DIR, 'sessions', `--${resolve(cwd).replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`)
    await mkdir(sessionDir, { recursive: true })
    await writeFile(join(sessionDir, `owned_${sessionId}.jsonl`), JSON.stringify({ type: 'session_info', name: 'owned session' }) + '\n')
    for (const key of blocked) vi.stubEnv(key, undefined)
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    expect(await piAdapter.readSessionTitle!(cwd, sessionId)).toBe('owned session')
    expect(await readdir(sentinel)).toEqual(['sentinel'])
  } finally { vi.unstubAllEnvs(); await rm(parent, { recursive: true, force: true }) }
})
