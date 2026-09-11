import { afterEach, describe, expect, it, vi } from 'vitest'
import { exec, execSystemGit } from './git-execution.js'
import { exec as bundledExec } from 'dugite'

vi.mock('dugite', () => ({ exec: vi.fn(async () => ({ stdout: 'bundled', stderr: '', exitCode: 0 })) }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('distribution-specific Git execution', () => {
  it('preserves dugite for Electron and source', async () => {
    vi.stubGlobal('__OPENALICE_BUN_STANDALONE__', false)
    expect((await exec(['--version'], process.cwd())).stdout).toBe('bundled')
    expect(bundledExec).toHaveBeenCalled()
  })

  it('uses the selected system executable for native CLI without dugite environment rewriting', async () => {
    vi.stubGlobal('__OPENALICE_BUN_STANDALONE__', true)
    const result = await exec(['-e', 'process.stdout.write(process.env.GIT_TEMPLATE_DIR)'], process.cwd(), {
      env: { OPENALICE_SYSTEM_GIT_PATH: process.execPath, GIT_TEMPLATE_DIR: '/user/templates' },
    })
    expect(result).toMatchObject({ stdout: '/user/templates', exitCode: 0 })
    expect(bundledExec).not.toHaveBeenCalled()
  })

  it('preserves nonzero exit status and stderr instead of throwing for Git failures', async () => {
    const result = await execSystemGit(['-e', 'process.stderr.write("failure");process.exit(7)'], process.cwd(), { env: { OPENALICE_SYSTEM_GIT_PATH: process.execPath } })
    expect(result).toEqual({ stdout: '', stderr: 'failure', exitCode: 7 })
  })

  it('preserves stdin, buffer encoding and process callback', async () => {
    const callback = vi.fn()
    const result = await execSystemGit(['-e', 'process.stdin.pipe(process.stdout)'], process.cwd(), {
      env: { OPENALICE_SYSTEM_GIT_PATH: process.execPath }, stdin: Buffer.from([0, 255, 7]), encoding: 'buffer', processCallback: callback,
    })
    expect(result.stdout).toEqual(Buffer.from([0, 255, 7]))
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('rejects spawn errors', async () => {
    await expect(execSystemGit([], process.cwd(), { env: { OPENALICE_SYSTEM_GIT_PATH: '/nonexistent/openalice-test-git' } })).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
