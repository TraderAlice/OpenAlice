import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// `openalice update` runs this installer through Windows PowerShell on
// Windows, and GitHub serves release assets - including the .sha256 sidecar
// that the stable/beta channels read - as application/octet-stream. That host
// returns such bodies as byte[], so the installer's text downloads must decode
// them instead of handing arrays to callers that expect strings.
const installScript = resolve(import.meta.dirname, '..', 'install.ps1')
const sidecarHash = '21e44873f3a2d2c97f87f44532b374af7ed05c03c0dbd2a9d4b06e21bfad5762'
const version = '9.9.9-beta.1'
const artifact = `openalice-cli-${version}-win32-x64.tar.gz`

// The stand-in transport answers the channel manifest as text and the asset's
// .sha256 sidecar as raw bytes. The values are baked in because PowerShell
// resolves non-local variables from the caller's scope, where install.ps1 owns
// same-named parameters of its own.
const harness = `
$ErrorActionPreference = 'Stop'
function Invoke-WebRequest {
  param([string]$Uri, [switch]$UseBasicParsing, [int]$TimeoutSec, [string]$OutFile)
  if ($Uri -match 'manifest\\.json$') { return [pscustomobject]@{ Content = '{"channel":"beta","version":"${version}"}' } }
  if ($Uri -match '\\.sha256$') {
    return [pscustomobject]@{ Content = [Text.Encoding]::UTF8.GetBytes('${sidecarHash}' + '  ' + '${artifact}' + "\`n") }
  }
  throw "unexpected download: $Uri"
}
$env:OPENALICE_DOWNLOAD_BASE_URL = 'https://mock.invalid'
$env:OPENALICE_RELEASE_ASSET_BASE_URL = 'https://mock.invalid/assets'
$planDir = [IO.Path]::Combine([IO.Path]::GetTempPath(), 'openalice-plan-' + [guid]::NewGuid().ToString('N'))
& '${installScript}' -Channel beta -Plan -InstallDir $planDir
`

function findPowerShell(): string | undefined {
  for (const candidate of process.platform === 'win32' ? ['powershell.exe', 'pwsh'] : ['pwsh']) {
    const probe = spawnSync(candidate, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { stdio: 'ignore', windowsHide: true })
    if (!probe.error && probe.status === 0) return candidate
  }
  return undefined
}

const powershell = findPowerShell()
const directory = mkdtempSync(join(tmpdir(), 'openalice-installer-download-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

describe.skipIf(powershell === undefined)('Windows installer text downloads', () => {
  it('decodes a byte[] .sha256 sidecar response while planning an update', () => {
    const script = join(directory, 'plan-with-octet-stream-sidecar.ps1')
    writeFileSync(script, harness)
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // Keep the plan path identical on hosts without Windows environment
      // variables; the installer still owns the actual arch handling.
      OS: 'Windows_NT',
      PROCESSOR_ARCHITECTURE: 'AMD64',
    }
    delete env.OPENALICE_EXPECTED_CLI_ARTIFACT_SHA256
    delete env.OPENALICE_EXPECTED_DEV_COMMIT
    const result = spawnSync(powershell!, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
      env,
      encoding: 'utf8',
      windowsHide: true,
    })
    // The failure this guards against names the decoded type, which is not localized.
    expect(result.stderr).not.toContain('[System.Byte]')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('OpenAlice CLI installation plan')
    expect(result.stdout).toContain(sidecarHash)
  })
})
