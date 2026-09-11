import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  CLI_NEUTRAL_INPUT_ROOTS,
  prepareCliNeutralInputs,
  verifyCliNeutralInputs,
} from './prepare-cli-neutral-inputs.mjs'

const commit = '0123456789abcdef0123456789abcdef01234567'
const temporaryPaths = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('CLI platform-neutral build inputs', () => {
  it('round-trips only the approved roots with an exact commit and verified hashes', async () => {
    const root = await fixture()
    const output = join(root, 'artifact')
    const destination = join(root, 'consumer')
    await mkdir(destination)

    const prepared = prepareCliNeutralInputs({ repositoryRoot: root, outputDir: output, commit })
    const verified = verifyCliNeutralInputs({
      repositoryRoot: destination,
      inputDir: output,
      commit,
      install: true,
    })

    expect(prepared.roots).toEqual([
      'ui/dist',
      'packages/connector-protocol/dist',
      'packages/guardian-runtime/dist',
      'packages/ibkr/dist',
      'packages/opentypebb/dist',
      'packages/uta-protocol/dist',
    ])
    expect(prepared).toEqual(verified)
    expect(prepared.files).toHaveLength(CLI_NEUTRAL_INPUT_ROOTS.length)
    for (const file of prepared.files) {
      expect(await readFile(join(destination, ...file.path.split('/')), 'utf8')).toBe(`built:${file.path}\n`)
      expect(file.sha256).toBe(
        createHash('sha256').update(`built:${file.path}\n`).digest('hex'),
      )
    }
    await expect(readFile(join(destination, 'node_modules', 'dugite', 'git', 'bin', 'git')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails closed when an approved build root is missing', async () => {
    const root = await fixture()
    await rm(join(root, 'packages/ibkr/dist'), { recursive: true })
    expect(() => prepareCliNeutralInputs({
      repositoryRoot: root,
      outputDir: join(root, 'artifact'),
      commit,
    })).toThrow('required neutral input is missing: packages/ibkr/dist')
  })

  it('refuses an output directory that contains an approved source root', async () => {
    const root = await fixture()
    expect(() => prepareCliNeutralInputs({
      repositoryRoot: root,
      outputDir: join(root, 'packages'),
      commit,
    })).toThrow('neutral input output may not overlap an approved input')
    expect(await readFile(join(root, 'packages/ibkr/dist/index.js'), 'utf8'))
      .toBe('built:packages/ibkr/dist/index.js\n')
  })

  it('never replaces an existing artifact directory', async () => {
    const root = await fixture()
    const output = join(root, 'artifact')
    await mkdir(output)
    await writeFile(join(output, 'owned'), 'keep\n')
    expect(() => prepareCliNeutralInputs({ repositoryRoot: root, outputDir: output, commit }))
      .toThrow('refusing to replace existing neutral input artifact')
    expect(await readFile(join(output, 'owned'), 'utf8')).toBe('keep\n')
  })

  it('rejects payload bytes that no longer match the manifest', async () => {
    const root = await fixture()
    const output = join(root, 'artifact')
    prepareCliNeutralInputs({ repositoryRoot: root, outputDir: output, commit })
    await writeFile(join(output, 'payload/ui/dist/index.html'), 'tampered\n')
    expect(() => verifyCliNeutralInputs({
      repositoryRoot: join(root, 'consumer'),
      inputDir: output,
      commit,
    })).toThrow('hash or size mismatch: ui/dist/index.html')
  })

  it('rejects a manifest that no longer matches its SHA-256 sidecar', async () => {
    const root = await fixture()
    const output = join(root, 'artifact')
    prepareCliNeutralInputs({ repositoryRoot: root, outputDir: output, commit })
    const manifest = await readFile(join(output, 'manifest.json'), 'utf8')
    await writeFile(join(output, 'manifest.json'), `${manifest}\n`)
    expect(() => verifyCliNeutralInputs({
      repositoryRoot: join(root, 'consumer'),
      inputDir: output,
      commit,
    })).toThrow('manifest does not match its SHA-256 sidecar')
  })

  it('rejects extra payload entries outside the manifest whitelist', async () => {
    const root = await fixture()
    const output = join(root, 'artifact')
    prepareCliNeutralInputs({ repositoryRoot: root, outputDir: output, commit })
    await mkdir(join(output, 'payload/node_modules'), { recursive: true })
    await writeFile(join(output, 'payload/node_modules/host-output'), 'forbidden\n')
    expect(() => verifyCliNeutralInputs({
      repositoryRoot: join(root, 'consumer'),
      inputDir: output,
      commit,
    })).toThrow('payload contains missing or unexpected files')
  })

  it('rejects unexpected artifact envelope entries before reading payloads', async () => {
    const root = await fixture()
    const output = join(root, 'artifact')
    prepareCliNeutralInputs({ repositoryRoot: root, outputDir: output, commit })
    await writeFile(join(output, 'host-native-output'), 'forbidden\n')
    expect(() => verifyCliNeutralInputs({
      repositoryRoot: join(root, 'consumer'),
      inputDir: output,
      commit,
    })).toThrow('artifact contains missing or unexpected top-level entries')
  })

  it('rejects the wrong commit and refuses to merge with existing outputs', async () => {
    const root = await fixture()
    const output = join(root, 'artifact')
    const destination = join(root, 'consumer')
    prepareCliNeutralInputs({ repositoryRoot: root, outputDir: output, commit })
    expect(() => verifyCliNeutralInputs({
      repositoryRoot: destination,
      inputDir: output,
      commit: 'ffffffffffffffffffffffffffffffffffffffff',
    })).toThrow('does not match')

    await mkdir(join(destination, 'ui/dist'), { recursive: true })
    expect(() => verifyCliNeutralInputs({
      repositoryRoot: destination,
      inputDir: output,
      commit,
      install: true,
    })).toThrow('refusing to merge neutral input into existing destination: ui/dist')
  })

  it.skipIf(process.platform === 'win32')('rejects symbolic links in build outputs', async () => {
    const root = await fixture()
    await symlink('index.js', join(root, 'packages/ibkr/dist/alias.js'))
    expect(() => prepareCliNeutralInputs({
      repositoryRoot: root,
      outputDir: join(root, 'artifact'),
      commit,
    })).toThrow('neutral input may not contain symbolic links')
  })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'openalice-cli-neutral-inputs-'))
  temporaryPaths.push(root)
  for (const inputRoot of CLI_NEUTRAL_INPUT_ROOTS) {
    const file = inputRoot === 'ui/dist'
      ? `${inputRoot}/index.html`
      : `${inputRoot}/index.js`
    const absolute = join(root, ...file.split('/'))
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, `built:${file}\n`)
  }
  return root
}
