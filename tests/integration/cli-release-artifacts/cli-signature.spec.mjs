import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pinnedBunVersion, requireBunExecutable, requireBunVersion } from '../../../scripts/bun-toolchain.mjs'
import { fixtureMachO } from '../../../scripts/fixtures/macho.mjs'
import { inspectMachOSignature } from '../../../scripts/macho-signature.mjs'
import { signCliMacOS } from '../../../scripts/sign-cli-macos.mjs'

const roots = []
function temporary() { const root = mkdtempSync(join(tmpdir(), 'openalice-signature-test-')); roots.push(root); return root }
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))

describe('CLI Mach-O signature integrity', () => {
  for (const arch of ['arm64', 'x64']) {
    it(`accepts ${arch} full coverage with an unpadded final page`, () => {
      expect(inspectMachOSignature(fixtureMachO(arch), arch)).toMatchObject({ codeLimit: 4352, codeSlots: 2, identifier: 'ai.openalice.cli' })
    })
    it(`rejects ${arch} zero-padded final-page hashes`, () => {
      const bytes = fixtureMachO(arch)
      const cd = 4352 + bytes.readUInt32BE(4368)
      const page = Buffer.alloc(4096); bytes.copy(page, 0, 4096, 4352)
      createHash('sha256').update(page).digest().copy(bytes, cd + bytes.readUInt32BE(cd + 16) + 32)
      expect(() => inspectMachOSignature(bytes, arch)).toThrow('code page 1 hash mismatch')
    })
  }
  it('rejects stale x64 code coverage, wrong architecture, and malformed bounds', () => {
    const bytes = fixtureMachO('x64')
    expect(() => inspectMachOSignature(bytes, 'arm64')).toThrow('architecture')
    const cd = 4352 + bytes.readUInt32BE(4368)
    bytes.writeUInt32BE(4096, cd + 32)
    expect(() => inspectMachOSignature(bytes, 'x64')).toThrow('incomplete code coverage')
    expect(() => inspectMachOSignature(bytes.subarray(0, 100), 'x64')).toThrow()
  })
  it('rejects changed code pages, entitlements, and linker-only signatures', () => {
    const code = fixtureMachO('arm64'); code[4096] ^= 1
    expect(() => inspectMachOSignature(code, 'arm64')).toThrow('code page 1')
    const special = fixtureMachO('arm64', '', { entitlements: true }); special[special.length - 1] ^= 1
    expect(() => inspectMachOSignature(special, 'arm64')).toThrow('special slot 5')
    const linker = fixtureMachO('arm64'); linker.writeUInt32BE(0x20002, 4352 + linker.readUInt32BE(4368) + 12)
    expect(() => inspectMachOSignature(linker, 'arm64')).toThrow('finalized ad-hoc')
  })
})

describe('toolchain and signing failure recovery', () => {
  it('requires the exact pin and rejects a missing compiler', () => {
    expect(requireBunVersion(pinnedBunVersion())).toBe(pinnedBunVersion())
    expect(() => requireBunVersion('1.4.0')).toThrow('is required')
    expect(() => requireBunExecutable(join(temporary(), 'missing'))).toThrow()
  })
  it.skipIf(process.platform === 'win32')('checks the actual PATH executable and recovers after a wrong compiler', () => {
    const root = temporary(); const binary = join(root, 'bun')
    const options = { env: { ...process.env, PATH: root } }
    writeFileSync(binary, '#!/bin/sh\nprintf "1.4.0\\n"\n'); chmodSync(binary, 0o755)
    expect(() => requireBunExecutable('bun', options)).toThrow('1.4.0 is running')
    writeFileSync(binary, `#!/bin/sh\nprintf '${pinnedBunVersion()}\\n'\n`)
    expect(requireBunExecutable('bun', options)).toBe(pinnedBunVersion())
  })
  for (const failure of ['sign', 'native-verify', 'static-verify']) {
    it(`preserves original bytes and cleans staging when ${failure} fails, then retries`, () => {
      const root = temporary(); const executable = join(root, 'openalice')
      const original = fixtureMachO('arm64'); writeFileSync(executable, original)
      let calls = 0
      const run = (_command, args) => {
        calls++
        const candidate = args.at(-1)
        if (calls === 1) writeFileSync(candidate, failure === 'static-verify' ? 'bad signature' : fixtureMachO('arm64'))
        if ((failure === 'sign' && calls === 1) || (failure === 'native-verify' && calls === 2)) throw new Error('injected codesign failure')
      }
      expect(() => signCliMacOS(executable, 'arm64', { platform: 'darwin', run })).toThrow()
      expect(readFileSync(executable)).toEqual(original)
      expect(readdirSync(root)).toEqual(['openalice'])
      const invocations = []
      signCliMacOS(executable, 'arm64', { platform: 'darwin', run: (_command, args) => {
        invocations.push(args)
        if (args.includes('--sign')) writeFileSync(args.at(-1), fixtureMachO('arm64'))
      } })
      expect(invocations[0]).toContain('--preserve-metadata=entitlements,runtime')
      expect(invocations[1]).toContain('--strict')
      expect(inspectMachOSignature(readFileSync(executable), 'arm64').codeSlots).toBe(2)
      expect(readdirSync(root)).toEqual(['openalice'])
    })
  }
  it('rejects lost entitlements without replacing the compiled output', () => {
    const root = temporary(); const executable = join(root, 'openalice')
    const original = fixtureMachO('arm64', '', { entitlements: true }); writeFileSync(executable, original)
    expect(() => signCliMacOS(executable, 'arm64', { platform: 'darwin', run: (command, args) => {
      if (command === '/usr/bin/plutil') return '{"com.apple.security.cs.allow-jit":true}'
      if (args.includes('--sign')) writeFileSync(args.at(-1), fixtureMachO('arm64'))
    } })).toThrow('changed runtime flags or entitlements')
    expect(readFileSync(executable)).toEqual(original)
    expect(readdirSync(root)).toEqual(['openalice'])
  })
  it('never signs on a non-macOS host', () => {
    expect(() => signCliMacOS('unused', 'arm64', { platform: 'linux' })).toThrow('macOS build runner')
  })
})
