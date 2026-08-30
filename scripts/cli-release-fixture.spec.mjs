import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import {
  preparePreviousCliReleaseArchives,
  syntheticPreviousVersion,
} from './cli-release-fixture.mjs'
import { bunReleaseContentIdentity } from './bun-release-content-identity.mjs'

const execFileAsync = promisify(execFile)
const temporaryPaths = []
const version = '0.90.1'

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('CLI prior-release fixture', () => {
  it('derives an isolated N-1 archive set and refreshes release identities', async () => {
    const root = await fixture()
    const output = join(root, 'previous')
    const manifest = preparePreviousCliReleaseArchives({
      inputDir: join(root, 'current'),
      outputDir: output,
      version,
    })

    expect(manifest.previousVersion).toBe('0.90.0')
    expect(manifest.targets).toHaveLength(4)
    for (const target of manifest.targets) {
      expect(target.previousContentIdentity).not.toBe(target.currentContentIdentity)
      const name = `openalice-cli-0.90.0-${target.platform}-${target.arch}`
      const archive = join(output, `${name}.tar.gz`)
      const release = JSON.parse((await execFileAsync('tar', [
        '-xOzf', archive, `${name}/release.json`,
      ])).stdout)
      expect(release).toMatchObject({
        version: '0.90.0',
        contentIdentity: target.previousContentIdentity,
      })
      expect(release.contentIdentity).toBe(bunReleaseContentIdentity(release))
      expect((await execFileAsync('tar', [
        '-xOzf', archive, `${name}/bin/openalice`,
      ])).stdout).toContain('0.90.0')
      const sidecar = await readFile(`${archive}.sha256`, 'utf8')
      expect(sidecar).toBe(`${sha256(await readFile(archive))}  ${basename(archive)}\n`)
    }
  })

  it('keeps the synthetic version byte length stable', () => {
    expect(syntheticPreviousVersion('1.10.0')).toBe('0.99.9')
    expect(syntheticPreviousVersion('0.91.0-beta')).toBe('0.90.9-beta')
    expect(syntheticPreviousVersion('0.91.0-beta.1')).toBe('0.90.9-beta.1')
    expect(() => syntheticPreviousVersion('0.0.0')).toThrow('cannot derive')
    expect(() => syntheticPreviousVersion('0.91.0-rc.1')).toThrow('stable or beta version')
  })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'openalice-cli-release-fixture-'))
  temporaryPaths.push(root)
  const input = join(root, 'current')
  await mkdir(input)
  for (const [platform, arch] of [
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['linux', 'arm64'],
    ['linux', 'x64'],
  ]) {
    const releaseName = `openalice-cli-${version}-${platform}-${arch}`
    const releaseRoot = join(root, releaseName)
    const executablePath = join(releaseRoot, 'bin/openalice')
    const packagePath = join(releaseRoot, 'share/openalice/package.json')
    await mkdir(join(releaseRoot, 'bin'), { recursive: true })
    await mkdir(join(releaseRoot, 'share/openalice'), { recursive: true })
    await writeFile(executablePath, `#!/bin/sh\nprintf '${version}\\n'\n`)
    await chmod(executablePath, 0o755)
    await writeFile(packagePath, `${JSON.stringify({ version })}\n`)
    const release = {
      schemaVersion: 1,
      product: 'OpenAlice CLI',
      version,
      platform,
      arch,
      bunVersion: '1.4.0',
      executable: 'bin/openalice',
      resourceRoot: 'share/openalice',
      files: [
        fileEntry('bin/openalice', await readFile(executablePath), 0o755),
        fileEntry('share/openalice/package.json', await readFile(packagePath)),
      ],
    }
    release.contentIdentity = bunReleaseContentIdentity(release)
    await writeFile(join(releaseRoot, 'release.json'), `${JSON.stringify(release, null, 2)}\n`)
    const archive = join(input, `${releaseName}.tar.gz`)
    await execFileAsync('tar', ['-czf', archive, '-C', root, releaseName])
    await writeFile(`${archive}.sha256`, `${sha256(await readFile(archive))}  ${basename(archive)}\n`)
  }
  return root
}

function fileEntry(path, content, mode = 0o644) {
  return { path, type: 'file', bytes: content.length, mode, sha256: sha256(content) }
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}
