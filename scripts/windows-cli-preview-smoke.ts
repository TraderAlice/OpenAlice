import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

if (process.platform !== 'win32') throw new Error('Run this smoke on native Windows')
const candidateFile = resolve(process.argv[2] ?? `dist/windows-cli-preview/${process.arch}/candidate.json`)
const candidate = JSON.parse(await readFile(candidateFile, 'utf8'))
if (candidate.arch !== process.arch) throw new Error('Native smoke architecture mismatch')
const scratch = await mkdtemp(join(tmpdir(), 'openalice-preview-smoke-'))
const installDir = join(scratch, 'installed preview')
const home = join(scratch, 'alice-home')
const powershell = join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe')
await command(powershell, ['-NoProfile', '-File', resolve('install-preview.ps1'),
  '-Archive', candidate.archive, '-Sha256', candidate.sha256, '-InstallDir', installDir, '-Yes'])
const executable = join(installDir, 'bin/openalice.exe')
const portProbe = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } })
const port = portProbe.port
portProbe.stop(true)
const environment = {
  SystemRoot: process.env.SystemRoot!, WINDIR: process.env.WINDIR!,
  TEMP: scratch, TMP: scratch, HOME: scratch, USERPROFILE: scratch,
  PATH: join(process.env.SystemRoot!, 'System32'),
  OPENALICE_HOME: home, OPENALICE_TRADING_MODE: 'lite',
  OPENALICE_DISABLE_AUTH: '1', OPENALICE_BIND_HOST: '127.0.0.1',
}
try {
  await command(executable, ['up', '--home', home, '--port', String(port), '--wait', '90', '--no-update-check'], environment)
  const status = JSON.parse(await command(executable, ['status', '--home', home, '--json'], environment)).result.status
  if (status.class !== 'running' || status.provider?.kind !== 'bun' ||
      status.provider.contentIdentity !== candidate.contentIdentity ||
      !status.owner?.pid || !status.componentDetail?.alice?.pid ||
      status.owner.pid === status.componentDetail.alice.pid) throw new Error('Runtime status/identity mismatch')
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text()
  if (!html.includes('<div id="root">')) throw new Error('Real Web UI was not served')
  const git = join(installDir, 'share/openalice/runtime/git/cmd/git.exe')
  await command(git, ['--version'], environment)
  await command(executable, ['down', '--home', home, '--wait', '30'], environment)
  const stopped = JSON.parse(await command(executable, ['status', '--home', home, '--json'], environment)).result.status
  if (stopped.class === 'running') throw new Error('Runtime did not stop')
  await writeFile(resolve(candidateFile, '..', 'native-smoke.json'), JSON.stringify({
    status: 'pass', arch: process.arch, archiveSha256: candidate.sha256,
    contentIdentity: candidate.contentIdentity, sourceCommit: candidate.sourceCommit,
    accepted: ['PowerShell ZIP install', 'detached Guardian/Alice', 'real Web UI', 'Git', 'stop'],
    remaining: ['interactive agent/provider acceptance', 'manual upgrade/removal'],
  }, null, 2) + '\n')
} finally {
  await command(executable, ['down', '--home', home, '--wait', '30'], environment).catch(console.error)
}

async function command(exe: string, args: string[], env = process.env) {
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
