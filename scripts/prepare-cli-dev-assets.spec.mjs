import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import { cliExecutableName } from '../packages/cli/src/release-targets.mjs'
import { bunReleaseContentIdentity } from './bun-release-content-identity.mjs'
import { writeDevBrokerBinding } from './dev-broker-binding.mjs'
import { prepareCliDevAssets } from './prepare-cli-dev-assets.mjs'

const execFileAsync = promisify(execFile)
const version = '0.90.1'
const commit = '0123456789abcdef0123456789abcdef01234567'
const temporaryPaths = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('CLI dev channel assets', () => {
  it('accepts checksum-bound Windows metadata larger than the default subprocess buffer', async () => {
    const root = await fixture({ largeWindowsMetadata: true })
    const manifest = prepareCliDevAssets({ inputDir: join(root, 'input'), outputDir: join(root, 'output'), commit, version, installerPath: join(root, 'install') })
    expect(manifest.additionalTargets).toHaveLength(2)
  })
  it('validates all four native candidates and prepares immutable bytes plus a compatibility receipt', async () => {
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
    expect(manifest.additionalTargets).toHaveLength(2)
    expect(manifest.windowsInstaller.versionedUrl).toBe(`https://download.openalice.ai/cli/dev/releases/${commit}/install.ps1`)
    expect(manifest.targets.map(({ platform, arch }) => `${platform}-${arch}`).sort()).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'linux-arm64',
      'linux-x64',
    ])
    for (const target of [...manifest.targets, ...manifest.additionalTargets]) {
      const versioned = `openalice-cli-${version}-${target.platform}-${target.arch}.tar.gz`
      const alias = `openalice-cli-dev-${target.platform}-${target.arch}.tar.gz`
      expect(await readFile(join(output, 'releases', commit, versioned))).toEqual(
        await readFile(join(root, 'input', versioned)),
      )
      await expect(access(join(output, 'aliases', alias))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(join(output, 'aliases', `${alias}.sha256`), 'utf8')).toBe(
        `${target.sha256}  ${alias}\n`,
      )
      expect(target.archive).toBe(alias)
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

  it('rejects changed broker bytes before producing a channel receipt', async () => {
    const root = await fixture()
    await writeFile(join(root, 'input', `OpenAlice-Broker-alpaca-${version}-linux-x64.tgz`), 'broken')
    expect(() => prepareCliDevAssets({ inputDir: join(root, 'input'), outputDir: join(root, 'output'), commit, version, installerPath: join(root, 'install') })).toThrow('Dev broker checksum mismatch')
    await expect(access(join(root, 'output/manifest.json'))).rejects.toMatchObject({code: 'ENOENT'})
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

async function fixture({ tamperedIdentityTarget, largeWindowsMetadata = false } = {}) {
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
    ['win32', 'arm64'],
    ['win32', 'x64'],
  ]) {
    const releaseName = `openalice-cli-${version}-${platform}-${arch}`
    const releaseRoot = join(root, releaseName)
    await mkdir(join(releaseRoot, 'bin'), { recursive: true })
    const executable = join(releaseRoot, 'bin', cliExecutableName(platform))
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
      executable: `bin/${cliExecutableName(platform)}`,
      resourceRoot: 'share/openalice',
      ...(largeWindowsMetadata && platform === 'win32' ? { fixtureNotes: 'x'.repeat(1100 * 1024) } : {}),
      files: [{
        path: `bin/${cliExecutableName(platform)}`,
        type: 'file',
        bytes: executableBytes.length,
        mode: 0o755,
        sha256: createHash('sha256').update(executableBytes).digest('hex'),
      }],
    }
    const packs = []
    for (const engine of ['ccxt', 'alpaca', 'ibkr', 'leverup', 'longbridge'].filter(e => !(e === 'longbridge' && platform === 'win32' && arch === 'arm64'))) {
      const file = `OpenAlice-Broker-${engine}-${version}-${platform}-${arch}.tgz`
      const bytes = Buffer.from(`fixture-${engine}-${platform}-${arch}`)
      await writeFile(join(input, file), bytes)
      packs.push({engine, version, apiVersion: 1, file, entry: 'dist/index.js', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')})
    }
    await writeFile(join(input, `OpenAlice-Broker-Packs-${version}-${platform}-${arch}.json`), JSON.stringify({schemaVersion: 1, sourceCommit: commit, openAliceVersion: version, platform, arch, packs}))
    const resources = join(releaseRoot, 'share/openalice')
    await mkdir(resources, {recursive: true})
    await writeDevBrokerBinding(resources, {inputDir: input, commit, version, platform, arch})
    const binding = await readFile(join(resources, 'broker-pack-source.json'))
    release.files.push({path: 'share/openalice/broker-pack-source.json', type: 'file', bytes: binding.length, mode: 0o644, sha256: createHash('sha256').update(binding).digest('hex')})
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
