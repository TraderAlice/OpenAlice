import { access, mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createControlledStage, runManagedProcess } from './process.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function fixture(body: string): Promise<{ root: string; executablePath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'openalice-process-test-'))
  roots.push(root)
  const executablePath = join(root, 'fixture')
  await writeFile(executablePath, `#!/usr/bin/env node\n${body}`)
  await chmod(executablePath, 0o755)
  return { root, executablePath }
}

describe('managed generator process', () => {
  it('uses argv without a shell and streams complete stdout/stderr', async () => {
    const { root, executablePath } = await fixture(`
process.stdout.write(process.argv[2].repeat(200000))
process.stderr.write('diagnostic')
`)
    const stdoutPath = join(root, 'stdout')
    const stderrPath = join(root, 'stderr')
    const result = await runManagedProcess({
      executablePath, argv: ['$(touch should-not-exist)'], cwd: root, stdoutPath, stderrPath,
    })
    expect(result).toEqual({ kind: 'succeeded', exitCode: 0, signal: null })
    expect((await readFile(stdoutPath, 'utf8')).length).toBe('$(touch should-not-exist)'.length * 200000)
    expect(await readFile(stderrPath, 'utf8')).toBe('diagnostic')
    await expect(access(join(root, 'should-not-exist'))).rejects.toThrow()
  }, 15_000)

  it('returns typed nonzero and spawn failures', async () => {
    const { root, executablePath } = await fixture('process.exit(7)')
    await expect(runManagedProcess({
      executablePath, argv: [], cwd: root, stdoutPath: join(root, 'out'), stderrPath: join(root, 'err'),
    })).resolves.toEqual({ kind: 'nonzero', exitCode: 7, signal: null })
    await expect(runManagedProcess({
      executablePath: 'relative', argv: [], cwd: root, stdoutPath: join(root, 'out2'), stderrPath: join(root, 'err2'),
    })).resolves.toMatchObject({ kind: 'spawn-failed', code: 'EINVAL' })
  })

  it('cancels via the termination ladder and waits for close', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-process-test-'))
    roots.push(root)
    const executablePath = join(root, 'fixture')
    await writeFile(executablePath, '#!/bin/sh\ntrap "" TERM\nwhile true; do echo alive; sleep 0.01; done\n')
    await chmod(executablePath, 0o755)
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 200)
    const result = await runManagedProcess({
      executablePath, argv: [], cwd: root, stdoutPath: join(root, 'out'), stderrPath: join(root, 'err'),
      signal: controller.signal, killGraceMs: 30,
    })
    expect(result).toMatchObject({ kind: 'cancelled', exitCode: null })
    if (result.kind !== 'cancelled') throw new Error('expected cancellation')
    expect(['SIGTERM', 'SIGKILL']).toContain(result.signal)
  })

  it('offers idempotent controlled cleanup and rejects nested paths', async () => {
    const stage = await createControlledStage()
    expect(() => stage.path('../escape')).toThrow('basename')
    await writeFile(stage.path('image'), 'bytes')
    await stage.cleanup()
    await stage.cleanup()
    await expect(access(stage.directory)).rejects.toThrow()
  })
})
