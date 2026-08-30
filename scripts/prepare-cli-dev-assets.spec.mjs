import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import { bunReleaseContentIdentity } from './bun-release-content-identity.mjs'
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
      installerPath: join(root, 'install'),
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
    expect(await readFile(join(output, 'releases', commit, 'install'), 'utf8'))
      .toBe('#!/usr/bin/env bash\n')
    expect(manifest.installer).toEqual({
      url: 'https://download.openalice.ai/install',
      versionedUrl: `https://download.openalice.ai/cli/dev/releases/${commit}/install`,
      sha256: createHash('sha256').update('#!/usr/bin/env bash\n').digest('hex'),
    })
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
      installerPath: join(root, 'install'),
    })).toThrow('does not match its SHA-256 sidecar')
  })

  it('rejects a candidate whose stored content identity does not match its files manifest', async () => {
    const root = await fixture({ tamperedIdentityTarget: 'linux-x64' })
    expect(() => prepareCliDevAssets({
      inputDir: join(root, 'input'),
      outputDir: join(root, 'output'),
      commit,
      version,
      installerPath: join(root, 'install'),
    })).toThrow('content identity does not match its release manifest')
  })
})

async function fixture({ tamperedIdentityTarget } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'openalice-cli-dev-assets-'))
  temporaryPaths.push(root)
  const input = join(root, 'input')
  await mkdir(input)
  await writeFile(join(root, 'install'), '#!/usr/bin/env bash\n')
  for (const [platform, arch] of [
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['linux', 'arm64'],
    ['linux', 'x64'],
  ]) {
    const releaseName = `openalice-cli-${version}-${platform}-${arch}`
    const releaseRoot = join(root, releaseName)
    await mkdir(join(releaseRoot, 'bin'), { recursive: true })
    const executable = join(releaseRoot, 'bin', 'openalice')
    const executableBytes = Buffer.from('#!/bin/sh\n')
    await writeFile(executable, executableBytes)
    await chmod(executable, 0o755)
    const release = {
      schemaVersion: 1,
      product: 'OpenAlice CLI',
      version,
      platform,
      arch,
      bunVersion: '1.4.0',
      executable: 'bin/openalice',
      resourceRoot: 'share/openalice',
      files: [{
        path: 'bin/openalice',
        type: 'file',
        bytes: executableBytes.length,
        mode: 0o755,
        sha256: createHash('sha256').update(executableBytes).digest('hex'),
      }],
    }
    release.contentIdentity = bunReleaseContentIdentity(release)
    if (tamperedIdentityTarget === `${platform}-${arch}`) {
      release.contentIdentity = release.contentIdentity === 'ffffffffffffffff'
        ? 'eeeeeeeeeeeeeeee'
        : 'ffffffffffffffff'
    }
    await writeFile(join(releaseRoot, 'release.json'), JSON.stringify(release))
    const archive = join(input, `${releaseName}.tar.gz`)
    await execFileAsync('tar', ['-czf', archive, '-C', root, releaseName])
    const checksum = createHash('sha256').update(await readFile(archive)).digest('hex')
    await writeFile(`${archive}.sha256`, `${checksum}  ${basename(archive)}\n`)
  }
  return root
}
