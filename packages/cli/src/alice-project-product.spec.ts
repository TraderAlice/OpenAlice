import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  aliceProjectProductStampPath,
  readAliceProjectProduct,
  writeAliceProjectProductStamp,
} from './alice-project-product.ts'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('standalone CLI AliceProject product stamp', () => {
  it('publishes exactly one concurrent birth product', async () => {
    const home = await mkdtemp(join(tmpdir(), 'openalice-cli-product-race-'))
    temporary.push(home)
    const results = await Promise.all([
      writeAliceProjectProductStamp(home, 'trader'),
      writeAliceProjectProductStamp(home, 'nano'),
    ])
    const stored = await readAliceProjectProduct(home)
    expect(results).toEqual([stored, stored])
  })

  it('does not reinterpret or replace a malformed existing stamp', async () => {
    const home = await mkdtemp(join(tmpdir(), 'openalice-cli-product-bad-'))
    temporary.push(home)
    await mkdir(join(home, 'data', 'config'), { recursive: true })
    await writeFile(aliceProjectProductStampPath(home), '{ "product": "office" }\n')
    await expect(readAliceProjectProduct(home)).rejects.toThrow(
      /Invalid AliceProject product stamp/,
    )
    await expect(writeAliceProjectProductStamp(home, 'trader')).rejects.toThrow(
      /Invalid AliceProject product stamp/,
    )
  })
})
