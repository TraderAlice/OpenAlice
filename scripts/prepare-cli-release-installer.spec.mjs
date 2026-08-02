import { execFile } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import { prepareCliReleaseInstaller } from './prepare-cli-release-installer.mjs'

const execFileAsync = promisify(execFile)
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const fakeNpm = join(repositoryRoot, 'scripts/install-smoke/fake-npm.sh')
const piAssets = join(repositoryRoot, 'scripts/install-smoke/pi-assets')
const productVersion = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')).version
const temporaryPaths = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('release-owned CLI installer', () => {
  it('binds an immutable payload ref to the stable update channel', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-release-installer-'))
    temporaryPaths.push(root)
    const installer = join(root, 'install')
    const runtimeArchive = join(root, 'runtime.tar.gz')
    await copyFile(join(repositoryRoot, 'install'), installer)
    await writeFile(runtimeArchive, '')

    prepareCliReleaseInstaller(productVersion, installer)
    await expect(execFileAsync('bash', ['-n', installer])).resolves.toBeDefined()

    const plan = await execFileAsync('bash', [installer,
      '--source', repositoryRoot,
      '--runtime-archive', runtimeArchive,
      '--install-dir', join(root, '.openalice'),
      '--no-modify-path',
      '--plan',
    ], {
      env: {
        ...process.env,
        HOME: root,
        OPENALICE_NPM_BIN: fakeNpm,
        OPENALICE_PI_SOURCE_DIR: piAssets,
      },
    })

    expect(plan.stdout).toContain(`Version        v${productVersion}`)
    expect(plan.stdout).toContain('Updates        stable')
  })

  it('rejects malformed release versions before rewriting the installer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-release-installer-invalid-'))
    temporaryPaths.push(root)
    const installer = join(root, 'install')
    await copyFile(join(repositoryRoot, 'install'), installer)
    expect(() => prepareCliReleaseInstaller('master; bad', installer)).toThrow('invalid OpenAlice release version')
  })
})
