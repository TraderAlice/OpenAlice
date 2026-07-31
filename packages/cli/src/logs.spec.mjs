import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  discoverRuntimeLogs,
  readRuntimeLogs,
  redactRuntimeLog,
} from './logs.mjs'

const temporaryPaths = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('Runtime log reader', () => {
  it('reads rotations in chronological order and returns a bounded tail', async () => {
    const home = await makeTempDir()
    const logs = join(home, 'logs')
    await mkdir(logs)
    await writeFile(join(logs, 'server.log.2'), 'oldest\nolder\n')
    await writeFile(join(logs, 'server.log.1'), 'previous\n')
    await writeFile(join(logs, 'server.log'), 'current one\ncurrent two\n')
    await writeFile(join(logs, 'other.log'), 'ignored\n')

    const result = await readRuntimeLogs({ homeRoot: home, lines: 3 })
    expect(result.files.map((file) => file.name)).toEqual([
      'server.log.2',
      'server.log.1',
      'server.log',
    ])
    expect(result.entries).toEqual([
      { file: 'server.log.1', text: 'previous' },
      { file: 'server.log', text: 'current one' },
      { file: 'server.log', text: 'current two' },
    ])
    expect(result.truncated).toBe(true)
  })

  it('redacts labeled secrets, bearer tokens, secret query values, and the first-run token block', () => {
    const output = redactRuntimeLog(`authorization: Bearer abcdefghijklmnop
api_key=super-secret-value
url=https://example.test/?token=secret-token&ok=1
First-run admin token (save this):

    standalone-admin-token-value
provider=sk-abcdefghijklmnop
unsafe=\u001b[31mred`)

    expect(output).not.toContain('abcdefghijklmnop')
    expect(output).not.toContain('super-secret-value')
    expect(output).not.toContain('secret-token')
    expect(output).not.toContain('standalone-admin-token-value')
    expect(output).toContain('[REDACTED]')
    expect(output).toContain('&ok=1')
    expect(output).not.toContain('\u001b')
    expect(output).toContain('\\x1b[31mred')
  })

  it('ignores symlinked log files and rejects a symlinked log directory', async () => {
    if (process.platform === 'win32') return
    const home = await makeTempDir()
    const outside = await makeTempDir()
    await mkdir(join(home, 'logs'))
    await writeFile(join(outside, 'secret'), 'token=must-not-read')
    await symlink(join(outside, 'secret'), join(home, 'logs', 'server.log'))
    expect(await discoverRuntimeLogs(home)).toEqual([])

    const secondHome = await makeTempDir()
    await symlink(outside, join(secondHome, 'logs'))
    await expect(discoverRuntimeLogs(secondHome)).rejects.toMatchObject({ code: 'EUNSAFELOGPATH' })
  })
})

async function makeTempDir() {
  const path = await mkdtemp(join(tmpdir(), 'openalice-logs-test-'))
  temporaryPaths.push(path)
  return path
}
