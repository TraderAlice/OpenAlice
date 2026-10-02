import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bunReleaseContentIdentity } from '../../../scripts/bun-release-content-identity.mjs'
import { pinnedBunVersion } from '../../../scripts/bun-toolchain.mjs'
import { fixtureMachO } from '../../../scripts/fixtures/macho.mjs'
import { verifyCliReleaseArchive, verifyCliReleaseDirectory } from '../../../scripts/verify-cli-release.mjs'

const roots = []
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
function fixture({ platform = 'darwin', arch = 'arm64' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'openalice-archive-test-')); roots.push(root)
  const version = '0.94.1-beta.2'; const name = `openalice-cli-${version}-${platform}-${arch}`
  const tree = join(root, name); const executable = join(tree, 'bin/openalice'); const resource = join(tree, 'share/openalice/resource.txt')
  mkdirSync(join(tree, 'bin'), { recursive: true }); mkdirSync(join(tree, 'share/openalice'), { recursive: true })
  writeFileSync(executable, platform === 'darwin' ? fixtureMachO(arch) : '#!/bin/sh\n'); chmodSync(executable, 0o755)
  writeFileSync(resource, 'immutable resource'); chmodSync(resource, 0o644)
  const entry = (path, mode) => { const bytes = readFileSync(join(tree, path)); return { path, type: 'file', mode, bytes: bytes.length, sha256: hash(bytes) } }
  const metadata = { schemaVersion: 1, product: 'OpenAlice CLI', version, platform, arch, bunVersion: pinnedBunVersion(), executable: 'bin/openalice', resourceRoot: 'share/openalice', files: [entry('bin/openalice', 0o755), entry('share/openalice/resource.txt', 0o644)] }
  const archivePath = join(root, `${name}.tar.gz`)
  function pack({ refreshMetadata = true } = {}) {
    if (refreshMetadata) metadata.contentIdentity = bunReleaseContentIdentity(metadata)
    writeFileSync(join(tree, 'release.json'), JSON.stringify(metadata))
    execFileSync('tar', ['-czf', archivePath, '-C', root, name], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
    writeFileSync(`${archivePath}.sha256`, `${hash(readFileSync(archivePath))}  ${basename(archivePath)}\n`)
  }
  pack()
  return { root, tree, executable, resource, metadata, pack, options: { archivePath, version, platform, arch } }
}

describe.skipIf(process.platform === 'win32')('final CLI archive gate', () => {
  for (const arch of ['arm64', 'x64']) it(`verifies actual ${arch} archive bytes and signatures with a restrictive umask`, () => {
    const f = fixture({ arch })
    expect(verifyCliReleaseArchive(f.options).signature.codeSlots).toBe(2)
    execFileSync(process.execPath, ['--input-type=module', '-e', `process.umask(0o077); const { verifyCliReleaseArchive } = await import(${JSON.stringify(new URL('../../../scripts/verify-cli-release.mjs', import.meta.url).href)}); verifyCliReleaseArchive(${JSON.stringify(f.options)})`])
    expect(verifyCliReleaseDirectory(f.root)[0].bunVersion).toBe(pinnedBunVersion())
  })
  it('rejects altered resources, permissions, missing manifest coverage, and stale identity even with a fresh archive checksum', () => {
    const resource = fixture(); writeFileSync(resource.resource, 'changed resource'); resource.pack()
    expect(() => verifyCliReleaseArchive(resource.options)).toThrow('actual files')
    const mode = fixture(); chmodSync(mode.executable, 0o644); mode.pack()
    expect(() => verifyCliReleaseArchive(mode.options)).toThrow('actual files')
    const extra = fixture(); writeFileSync(join(extra.tree, 'unlisted'), 'extra'); extra.pack()
    expect(() => verifyCliReleaseArchive(extra.options)).toThrow('actual files')
    const identity = fixture(); identity.metadata.contentIdentity = '0000000000000000'; identity.pack({ refreshMetadata: false })
    expect(() => verifyCliReleaseArchive(identity.options)).toThrow('content identity')
  })
  it('rejects a code-page mutation even after the complete manifest and archive checksum are regenerated', () => {
    const f = fixture(); const bytes = readFileSync(f.executable); bytes[4096] ^= 1; writeFileSync(f.executable, bytes)
    f.metadata.files[0].sha256 = hash(bytes); f.pack()
    expect(() => verifyCliReleaseArchive(f.options)).toThrow('code page 1')
  })
  it('rejects a script claiming to be a macOS native executable and an incorrect compiler pin', () => {
    const f = fixture(); const bytes = Buffer.from('#!/bin/sh\n'); writeFileSync(f.executable, bytes)
    f.metadata.files[0].bytes = bytes.length; f.metadata.files[0].sha256 = hash(bytes); f.pack()
    expect(() => verifyCliReleaseArchive(f.options)).toThrow('thin 64-bit Mach-O')
    const pin = fixture(); pin.metadata.bunVersion = '1.4.0'; pin.pack()
    expect(() => verifyCliReleaseArchive(pin.options)).toThrow('invalid release metadata')
  })
  it('rejects archive symlinks escaping the payload and hardlinked files', () => {
    const f = fixture(); symlinkSync('/etc/passwd', join(f.tree, 'outside')); f.pack()
    expect(() => verifyCliReleaseArchive(f.options)).toThrow('Unsafe CLI symlink')
    const hard = fixture(); linkSync(hard.resource, join(hard.tree, 'linked')); hard.pack()
    expect(() => verifyCliReleaseArchive(hard.options)).toThrow('Unsupported CLI archive entry')
  })
  it('rejects an archive containing duplicate entries', () => {
    const f = fixture(); const name = basename(f.tree)
    execFileSync('tar', ['-czf', f.options.archivePath, '-C', f.root, name, `${name}/bin/openalice`])
    writeFileSync(`${f.options.archivePath}.sha256`, `${hash(readFileSync(f.options.archivePath))}  ${basename(f.options.archivePath)}\n`)
    expect(() => verifyCliReleaseArchive(f.options)).toThrow('duplicate or unsafe')
  })
  it('recovers on the next intact archive after a rejected payload', () => {
    const f = fixture({ platform: 'linux' }); const bytes = readFileSync(f.resource)
    writeFileSync(f.resource, 'bad'); f.pack()
    expect(() => verifyCliReleaseArchive(f.options)).toThrow('actual files')
    writeFileSync(f.resource, bytes); f.pack()
    expect(verifyCliReleaseArchive(f.options).metadata.contentIdentity).toBe(f.metadata.contentIdentity)
  })
})
