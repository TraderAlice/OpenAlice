import { cp, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { rewriteExpandedCliRelease, syntheticPreviousVersion } from './cli-release-fixture.mjs'

if (process.platform !== 'win32') throw new Error('Run this smoke on native Windows')
const outputRoot = resolve(`dist/windows-cli-preview/${process.arch}`)
const candidates = process.argv[2] ? [resolve(process.argv[2])] : await findCandidates(outputRoot)
if (candidates.length !== 1) throw new Error(`Expected one candidate for this architecture, found ${candidates.length}`)
const candidateFile = candidates[0]!
const candidate = JSON.parse(await readFile(candidateFile, 'utf8'))
// Actions downloads have a new filesystem root. The candidate's ZIP and
// checksum travel together; never execute paths recorded on the old runner.
const archive = join(dirname(candidateFile), basename(candidate.archive))
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
await command(powershell, ['-NoProfile', '-File', resolve(candidate.channelBuild ? 'install.ps1' : 'install-preview.ps1'),
  '-Archive', archive, '-Sha256', candidate.sha256, '-InstallDir', installDir,
  ...(candidate.channelBuild ? ['-Channel', candidate.version.includes('-beta') ? 'beta' : 'stable', '-NoModifyPath'] : []), '-Yes'], powershellEnv)
const releaseName = candidate.channelBuild ? (await readFile(join(installDir, 'cli/current.txt'), 'utf8')).trim() : null
const releaseDir = releaseName ? join(installDir, 'cli/releases', releaseName) : installDir
const executable = join(releaseDir, 'bin/openalice.exe')
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
  TEMP: scratch, TMP: scratch, HOME: scratch, USERPROFILE: process.env.USERPROFILE!,
  PATH: join(process.env.SystemRoot!, 'System32'),
  OPENALICE_HOME: home, OPENALICE_TRADING_MODE: 'lite',
  OPENALICE_DISABLE_AUTH: '1', OPENALICE_BIND_HOST: '127.0.0.1',
  ...(releaseName ? {
    OPENALICE_INSTALL_ROOT: installDir, OPENALICE_RELEASE_DIR: releaseDir,
    OPENALICE_INSTALL_SOURCE: join(installDir, 'cli/provenance', `${releaseName}.json`),
  } : {}),
}
let uninstalled = false
try {
  await command(executable, ['up', '--home', home, '--port', String(port), '--wait', '90', '--no-update-check'], environment)
  const status = JSON.parse(await command(executable, ['status', '--home', home, '--json'], environment)).result.status
  if (status.class !== 'running' || status.provider?.kind !== 'bun' ||
      status.provider.contentIdentity !== candidate.contentIdentity ||
      !status.owner?.pid || !status.componentDetail?.alice?.pid ||
      status.owner.pid === status.componentDetail.alice.pid) throw new Error('Runtime status/identity mismatch')
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text()
  if (!html.includes('<div id="root">')) throw new Error('Real Web UI was not served')
  const git = join(releaseDir, 'share/openalice/runtime/git/cmd/git.exe')
  await command(git, ['--version'], environment)
  await command(executable, ['down', '--home', home, '--wait', '30'], environment)
  const stopped = JSON.parse(await command(executable, ['status', '--home', home, '--json'], environment)).result.status
  if (stopped.class === 'running') throw new Error('Runtime did not stop')
  if (candidate.channelBuild) {
    const channel = candidate.version.includes('-beta') ? 'beta' : 'stable'
    const previousVersion = syntheticPreviousVersion(candidate.version)
    const previousName = `openalice-cli-${previousVersion}-win32-${process.arch}`
    const previousTree = join(scratch, previousName)
    await cp(releaseDir, previousTree, { recursive: true })
    const previous = rewriteExpandedCliRelease({ releaseRoot: previousTree, fromVersion: candidate.version, toVersion: previousVersion })
    const previousArchive = join(scratch, `${previousName}.tar.gz`)
    await command(join(process.env.SystemRoot!, 'System32/tar.exe'), ['-czf', previousArchive, '-C', scratch, previousName])
    const previousSha256 = createHash('sha256').update(await readFile(previousArchive)).digest('hex')
    const install = async (path: string, hash: string) => command(powershell, [
      '-NoProfile', '-File', resolve('install.ps1'), '-Archive', path, '-Sha256', hash,
      '-InstallDir', installDir, '-Channel', channel, '-NoModifyPath', '-Yes',
    ], powershellEnv)
    await install(previousArchive, previousSha256)
    const previousReleaseName = (await readFile(join(installDir, 'cli/current.txt'), 'utf8')).trim()
    const previousRelease = join(installDir, 'cli/releases', previousReleaseName)
    const previousExe = join(previousRelease, 'bin/openalice.exe')
    const previousEnv = { ...environment, OPENALICE_RELEASE_DIR: previousRelease,
      OPENALICE_INSTALL_SOURCE: join(installDir, 'cli/provenance', `${previousReleaseName}.json`) }
    await command(previousExe, ['up', '--home', home, '--port', String(port), '--wait', '90', '--no-update-check'], previousEnv)
    await install(archive, candidate.sha256)
    const pending = JSON.parse(await command(executable, ['status', '--home', home, '--json'], environment)).result.status
    if (!pending.pendingActivation || pending.provider.contentIdentity !== previous.contentIdentity) throw new Error('Update did not preserve the mapped previous Runtime')
    await command(executable, ['down', '--home', home, '--wait', '30'], environment)
    await command(executable, ['rollback', '--yes'], environment)
    if ((await readFile(join(installDir, 'cli/current.txt'), 'utf8')).trim() !== previousReleaseName) throw new Error('Rollback did not restore the previous release')
    await command(previousExe, ['rollback', '--yes'], previousEnv)
    if ((await readFile(join(installDir, 'cli/current.txt'), 'utf8')).trim() !== releaseName) throw new Error('Inverse rollback did not restore the candidate')
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
    uninstalled = true
  }
  await writeFile(join(outputRoot, 'native-smoke.json'), JSON.stringify({
    status: 'pass', arch: process.arch, archiveSha256: candidate.sha256,
    contentIdentity: candidate.contentIdentity, sourceCommit: candidate.sourceCommit,
    accepted: [candidate.channelBuild ? 'PowerShell managed install' : 'PowerShell ZIP install', 'detached Guardian/Alice', 'real Web UI', 'Git', 'stop',
      ...(candidate.channelBuild ? ['mapped-runtime update', 'bidirectional rollback', 'deferred CLI data-preserving removal'] : [])],
    remaining: ['interactive agent/provider acceptance', ...(candidate.channelBuild ? [] : ['manual upgrade/removal'])],
  }, null, 2) + '\n')
} finally {
  if (!uninstalled) await command(executable, ['down', '--home', home, '--wait', '30'], environment).catch(console.error)
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
  console.log(`[windows-smoke] ${basename(exe)} ${args[0]}`)
  const child = Bun.spawn([exe, ...args], { env, cwd: scratch, stdout: 'pipe', stderr: 'pipe' })
  const stdout = new Response(child.stdout).text()
  const stderr = new Response(child.stderr).text()
  const timeout = setTimeout(() => child.kill(), 120_000)
  try {
    const code = await child.exited
    const [out, err] = await Promise.all([stdout, stderr])
    if (code !== 0) throw new Error(`${exe} ${args[0]} exited ${code}: ${err}\n${out}`)
    return out
  } finally { clearTimeout(timeout) }
}
