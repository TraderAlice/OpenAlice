import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { inspectMachOSignature, machoSigningMetadata } from './macho-signature.mjs'

// Stage beside the build output: a failed signer/verifier never replaces its input.
export function signCliMacOS(executable, arch, { platform = process.platform, run = execFileSync } = {}) {
  if (platform !== 'darwin') throw new Error('Final macOS CLI signing requires the macOS build runner')
  const staging = mkdtempSync(join(dirname(executable), '.codesign-'))
  const candidate = join(staging, 'openalice')
  try {
    copyFileSync(executable, candidate)
    const original = machoSigningMetadata(readFileSync(candidate), arch)
    function entitlementJson(xml, name) {
      if (!xml) return undefined
      const path = join(staging, name)
      writeFileSync(path, xml)
      const json = JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path], { encoding: 'utf8', timeout: 30_000 }))
      return JSON.stringify(Object.entries(json).sort(([a], [b]) => a.localeCompare(b)))
    }
    const beforeEntitlements = entitlementJson(original.entitlements, 'before.plist')
    run('/usr/bin/codesign', [
      '--force', '--sign', '-', '--timestamp=none', '--digest-algorithm=sha256', '--pagesize', '4096', '--identifier', 'ai.openalice.cli',
      '--preserve-metadata=entitlements,runtime', '--options', `0x${original.flags.toString(16)}`, candidate,
    ], { encoding: 'utf8', timeout: 60_000 })
    run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', candidate], { encoding: 'utf8', timeout: 60_000 })
    const signature = inspectMachOSignature(readFileSync(candidate), arch)
    if (signature.identifier !== 'ai.openalice.cli') throw new Error('Unexpected CLI signing identifier')
    const finalized = machoSigningMetadata(readFileSync(candidate), arch)
    if (original.flags !== finalized.flags || beforeEntitlements !== entitlementJson(finalized.entitlements, 'after.plist')) {
      throw new Error('CLI signing changed runtime flags or entitlements')
    }
    renameSync(candidate, executable)
    return signature
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
