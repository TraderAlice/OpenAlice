import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createRuntimeBundleManifest,
  deduplicateRuntimeTree,
  parseRuntimeBundleManifest,
  readRuntimeBundleManifest,
  verifyRuntimeBundle,
  writeRuntimeBundleManifest,
} from './runtime-bundle.mjs'

const temporaryPaths = []
const TEST_PLATFORM = process.platform === 'win32'
  ? 'linux'
  : process.platform

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )))
})

describe('headless Runtime bundles', () => {
  it('writes and verifies a platform-specific content manifest', async () => {
    const root = await createFixture()
    const manifest = await writeRuntimeBundleManifest(root, {
      productVersion: '1.2.3',
      platform: TEST_PLATFORM,
      arch: process.arch,
    })

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      productVersion: '1.2.3',
      platform: TEST_PLATFORM,
      arch: process.arch,
      entrypoint: 'scripts/guardian/prod.mjs',
      contentIdentity: expect.stringMatching(/^[a-f0-9]{16}$/),
    })
    expect(manifest.files.map((entry) => entry.path)).toEqual(
      [...manifest.files.map((entry) => entry.path)].sort(),
    )
    await expect(verifyRuntimeBundle(root, {
      productVersion: '1.2.3',
      platform: TEST_PLATFORM,
      arch: process.arch,
    })).resolves.toEqual(manifest)

    const saved = JSON.parse(
      await readFile(join(root, 'runtime-manifest.json'), 'utf8'),
    )
    expect(parseRuntimeBundleManifest(saved)).toEqual(manifest)
    expect(await readRuntimeBundleManifest(root)).toEqual(manifest)
  })

  it('rejects tampering, a mismatched platform, and a forged identity', async () => {
    const root = await createFixture()
    const manifest = await writeRuntimeBundleManifest(root, {
      productVersion: '1.2.3',
      platform: TEST_PLATFORM,
      arch: process.arch,
    })

    await expect(verifyRuntimeBundle(root, {
      platform: process.platform === 'darwin' ? 'linux' : 'darwin',
    })).rejects.toMatchObject({ code: 'ERUNTIMEBUNDLEPLATFORM' })

    await writeFile(join(root, 'dist/main.js'), 'tampered\n')
    await expect(verifyRuntimeBundle(root, {
      platform: TEST_PLATFORM,
    })).rejects.toMatchObject({
      code: 'ERUNTIMEBUNDLEINTEGRITY',
    })

    await writeFile(
      join(root, 'runtime-manifest.json'),
      `${JSON.stringify({
        ...manifest,
        contentIdentity: '0000000000000000',
      })}\n`,
    )
    await expect(readRuntimeBundleManifest(root)).rejects.toMatchObject({
      code: 'ERUNTIMEBUNDLEMANIFEST',
    })
  })

  it('restores hard links for identical production files without changing content', async () => {
    const root = await createFixture()
    const first = join(root, 'node_modules/a/repeated.bin')
    const second = join(root, 'node_modules/b/repeated.bin')
    const payload = Buffer.alloc(8_192, 7)
    await writeFixtureFile(first, payload)
    await writeFixtureFile(second, payload)

    expect((await stat(first)).ino).not.toBe((await stat(second)).ino)
    const result = await deduplicateRuntimeTree(root)

    expect(result.filesLinked).toBeGreaterThanOrEqual(1)
    expect(result.bytesDeduplicated).toBeGreaterThanOrEqual(payload.length)
    expect((await stat(first)).ino).toBe((await stat(second)).ino)
    expect(await readFile(second)).toEqual(payload)
  })

  it.skipIf(process.platform === 'win32')('rejects symlinks that escape the Runtime root', async () => {
    const root = await createFixture()
    await symlink('../../../../outside', join(root, 'node_modules/escape'))

    await expect(createRuntimeBundleManifest(root, {
      productVersion: '1.2.3',
      platform: TEST_PLATFORM,
      arch: process.arch,
    })).rejects.toMatchObject({ code: 'ERUNTIMEBUNDLELAYOUT' })
  })
})

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'openalice-runtime-bundle-'))
  temporaryPaths.push(root)
  const files = {
    'dist/main.js': 'main\n',
    'ui/dist/index.html': '<html></html>\n',
    'default/persona.default.md': 'persona\n',
    'src/workspaces/templates/chat/bootstrap.mjs': 'export {}\n',
    'src/workspaces/cli/bin/openalice-cli.cjs': 'module.exports = {}\n',
    'services/uta/dist/uta.js': 'uta\n',
    'services/connector/dist/connector.cjs': 'connector\n',
    'packages/guardian-runtime/dist/index.js': 'guardian runtime\n',
    'scripts/guardian/prod.mjs': 'guardian\n',
    'scripts/guardian/control-server.mjs': 'control\n',
    'scripts/guardian/prod-ports.mjs': 'ports\n',
    'node_modules/example/index.js': 'dependency\n',
    'package.json': '{"name":"open-alice","version":"1.2.3"}\n',
  }
  for (const [path, contents] of Object.entries(files)) {
    await writeFixtureFile(join(root, path), contents)
  }
  return root
}

async function writeFixtureFile(path, contents) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
}
