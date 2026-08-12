import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  aliceProjectProductStampPath,
  readAliceProjectProduct,
  shouldSkipUtaForHome,
  writeAliceProjectProductStamp,
} from './alice-project-product.js'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('AliceProject product stamp', () => {
  it('treats a missing stamp as trader', async () => {
    const home = await mkdtemp(join(tmpdir(), 'alice-product-missing-'))
    temporary.push(home)
    expect(await readAliceProjectProduct(home)).toBe('trader')
    expect(await shouldSkipUtaForHome({}, home)).toEqual({ skip: false, reason: null })
  })

  it('writes a nano stamp once and refuses to rewrite it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'alice-product-nano-'))
    temporary.push(home)
    expect(await writeAliceProjectProductStamp(home, 'nano')).toBe('nano')
    expect(await writeAliceProjectProductStamp(home, 'trader')).toBe('nano')
    expect(JSON.parse(await readFile(aliceProjectProductStampPath(home), 'utf8'))).toEqual({
      version: 1,
      product: 'nano',
    })
    expect(await shouldSkipUtaForHome({}, home)).toEqual({ skip: true, reason: 'nano' })
  })

  it('keeps lite skip distinct from a trader home', async () => {
    const home = await mkdtemp(join(tmpdir(), 'alice-product-lite-'))
    temporary.push(home)
    await writeAliceProjectProductStamp(home, 'trader')
    expect(await shouldSkipUtaForHome({ OPENALICE_LITE_MODE: '1' }, home)).toEqual({
      skip: true,
      reason: 'lite',
    })
  })

  it('ignores a malformed stamp instead of failing startup', async () => {
    const home = await mkdtemp(join(tmpdir(), 'alice-product-bad-'))
    temporary.push(home)
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(home, 'data', 'config'), { recursive: true })
    await writeFile(aliceProjectProductStampPath(home), '{ "product": "office" }\n')
    expect(await readAliceProjectProduct(home)).toBe('trader')
  })
})
