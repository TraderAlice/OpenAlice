import { it, expect } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publishCliEndpoint } from './cli-endpoint.js'

it('old owners cannot remove a replacement endpoint; current owner cleans up', async () => {
  const home = await mkdtemp(join(tmpdir(), 'oa-cli-endpoint-'))
  try {
    const old = await publishCliEndpoint('http://127.0.0.1:1/cli', undefined, home)
    const current = await publishCliEndpoint('http://127.0.0.1:2/cli', undefined, home)
    const path = join(home, 'state', 'cli-endpoint.json')
    await old()
    expect(JSON.parse(await readFile(path, 'utf8')).url).toBe('http://127.0.0.1:2/cli')
    await current()
    await expect(readFile(path)).rejects.toThrow()
  } finally { await rm(home, { recursive: true, force: true }) }
})
it('damaged discovery state cannot stop Runtime shutdown', async () => {
  const home = await mkdtemp(join(tmpdir(), 'oa-cli-endpoint-'))
  try {
    const cleanup = await publishCliEndpoint('/cli', '/tmp/fixture.sock', home)
    await writeFile(join(home, 'state', 'cli-endpoint.json'), 'broken')
    await expect(cleanup()).resolves.toBeUndefined()
  } finally { await rm(home, { recursive: true, force: true }) }
})
