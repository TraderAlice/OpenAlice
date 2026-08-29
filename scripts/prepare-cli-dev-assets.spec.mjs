import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import { prepareCliDevAssets } from './prepare-cli-dev-assets.mjs'

const execFileAsync = promisify(execFile)
const version = '0.90.1'
const commit = '0123456789abcdef0123456789abcdef01234567'
const temporaryPaths = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('CLI dev channel assets', () => {
  it('validates all four native candidates and preserves their exact archive bytes', async () => {
    const root = await fixture()
    const output = join(root, 'output')
    const manifest = prepareCliDevAssets({
      inputDir: join(root, 'input'),
      outputDir: output,
      commit,
      version,
    })

    expect(manifest.targets).toHaveLength(4)
    expect(manifest.targets.map(({ platform, arch }) => `${platform}-${arch}`).sort()).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'linux-arm64',
      'linux-x64',
    ])
    for (const target of manifest.targets) {
      const versioned = `openalice-cli-${version}-${target.platform}-${target.arch}.tar.gz`
      const alias = `openalice-cli-dev-${target.platform}-${target.arch}.tar.gz`
      expect(await readFile(join(output, 'releases', commit, versioned))).toEqual(
        await readFile(join(output, 'aliases', alias)),
      )
      expect(await readFile(join(output, 'aliases', `${alias}.sha256`), 'utf8')).toBe(
        `${target.sha256}  ${alias}\n`,
      )
    }
    expect(JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))).toEqual(manifest)
  })

  it('rejects a candidate whose sidecar does not match its bytes', async () => {
    const root = await fixture()
    const archive = join(root, 'input', `openalice-cli-${version}-linux-x64.tar.gz`)
    await writeFile(`${archive}.sha256`, `${'0'.repeat(64)}  ${basename(archive)}\n`)
    expect(() => prepareCliDevAssets({
      inputDir: join(root, 'input'),
      outputDir: join(root, 'output'),
      commit,
      version,
    })).toThrow('does not match its SHA-256 sidecar')
  })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'openalice-cli-dev-assets-'))
  temporaryPaths.push(root)
  const input = join(root, 'input')
  await mkdir(input)
  for (const [platform, arch] of [
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['linux', 'arm64'],
    ['linux', 'x64'],
  ]) {
    const releaseName = `openalice-cli-${version}-${platform}-${arch}`
    const releaseRoot = join(root, releaseName)
    await mkdir(join(releaseRoot, 'bin'), { recursive: true })
    await writeFile(join(releaseRoot, 'bin', 'openalice'), '#!/bin/sh\n')
    await writeFile(join(releaseRoot, 'release.json'), JSON.stringify({
      schemaVersion: 1,
      product: 'OpenAlice CLI',
      version,
      platform,
      arch,
      bunVersion: '1.4.0',
      contentIdentity: createHash('sha256').update(`${platform}-${arch}`).digest('hex').slice(0, 16),
    }))
    const archive = join(input, `${releaseName}.tar.gz`)
    await execFileAsync('tar', ['-czf', archive, '-C', root, releaseName])
    const checksum = createHash('sha256').update(await readFile(archive)).digest('hex')
    await writeFile(`${archive}.sha256`, `${checksum}  ${basename(archive)}\n`)
  }
  return root
}
