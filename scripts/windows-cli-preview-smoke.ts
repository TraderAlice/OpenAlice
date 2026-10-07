import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

if (process.platform !== 'win32') throw new Error('Run this smoke on native Windows')
const outputRoot = resolve(`dist/windows-cli-preview/${process.arch}`)
// Published mode exercises real release bytes and public HTTPS downloads. The
// default candidate mode retains its separate synthetic/local-archive contract.
const published = process.argv.includes('--published')
const publishedInstaller = process.argv.includes('--published-installer')
if (publishedInstaller && !published) throw new Error('--published-installer requires --published')
const candidates = published ? [] : process.argv[2] ? [resolve(process.argv[2])] : await findCandidates(outputRoot)
if (!published && candidates.length !== 1) throw new Error(`Expected one candidate for this architecture, found ${candidates.length}`)
const candidateFile = candidates[0]
const candidate = published ? { channelBuild: true, arch: process.arch } : JSON.parse(await readFile(candidateFile!, 'utf8'))
const archive = published ? '' : join(dirname(candidateFile!), basename(candidate.archive))
if (candidate.arch !== process.arch) throw new Error('Native smoke architecture mismatch')
const scratch = await mkdtemp(join(tmpdir(), 'openalice-preview-smoke-'))
const installDir = join(scratch, 'installed preview')
const home = join(scratch, 'alice-home')
const powershell = join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe')
// GitHub starts this script from PowerShell 7. Do not leak its module search
// path into Windows PowerShell 5.1: the latter must discover its own Utility
// module (Get-FileHash, ConvertFrom-Json), just as on an ordinary user host.
const powershellEnv = { ...process.env }
delete powershellEnv.PSModulePath
const host = JSON.parse(await command(powershell, ['-NoProfile', '-Command', `
  $ErrorActionPreference = 'Stop'
  if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { throw 'Windows PowerShell 5.1 is required' }
  @{ version = $PSVersionTable.PSVersion.ToString(); edition = $PSVersionTable.PSEdition; os = [Environment]::OSVersion.VersionString; executable = (Get-Process -Id $PID).Path } | ConvertTo-Json -Compress
`], powershellEnv))
console.log('[windows-smoke] host', JSON.stringify(host))
await mkdir(outputRoot, { recursive: true })
let installer = resolve(candidate.channelBuild ? 'install.ps1' : 'install-preview.ps1')
let stableVersion = ''
let sidecar: unknown
let uninstallReceipt: unknown
let report: Record<string, unknown> = { status: 'failed', host, mode: published ? 'public-network' : 'local-candidate' }
let cleanupSafe = true
const sourceCommit = (await command('git', ['-C', resolve('.'), 'rev-parse', 'HEAD'])).trim()
const installNetwork = (version: string, channel: string) => command(powershell, [
  '-NoProfile', '-File', installer, '-Version', version, '-Channel', channel,
  '-InstallDir', installDir, '-NoModifyPath', '-Yes',
], powershellEnv)
// Enclose installation too: a failed download must still clean its owned root.
try {
  if (published) {
    const stable = await publicManifest('https://download.openalice.ai/manifest.json', 'stable')
    const beta = await publicManifest('https://download.openalice.ai/beta/manifest.json', 'beta')
    stableVersion = stable.version
    candidate.version = beta.version
    if (stableVersion === candidate.version) throw new Error('Published upgrade requires distinct releases')
    if (publishedInstaller) {
      const response = await fetch(beta.windowsInstaller.versionedUrl)
      if (!response.ok) throw new Error(`Published installer HTTP ${response.status}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      if (createHash('sha256').update(bytes).digest('hex') !== beta.windowsInstaller.sha256) throw new Error('Published installer checksum mismatch')
      installer = join(scratch, 'install.ps1')
      await writeFile(installer, bytes)
    }
    // Load the actual Download-Text function via the AST, without executing the
    // installer or replacing Invoke-WebRequest. Both requests hit the live sidecar.
    const probe = join(scratch, 'probe.ps1')
    await writeFile(probe, `param([string]$Installer, [string]$Url)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Installer, [ref]$null, [ref]$null)
$fn = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Download-Text' }, $true)
if (-not $fn) { throw 'Download-Text not found' }
. ([scriptblock]::Create($fn.Extent.Text))
$response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 30
if ($response.Content -isnot [byte[]]) { throw 'Live binary sidecar did not exercise byte[] decoding' }
$text = Download-Text $Url
if ($text -isnot [string] -or $text.Trim() -notmatch '^[a-f0-9]{64}\\s') { throw 'Invalid decoded sidecar' }
@{ url = $Url; contentType = $response.Headers['Content-Type']; rawType = $response.Content.GetType().FullName; decodedType = $text.GetType().FullName; sha256 = $text.Trim().Split(' ')[0] } | ConvertTo-Json -Compress
`)
    sidecar = JSON.parse(await command(powershell, ['-NoProfile', '-File', probe, '-Installer', installer,
      '-Url', `https://github.com/TraderAlice/OpenAlice/releases/download/v${candidate.version}/openalice-cli-${candidate.version}-win32-${process.arch}.tar.gz.sha256`], powershellEnv))
    console.log('[windows-smoke] live sidecar', JSON.stringify(sidecar))
    console.log(await installNetwork(candidate.version, 'beta'))
  } else {
    await command(powershell, ['-NoProfile', '-File', installer,
      '-Archive', archive, '-Sha256', candidate.sha256, '-InstallDir', installDir,
      ...(candidate.channelBuild ? ['-Channel', candidate.version.includes('-beta') ? 'beta' : 'stable', '-NoModifyPath'] : []), '-Yes'], powershellEnv)
  }
  const releaseName = candidate.channelBuild ? (await readFile(join(installDir, 'cli/current.txt'), 'utf8')).trim() : null
  const releaseDir = releaseName ? join(installDir, 'cli/releases', releaseName) : installDir
  const executable = join(releaseDir, 'bin/openalice.exe')
  if (published) {
    const metadata = JSON.parse(await readFile(join(releaseDir, 'release.json'), 'utf8'))
    if (metadata.version !== candidate.version) throw new Error('Installed version mismatch')
    candidate.contentIdentity = metadata.contentIdentity
    candidate.sourceCommit = metadata.sourceCommit ?? null
    candidate.sha256 = (sidecar as { sha256: string }).sha256
  }
  if ((await command(executable, ['--version'])).trim() !== candidate.version) throw new Error('Executable version mismatch')
  const portProbe = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } })
  const port = portProbe.port
  portProbe.stop(true)
  const environment = {
    // Keep Windows account/system discovery real while isolating Alice state
    // and excluding every host development tool from PATH.
    ...Object.fromEntries(['APPDATA', 'LOCALAPPDATA', 'ProgramData', 'SystemDrive',
      'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'HOMEDRIVE', 'HOMEPATH', 'ComSpec',
      'ProgramFiles', 'ProgramFiles(x86)'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])),
    SystemRoot: process.env.SystemRoot!, WINDIR: process.env.WINDIR!,
    OS: 'Windows_NT', PROCESSOR_ARCHITECTURE: process.arch === 'arm64' ? 'ARM64' : 'AMD64',
    PSExecutionPolicyPreference: 'Restricted',
    TEMP: scratch, TMP: scratch, HOME: scratch, USERPROFILE: scratch,
    APPDATA: join(scratch, 'AppData/Roaming'), LOCALAPPDATA: join(scratch, 'AppData/Local'),
    PATH: join(process.env.SystemRoot!, 'System32'),
    OPENALICE_HOME: home, OPENALICE_TRADING_MODE: 'lite',
    OPENALICE_DISABLE_AUTH: '1', OPENALICE_BIND_HOST: '127.0.0.1',
    ...(releaseName ? {
      OPENALICE_INSTALL_ROOT: installDir, OPENALICE_RELEASE_DIR: releaseDir,
      OPENALICE_INSTALL_SOURCE: join(installDir, 'cli/provenance', `${releaseName}.json`),
    } : {}),
  }
  let uninstalled = false
  let cleanupExecutable = executable
  let cleanupEnvironment = environment
  try {
    const setup = JSON.parse(await command(executable, ['setup', '--check', '--json'], environment))
    if (setup.status !== 'ready') throw new Error('Windows acceptance requires system Git/Bash; finish openalice setup first')
    const git = setup.checks.find((check: { id: string }) => check.id === 'git')?.executable
    if (!git || git.startsWith(releaseDir)) throw new Error('CLI must use system-owned Git')
    await command(executable, ['up', '--home', home, '--port', String(port), '--wait', '90', '--no-update-check'], environment)
    const status = JSON.parse(await command(executable, ['status', '--home', home, '--json'], environment)).result.status
    if (status.class !== 'running' || status.provider?.kind !== 'bun' ||
        status.provider.contentIdentity !== candidate.contentIdentity ||
        !status.owner?.pid || !status.componentDetail?.alice?.pid ||
        status.owner.pid === status.componentDetail.alice.pid) throw new Error('Runtime status/identity mismatch')
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text()
    if (!html.includes('<div id="root">')) throw new Error('Real Web UI was not served')
    await command(git, ['--version'], environment)
    await command(executable, ['down', '--home', home, '--wait', '30'], environment)
    const stopped = JSON.parse(await command(executable, ['status', '--home', home, '--json'], environment)).result.status
    if (stopped.class === 'running') throw new Error('Runtime did not stop')
    if (candidate.channelBuild) {
      const channel = candidate.version.includes('-beta') ? 'beta' : 'stable'
      const install = async (path: string, hash: string) => command(powershell, [
        '-NoProfile', '-File', installer, '-Archive', path, '-Sha256', hash,
        '-InstallDir', installDir, '-Channel', channel, '-NoModifyPath', '-Yes',
      ], powershellEnv)
      if (published) {
        // Start the real upgrade from a fresh stable install, not a retained beta
        // archive or a home already migrated by the newer Runtime.
        await rm(installDir, { recursive: true, force: true })
        await rm(home, { recursive: true, force: true })
        console.log(await installNetwork(stableVersion, 'stable'))
      } else {
        const { rewriteExpandedCliRelease, syntheticPreviousVersion } = await import('./cli-release-fixture.mjs')
        const previousVersion = syntheticPreviousVersion(candidate.version)
        const previousName = `openalice-cli-${previousVersion}-win32-${process.arch}`
        const previousTree = join(scratch, previousName)
        await cp(releaseDir, previousTree, { recursive: true })
        rewriteExpandedCliRelease({ releaseRoot: previousTree, fromVersion: candidate.version, toVersion: previousVersion })
        const previousArchive = join(scratch, `${previousName}.tar.gz`)
        await command(join(process.env.SystemRoot!, 'System32/tar.exe'), ['-czf', previousArchive, '-C', scratch, previousName])
        await install(previousArchive, createHash('sha256').update(await readFile(previousArchive)).digest('hex'))
      }
      const previousReleaseName = (await readFile(join(installDir, 'cli/current.txt'), 'utf8')).trim()
      const previousRelease = join(installDir, 'cli/releases', previousReleaseName)
      const previous = JSON.parse(await readFile(join(previousRelease, 'release.json'), 'utf8'))
      const previousExe = join(previousRelease, 'bin/openalice.exe')
      const previousEnv = { ...environment, OPENALICE_RELEASE_DIR: previousRelease,
        OPENALICE_INSTALL_SOURCE: join(installDir, 'cli/provenance', `${previousReleaseName}.json`) }
      cleanupExecutable = previousExe
      cleanupEnvironment = previousEnv
      await command(previousExe, ['up', '--home', home, '--port', String(port), '--wait', '90', '--no-update-check'], previousEnv)
      if (published) {
        const check = JSON.parse(await command(previousExe, ['update', '--check', '--channel', 'beta', '--json'], previousEnv))
        console.log('[windows-smoke] public update discovery', JSON.stringify(check))
        if (check.status !== 'available' || check.latestVersion !== candidate.version) throw new Error('Expected public beta update is unavailable')
        console.log(await command(previousExe, ['update', '--channel', 'beta', '--yes'], previousEnv))
        if ((await readFile(join(installDir, 'cli/current.txt'), 'utf8')).trim() !== releaseName) throw new Error('Live update did not activate the expected beta; manifest may have changed')
      } else {
        await install(archive, candidate.sha256)
      }
      const pending = JSON.parse(await command(executable, ['status', '--home', home, '--json'], environment)).result.status
      if (!pending.pendingActivation || pending.provider.contentIdentity !== previous.contentIdentity) throw new Error('Update did not preserve the mapped previous Runtime')
      await command(executable, ['down', '--home', home, '--wait', '30'], environment)
      await command(executable, ['rollback', '--yes'], environment)
      if ((await readFile(join(installDir, 'cli/current.txt'), 'utf8')).trim() !== previousReleaseName) throw new Error('Rollback did not restore the previous release')
      await command(previousExe, ['rollback', '--yes'], previousEnv)
      if ((await readFile(join(installDir, 'cli/current.txt'), 'utf8')).trim() !== releaseName) throw new Error('Inverse rollback did not restore the candidate')
      await command(executable, ['up', '--home', home, '--port', String(port), '--wait', '90', '--no-update-check'], environment)
      const restarted = JSON.parse(await command(executable, ['status', '--home', home, '--json'], environment)).result.status
      if (restarted.class !== 'running' || restarted.provider?.contentIdentity !== candidate.contentIdentity) throw new Error('Updated Runtime failed readiness')
      await command(executable, ['down', '--home', home, '--wait', '30'], environment)
      const marker = join(installDir, 'user-data-marker.txt')
      await writeFile(marker, 'preserve user data')
      try { console.log(await command(executable, ['uninstall', '--yes'], environment)) }
      catch (error) {
        console.log(await readFile(join(installDir, '.cli-uninstall.log'), 'utf8').catch(() => 'No helper startup log'))
        throw error
      }
      const receipt = join(installDir, '.cli-uninstall-result.json')
      const deadline = Date.now() + 90_000
      let removed: { status?: string } | undefined
      while (Date.now() < deadline) {
        try {
          removed = JSON.parse((await readFile(receipt, 'utf8')).replace(/^\uFEFF/, ''))
          if (removed?.status === 'removed' || removed?.status === 'failed') break
        }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
        await Bun.sleep(250)
      }
      if (!removed) {
        console.log(await readFile(join(installDir, '.cli-uninstall.log'), 'utf8').catch(() => 'No helper startup log'))
        // Diagnose the retained helper with the exact minimal environment. Plan
        // mode cannot remove files and exposes errors before receipt creation.
        console.log(await command(powershell, ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File', join(installDir, '.cli-uninstall.ps1'), '-InstallDir', installDir, '-Uninstall', '-Plan'], environment))
      }
      if (removed?.status !== 'removed' || await readFile(marker, 'utf8') !== 'preserve user data') throw new Error(`Data-preserving removal failed: ${JSON.stringify(removed)}`)
      uninstallReceipt = removed
      uninstalled = true
    }
    report = {
      status: 'pass', host, testedSourceCommit: sourceCommit, mode: published ? 'public-network' : 'local-candidate',
      installerSource: publishedInstaller ? 'published' : 'checkout', installerSha256: createHash('sha256').update(await readFile(installer)).digest('hex'),
      sidecar, productVersion: candidate.version, previousPublishedVersion: published ? stableVersion : null, uninstallReceipt,
      statusScope: published ? 'published binary updater and published update installer; checkout installer for initial installs unless selected otherwise' : 'synthetic previous version; local archives',
      arch: process.arch, archiveSha256: candidate.sha256,
      contentIdentity: candidate.contentIdentity, sourceCommit: candidate.sourceCommit,
      accepted: [candidate.channelBuild ? 'PowerShell managed install' : 'PowerShell ZIP install', 'detached Guardian/Alice', 'real Web UI', 'Git', 'stop',
        ...(candidate.channelBuild ? [published ? 'real stable-to-beta network update' : 'synthetic mapped-runtime update', 'bidirectional rollback', 'deferred CLI data-preserving removal'] : [])],
      remaining: ['interactive agent/provider acceptance', ...(candidate.channelBuild ? [] : ['manual upgrade/removal'])],
    }
  } finally {
    if (!uninstalled) {
      try { await command(cleanupExecutable, ['down', '--home', home, '--wait', '30'], cleanupEnvironment) }
      catch (error) { cleanupSafe = false; throw error }
    }
  }
} catch (error) {
  report = { ...report, status: 'failed', error: error instanceof Error ? error.message : String(error) }
  throw error
} finally {
  // The inner finally stops the test-owned Runtime before removal. Never remove
  // an arbitrary caller path: scratch was allocated by this invocation.
  try {
    if (!cleanupSafe) throw new Error(`Runtime stop failed; retaining owned scratch for diagnosis: ${scratch}`)
    await rm(scratch, { recursive: true, force: true })
    report.cleanupComplete = true
  } catch (error) {
    report.status = 'failed'
    report.cleanupComplete = false
    throw error
  } finally {
    await writeFile(join(outputRoot, 'native-smoke.json'), JSON.stringify(report, null, 2) + '\n')
  }
}

async function publicManifest(url: string, channel: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`)
  const manifest = await response.json() as { channel: string; version: string; windowsInstaller: { versionedUrl: string; sha256: string } }
  if (manifest.channel !== channel || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-beta(?:\.[1-9][0-9]*)?)?$/.test(manifest.version)) throw new Error('Invalid public release manifest')
  if (!manifest.windowsInstaller?.versionedUrl.startsWith('https://download.openalice.ai/') || !/^[a-f0-9]{64}$/.test(manifest.windowsInstaller.sha256)) throw new Error('Invalid public Windows installer')
  return manifest
}

async function findCandidates(directory: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await findCandidates(path))
    else if (entry.name === 'candidate.json') result.push(path)
  }
  return result
}

async function command(exe: string, args: string[], env = process.env) {
  console.log(`[windows-smoke] ${basename(exe)} ${args.includes('-Command') ? '-NoProfile -Command <host identity>' : args.join(' ')}`)
  const child = Bun.spawn([exe, ...args], { env, cwd: scratch, stdout: 'pipe', stderr: 'pipe' })
  const stdout = new Response(child.stdout).text()
  const stderr = new Response(child.stderr).text()
  // Public PowerShell downloads plus extraction are much slower than local
  // candidates (about 100s per archive on the hosted runner). Keep a bounded
  // network budget distinct from the ordinary local command deadline.
  const timeoutMs = published && (args.includes('-Version') || args[0] === 'update') ? 300_000 : 120_000
  let timedOut = false
  const timeout = setTimeout(() => { timedOut = true; child.kill() }, timeoutMs)
  try {
    const code = await child.exited
    const [out, err] = await Promise.all([stdout, stderr])
    if (code !== 0 || timedOut) throw new Error(`${exe} ${args[0]} ${timedOut ? `timed out after ${timeoutMs}ms` : `exited ${code}`}: ${err}\n${out}`)
    return out
  } finally { clearTimeout(timeout) }
}
