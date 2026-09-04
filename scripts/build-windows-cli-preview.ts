import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { bunReleaseContentIdentity } from './bun-release-content-identity.mjs'
import { resolveWindowsGitRuntimeSpec } from './vendor-managed-runtime.mjs'

// A deliberately independent preview lane. No stable/beta/dev aliases and no
// npm publication are mutated by this build. Native smoke is a separate step,
// so a failed smoke never discards the package needed to reproduce it.
const root = fileURLToPath(new URL('..', import.meta.url))
const arch = process.argv[2] ?? process.arch
if (!['x64', 'arm64'].includes(arch)) throw new Error(`Unsupported Windows architecture: ${arch}`)
const pinned = (await readFile(join(root, '.bun-version'), 'utf8')).trim()
if (Bun.version !== pinned) throw new Error(`Expected Bun ${pinned}, found ${Bun.version}`)
const product = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const cli = JSON.parse(await readFile(join(root, 'packages/cli/package.json'), 'utf8'))
if (product.version !== cli.version) throw new Error('Product and CLI versions must match')
const version: string = product.version
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Invalid product version')
const sourceCommit = run(['git', 'rev-parse', 'HEAD']).trim()
const sourceDirty = run(['git', 'status', '--porcelain']).trim().length > 0
const output = resolve(process.env.OPENALICE_BUN_OUTPUT_DIR ?? join(root, 'dist/windows-cli-preview', arch))
await mkdir(output, { recursive: true })
const staging = await mkdtemp(join(output, 'build-'))
const name = `openalice-cli-${version}-windows-${arch}-${sourceCommit.slice(0,8)}${sourceDirty ? '-dirty' : ''}`
const release = join(staging, name)
const resources = join(release, 'share/openalice')
const executable = join(release, 'bin/openalice.exe')
await mkdir(dirname(executable), { recursive: true })
await mkdir(resources, { recursive: true })
await stat(join(root, 'ui/dist/index.html'))
const built = await Bun.build({
  entrypoints: [join(root, 'packages/cli/bin/openalice-bun.ts')],
  compile: {
    target: `bun-windows-${arch}` as 'bun-windows-x64' | 'bun-windows-arm64',
    outfile: executable,
    autoloadBunfig: false,
    autoloadDotenv: false,
  },
  define: {
    'globalThis.__OPENALICE_BUILD_VERSION__': JSON.stringify(version),
    'globalThis.__OPENALICE_BUN_STANDALONE__': 'true',
  },
  minify: true,
})
if (!built.success) throw new Error(built.logs.map(String).join('\n'))
for (const path of ['ui/dist', 'default', 'src/workspaces/templates']) {
  await cp(join(root, path), join(resources, path), { recursive: true, dereference: true })
}
await cp(join(root, 'package.json'), join(resources, 'package.json'))
for (const path of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await cp(join(root, path), join(release, path))
const helperDir = join(resources, 'src/workspaces/cli/bin')
await mkdir(helperDir, { recursive: true })
await cp(join(root, 'src/workspaces/cli/bin/pi-session-provider.ts'), join(helperDir, 'pi-session-provider.ts'))
for (const helper of ['alice', 'alice-workspace', 'alice-uta', 'traderhub']) {
  await writeFile(join(helperDir, `${helper}.cmd`),
    `@echo off\r\nif not defined OPENALICE_RUNTIME_EXECUTABLE exit /b 1\r\n"%OPENALICE_RUNTIME_EXECUTABLE%" --workspace-cli ${helper} %*\r\n`)
  // Git Bash is also an ordinary Workspace surface. Avoid MSYS translating
  // /cli URLs, named pipes, or native Windows executable paths.
  await writeFile(join(helperDir, helper), `#!/bin/sh
set -eu
: "\${OPENALICE_RUNTIME_EXECUTABLE:?OpenAlice Runtime executable is not configured}"
export MSYS_NO_PATHCONV=1
export MSYS2_ENV_CONV_EXCL='OPENALICE_TOOL_URL;OPENALICE_TOOL_SOCKET'
exec "$(cygpath -u "$OPENALICE_RUNTIME_EXECUTABLE")" --workspace-cli ${helper} "$@"
`, { mode: 0o755 })
}

const git = resolveWindowsGitRuntimeSpec({ platform: 'win32', arch })!
const gitArchive = join(staging, basename(git.url))
const response = await fetch(git.url, { signal: AbortSignal.timeout(180_000) })
if (!response.ok) throw new Error(`PortableGit download: HTTP ${response.status}`)
const gitBytes = new Uint8Array(await response.arrayBuffer())
if (sha256(gitBytes) !== git.sha256) throw new Error('PortableGit SHA-256 mismatch')
await writeFile(gitArchive, gitBytes)
const gitRoot = join(resources, 'runtime/git')
await mkdir(gitRoot, { recursive: true })
if (process.platform === 'win32' && arch === process.arch) {
  run([gitArchive, '-y', `-o${gitRoot}`])
} else {
  // Cross-builds extract data; they never execute the target's installer.
  run([process.env.OPENALICE_7ZIP ?? '7zz', 'x', '-y', `-o${gitRoot}`, gitArchive])
}
for (const path of [git.gitBin, git.shellPath, git.shPath]) await stat(join(gitRoot, path))
await cp(join(root, 'install-preview.ps1'), join(release, 'install-preview.ps1'))
await writeFile(join(release, 'install-source.json'), JSON.stringify({
  schemaVersion: 2, repository: 'TraderAlice/OpenAlice', cliVersion: version,
  selector: { kind: 'branch', value: sourceCommit },
  installerUrl: 'https://github.com/TraderAlice/OpenAlice', updateChannel: 'custom',
}, null, 2) + '\n')
// Portable metadata is custom/non-updating, not a direct install with managed
// current/rollback pointers. The external ZIP sidecar binds the entire package.
const unsigned = {
  schemaVersion: 1, product: 'OpenAlice CLI', version, platform: 'win32', arch,
  bunVersion: Bun.version, sourceCommit, sourceDirty, preview: true,
  executable: 'bin/openalice.exe', resourceRoot: 'share/openalice',
  git: { source: 'PortableGit', sourceVersion: git.version, sourceSha256: git.sha256 },
  files: await files(release),
}
const metadata = { ...unsigned, contentIdentity: bunReleaseContentIdentity(unsigned) }
await writeFile(join(release, 'release.json'), JSON.stringify(metadata, null, 2) + '\n')
const archive = join(output, `${name}.zip`)
// Do not overwrite an older candidate or update an existing ZIP in place.
try { await stat(archive); throw new Error(`Candidate already exists: ${archive}`) }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
if (process.platform === 'win32') run(['tar.exe', '-a', '-cf', archive, '-C', staging, name])
else run(['zip', '-qr', archive, name], staging)
const digest = sha256(await readFile(archive))
await writeFile(`${archive}.sha256`, `${digest}  ${basename(archive)}\n`)
await cp(join(root, 'install-preview.ps1'), join(output, 'install-preview.ps1'))
await writeFile(join(output, 'candidate.json'), JSON.stringify({
  archive, sha256: digest, release, executable, sourceCommit, sourceDirty, version, arch,
  contentIdentity: metadata.contentIdentity, runtimeVerification: 'not-run',
}, null, 2) + '\n')
console.log(`Windows ${arch} preview built (native runtime verification pending): ${archive}`)

function run(command: string[], cwd = root) {
  const child = Bun.spawnSync(command, { cwd, stdout: 'pipe', stderr: 'pipe' })
  if (child.exitCode !== 0) throw new Error(`${command[0]} failed: ${child.stderr.toString()}`)
  return child.stdout.toString()
}
function sha256(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex') }
async function files(directory: string): Promise<Array<{ path: string; type: 'file'; bytes: number; mode: number; sha256: string }>> {
  const result: Array<{ path: string; type: 'file'; bytes: number; mode: number; sha256: string }> = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await files(path))
    else if (entry.isFile()) {
      const bytes = await readFile(path)
      result.push({ path: relative(release, path).replaceAll('\\', '/'), type: 'file',
        bytes: bytes.length, mode: (await stat(path)).mode & 0o777, sha256: sha256(bytes) })
    } else throw new Error(`Windows preview cannot contain special files: ${path}`)
  }
  return result
}
