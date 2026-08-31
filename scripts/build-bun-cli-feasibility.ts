import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const pinnedBunVersion = (await readFile(join(repositoryRoot, '.bun-version'), 'utf8')).trim()

if (Bun.version !== pinnedBunVersion) {
  throw new Error(`Bun ${pinnedBunVersion} is required, but ${Bun.version} is running`)
}

const cliPackage = JSON.parse(
  await readFile(join(repositoryRoot, 'packages/cli/package.json'), 'utf8'),
) as { version?: unknown }
if (typeof cliPackage.version !== 'string' || cliPackage.version.length === 0) {
  throw new Error('packages/cli/package.json must contain a version')
}

const outputRoot = resolve(
  process.env['OPENALICE_BUN_OUTPUT_DIR']
    ?? join(repositoryRoot, 'dist/bun-cli-feasibility'),
)
const executableName = process.platform === 'win32' ? 'openalice.exe' : 'openalice'
const executablePath = join(outputRoot, executableName)

await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })
process.chdir(outputRoot)

const buildStartedAt = performance.now()
const result = await Bun.build({
  entrypoints: [join(repositoryRoot, 'packages/cli/bin/openalice.ts')],
  compile: {
    outfile: executablePath,
    autoloadBunfig: false,
    autoloadDotenv: false,
  },
  define: {
    'globalThis.__OPENALICE_BUILD_VERSION__': JSON.stringify(cliPackage.version),
  },
  minify: true,
})
const buildDurationMs = performance.now() - buildStartedAt

if (!result.success) {
  for (const log of result.logs) console.error(log)
  throw new Error('Bun CLI feasibility build failed')
}

const smokeEnvironment = minimalSmokeEnvironment(outputRoot)
const version = runProbe(executablePath, ['--version'], smokeEnvironment)
if (version.stdout.trim() !== cliPackage.version) {
  throw new Error(
    `compiled CLI reported ${JSON.stringify(version.stdout.trim())}, expected ${cliPackage.version}`,
  )
}

const help = runProbe(executablePath, ['--help'], smokeEnvironment)
if (!help.stdout.includes('openalice')) {
  throw new Error('compiled CLI help did not contain the openalice command name')
}

const versionJson = runProbe(executablePath, ['version', '--json'], smokeEnvironment)
const versionMetadata = JSON.parse(versionJson.stdout) as { version?: unknown }
if (versionMetadata.version !== cliPackage.version) {
  throw new Error('compiled CLI version metadata did not use the build-time product version')
}

const status = runProbe(
  executablePath,
  ['status', '--home', join(outputRoot, 'smoke-home'), '--json'],
  smokeEnvironment,
)
const statusEnvelope = JSON.parse(status.stdout) as {
  ok?: unknown
  result?: { status?: { class?: unknown } }
}
if (statusEnvelope.ok !== true || statusEnvelope.result?.status?.class !== 'absent') {
  throw new Error('compiled CLI could not inspect an isolated absent Runtime')
}

const executable = await stat(executablePath)
const report = {
  schemaVersion: 1,
  status: 'pass',
  productVersion: cliPackage.version,
  bunVersion: Bun.version,
  platform: process.platform,
  arch: process.arch,
  executable: basename(executablePath),
  executableBytes: executable.size,
  buildDurationMs: Math.round(buildDurationMs),
  versionProbeDurationMs: version.durationMs,
  helpProbeDurationMs: help.durationMs,
  metadataProbeDurationMs: versionJson.durationMs,
  statusProbeDurationMs: status.durationMs,
  smokePath: smokeEnvironment.PATH,
}
await writeFile(join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)

console.log(`Bun CLI feasibility build passed: ${executablePath}`)
console.log(JSON.stringify(report))

function runProbe(
  executable: string,
  args: string[],
  env: Record<string, string>,
): { stdout: string; durationMs: number } {
  const startedAt = performance.now()
  const probe = Bun.spawnSync([executable, ...args], {
    cwd: outputRoot,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const durationMs = Math.round(performance.now() - startedAt)
  const stdout = probe.stdout.toString()
  const stderr = probe.stderr.toString()
  if (probe.exitCode !== 0) {
    throw new Error(
      `${basename(executable)} ${args.join(' ')} failed with ${probe.exitCode}: ${stderr || stdout}`,
    )
  }
  return { stdout, durationMs }
}

function minimalSmokeEnvironment(home: string): Record<string, string> {
  if (process.platform === 'win32') {
    return {
      HOME: home,
      PATH: '',
      USERPROFILE: home,
      ...(process.env['SystemRoot'] ? { SystemRoot: process.env['SystemRoot'] } : {}),
      ...(process.env['WINDIR'] ? { WINDIR: process.env['WINDIR'] } : {}),
    }
  }
  return {
    HOME: home,
    PATH: '',
    TMPDIR: process.env['TMPDIR'] ?? '/tmp',
  }
}
