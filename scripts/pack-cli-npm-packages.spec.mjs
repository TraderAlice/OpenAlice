import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { packCliNpmPackages } from './pack-cli-npm-packages.mjs'

const temporaryPaths = []
const npmPackTimeoutMs = 30_000

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('CLI npm package packing', () => {
  it('packs platform packages before the meta package and records integrity', async () => {
    const root = await fixture()
    const output = join(root, 'output')
    const report = packCliNpmPackages({ inputDir: join(root, 'input'), outputDir: output })

    expect(report.publishOrder).toEqual([
      'openalice-darwin-arm64',
      'openalice-linux-x64',
      'openalice',
    ])
    expect(report.packages.every((item) => item.integrity.startsWith('sha512-'))).toBe(true)
    expect(JSON.parse(await readFile(join(output, 'npm-publish-order.json'), 'utf8')))
      .toEqual(report)
  }, npmPackTimeoutMs)

  it('rejects a platform version that diverges from the meta package', async () => {
    const root = await fixture({ platformVersion: '0.90.0' })
    expect(() => packCliNpmPackages({
      inputDir: join(root, 'input'),
      outputDir: join(root, 'output'),
    })).toThrow('platform package does not match')
  })
})

async function fixture({ platformVersion = '0.90.1' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'openalice-npm-pack-'))
  temporaryPaths.push(root)
  const input = join(root, 'input')
  await packageFixture(input, 'openalice-darwin-arm64', platformVersion)
  await packageFixture(input, 'openalice-linux-x64', platformVersion)
  await packageFixture(input, 'openalice', '0.90.1', {
    optionalDependencies: {
      'openalice-darwin-arm64': '0.90.1',
      'openalice-linux-x64': '0.90.1',
    },
  })
  return root
}

async function packageFixture(input, name, version, extra = {}) {
  const root = join(input, name)
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'package.json'), `${JSON.stringify({
    name,
    version,
    files: ['payload.txt'],
    ...extra,
  })}\n`)
  await writeFile(join(root, 'payload.txt'), `${name}\n`)
}
