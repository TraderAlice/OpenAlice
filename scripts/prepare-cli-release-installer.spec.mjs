import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import { prepareCliReleaseInstaller } from './prepare-cli-release-installer.mjs'

const execFileAsync = promisify(execFile)
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
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
    await copyFile(join(repositoryRoot, 'install'), installer)

    prepareCliReleaseInstaller(productVersion, installer)
    await expect(execFileAsync('bash', ['-n', installer])).resolves.toBeDefined()
    const rewritten = await readFile(installer, 'utf8')
    expect(rewritten).toContain(`OPENALICE_INSTALLER_RELEASE_VERSION="\${OPENALICE_INSTALLER_RELEASE_VERSION:-${productVersion}}"`)
    expect(rewritten).toContain('OPENALICE_INSTALLER_UPDATE_CHANNEL="${OPENALICE_INSTALLER_UPDATE_CHANNEL:-stable}"')

    const server = createServer((_request, response) => {
      response.end(`${'a'.repeat(64)}  openalice-cli.tar.gz\n`)
    })
    await new Promise((resolvePromise, rejectPromise) => {
      server.once('error', rejectPromise)
      server.listen(0, '127.0.0.1', resolvePromise)
    })
    try {
      const address = server.address()
      const plan = await execFileAsync('bash', [installer,
        '--install-dir', join(root, '.openalice'),
        '--no-modify-path',
        '--plan',
      ], {
        env: {
          ...process.env,
          HOME: root,
          OPENALICE_RELEASE_ASSET_BASE_URL: `http://127.0.0.1:${address.port}`,
        },
      })
      expect(plan.stdout).toContain(`Channel         release (${productVersion})`)
      expect(plan.stdout).toContain(`/v${productVersion}/openalice-cli-${productVersion}-`)
    } finally {
      await new Promise((resolvePromise) => server.close(resolvePromise))
    }
  })

  it('rejects malformed release versions before rewriting the installer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-release-installer-invalid-'))
    temporaryPaths.push(root)
    const installer = join(root, 'install')
    await copyFile(join(repositoryRoot, 'install'), installer)
    expect(() => prepareCliReleaseInstaller('master; bad', installer)).toThrow('invalid OpenAlice release version')
  })
})
