#!/usr/bin/env node

import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  join,
  resolve,
} from 'node:path'
import { spawnSync } from 'node:child_process'

import {
  deduplicateRuntimeTree,
  fileSha256,
  RUNTIME_BUNDLE_DIRECTORY,
  writeRuntimeBundleManifest,
} from '../packages/cli/src/runtime-bundle.mjs'

interface BuildOptions {
  outputDir: string
  skipBuild: boolean
  keepStage: boolean
}

interface RootPackage {
  name?: string
  version?: string
  engines?: {
    node?: string
  }
}

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..')
const DEFAULT_OUTPUT_DIR = resolve(REPOSITORY_ROOT, 'dist', 'headless')
const RUNTIME_RESOURCES = [
  ['dist', 'dist'],
  ['ui/dist', 'ui/dist'],
  ['default', 'default'],
  ['src/workspaces/templates', 'src/workspaces/templates'],
  ['src/workspaces/cli/bin', 'src/workspaces/cli/bin'],
  ['services/uta/dist', 'services/uta/dist'],
  ['services/uta/package.json', 'services/uta/package.json'],
  ['services/connector/dist', 'services/connector/dist'],
  ['services/connector/package.json', 'services/connector/package.json'],
  ['packages/guardian-runtime/dist', 'packages/guardian-runtime/dist'],
  ['packages/guardian-runtime/package.json', 'packages/guardian-runtime/package.json'],
  ['scripts/guardian/prod.mjs', 'scripts/guardian/prod.mjs'],
  ['scripts/guardian/control-server.mjs', 'scripts/guardian/control-server.mjs'],
  ['scripts/guardian/prod-ports.mjs', 'scripts/guardian/prod-ports.mjs'],
  ['package.json', 'package.json'],
  ['LICENSE', 'LICENSE'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
] as const

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (!['darwin', 'linux'].includes(process.platform)) {
    throw new Error(
      `Headless Runtime bundles currently support macOS and Linux, not ${process.platform}.`,
    )
  }
  if (!['arm64', 'x64'].includes(process.arch)) {
    throw new Error(
      `Headless Runtime bundles currently support arm64 and x64, not ${process.arch}.`,
    )
  }
  const rootPackage = JSON.parse(
    await readFile(join(REPOSITORY_ROOT, 'package.json'), 'utf8'),
  ) as RootPackage
  if (
    rootPackage.name !== 'open-alice'
    || typeof rootPackage.version !== 'string'
  ) {
    throw new Error('The repository package manifest is not OpenAlice.')
  }
  const productVersion = rootPackage.version
  if (!options.skipBuild) {
    run('build the server Runtime', ['build:server'])
  }
  await assertBuiltArtifacts()

  const temporaryRoot = await mkdtemp(
    join(tmpdir(), 'openalice-headless-runtime-'),
  )
  const deploymentsRoot = join(temporaryRoot, 'deployments')
  const archiveParent = join(temporaryRoot, 'archive')
  const runtimeRoot = join(archiveParent, RUNTIME_BUNDLE_DIRECTORY)
  try {
    await mkdir(deploymentsRoot, { recursive: true })
    deployProductionPackage(
      'open-alice',
      join(deploymentsRoot, 'root'),
    )
    deployProductionPackage(
      '@traderalice/uta-service',
      join(deploymentsRoot, 'uta'),
    )
    deployProductionPackage(
      '@traderalice/connector-service',
      join(deploymentsRoot, 'connector'),
    )

    await mkdir(runtimeRoot, { recursive: true })
    for (const [source, destination] of RUNTIME_RESOURCES) {
      await copyRuntimeResource(source, destination, runtimeRoot)
    }
    await moveDeploymentClosure(
      join(deploymentsRoot, 'root', 'node_modules'),
      join(runtimeRoot, 'node_modules'),
    )
    await moveDeploymentClosure(
      join(deploymentsRoot, 'uta', 'node_modules'),
      join(runtimeRoot, 'services', 'uta', 'node_modules'),
    )
    await moveDeploymentClosure(
      join(deploymentsRoot, 'connector', 'node_modules'),
      join(runtimeRoot, 'services', 'connector', 'node_modules'),
    )

    const deduplicated = await deduplicateRuntimeTree(runtimeRoot)
    const manifest = await writeRuntimeBundleManifest(runtimeRoot, {
      productVersion,
      platform: process.platform,
      arch: process.arch,
    })
    await mkdir(options.outputDir, { recursive: true })
    const stem = [
      'openalice-runtime',
      productVersion,
      process.platform,
      process.arch,
      manifest.contentIdentity,
    ].join('-')
    const archiveName = `${stem}.tar.gz`
    const archivePath = join(options.outputDir, archiveName)
    const metadataPath = join(
      options.outputDir,
      `openalice-runtime-${productVersion}-${process.platform}-${process.arch}.json`,
    )
    await rm(archivePath, { force: true })
    createArchive(archiveParent, archivePath)
    verifyArchive(archivePath)
    const archiveInfo = await stat(archivePath)
    const archiveSha256 = await fileSha256(archivePath)
    const metadata = {
      schemaVersion: 1,
      productVersion,
      platform: process.platform,
      arch: process.arch,
      node: {
        minimumVersion: '22.19.0',
      },
      runtimeContentIdentity: manifest.contentIdentity,
      archive: {
        file: archiveName,
        size: archiveInfo.size,
        sha256: archiveSha256,
      },
    }
    await writeFile(
      metadataPath,
      `${JSON.stringify(metadata, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o644 },
    )
    process.stdout.write([
      '',
      'OpenAlice headless Runtime bundle ready',
      `  Runtime   ${productVersion} ${process.platform}-${process.arch}`,
      `  Identity  ${manifest.contentIdentity}`,
      `  Files     ${manifest.files.length}`,
      `  Dedup     ${deduplicated.filesLinked} files (${formatBytes(deduplicated.bytesDeduplicated)})`,
      `  Archive   ${archivePath} (${formatBytes(archiveInfo.size)})`,
      `  SHA-256   ${archiveSha256}`,
      `  Metadata  ${metadataPath}`,
      '',
    ].join('\n'))
    if (options.keepStage) {
      const keptStage = join(options.outputDir, `${stem}.stage`)
      await rm(keptStage, { recursive: true, force: true })
      await rename(runtimeRoot, keptStage)
      process.stdout.write(`  Stage     ${keptStage}\n`)
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

function parseArgs(argv: string[]): BuildOptions {
  const options: BuildOptions = {
    outputDir: DEFAULT_OUTPUT_DIR,
    skipBuild: false,
    keepStage: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--output-dir') {
      const value = argv[index + 1]
      if (!value || value.startsWith('-')) {
        throw new Error('--output-dir requires a path.')
      }
      options.outputDir = resolve(value)
      index += 1
      continue
    }
    if (arg === '--skip-build') {
      options.skipBuild = true
      continue
    }
    if (arg === '--keep-stage') {
      options.keepStage = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`Usage:
  pnpm build:headless-runtime [options]

Build a platform-specific OpenAlice Runtime archive from production dependency
closures. The archive does not contain Electron or source-build tooling.

Options:
  --output-dir <path>  Artifact directory (default: dist/headless)
  --skip-build         Reuse existing server build artifacts
  --keep-stage         Preserve the verified expanded Runtime beside the archive
  -h, --help           Show this help
`)
      process.exit(0)
    }
    throw new Error(`Unknown option: ${arg}`)
  }
  return options
}

function deployProductionPackage(
  packageName: string,
  destination: string,
): void {
  run(`deploy ${packageName}`, [
    '--config.inject-workspace-packages=true',
    '--filter',
    packageName,
    'deploy',
    '--prod',
    destination,
  ])
}

function run(label: string, args: string[]): void {
  process.stdout.write(`\n[headless-runtime] ${label}\n`)
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${String(result.status)}.`)
  }
}

function createArchive(
  archiveParent: string,
  archivePath: string,
): void {
  process.stdout.write('\n[headless-runtime] create archive\n')
  const result = spawnSync('tar', [
    '-czf',
    archivePath,
    '-C',
    archiveParent,
    RUNTIME_BUNDLE_DIRECTORY,
  ], {
    cwd: REPOSITORY_ROOT,
    env: {
      ...process.env,
      COPYFILE_DISABLE: '1',
    },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `Creating the Runtime archive failed with exit code ${String(result.status)}.`,
    )
  }
}

function verifyArchive(archivePath: string): void {
  const result = spawnSync('tar', ['-tzf', archivePath], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `Verifying the Runtime archive failed with exit code ${String(result.status)}.`,
    )
  }
  const entries = result.stdout.split(/\r?\n/).filter(Boolean)
  if (
    entries.length === 0
    || entries.some((entry) => (
      entry !== RUNTIME_BUNDLE_DIRECTORY
      && entry !== `${RUNTIME_BUNDLE_DIRECTORY}/`
      && !entry.startsWith(`${RUNTIME_BUNDLE_DIRECTORY}/`)
    ))
  ) {
    throw new Error('The Runtime archive contains an unexpected path.')
  }
}

async function copyRuntimeResource(
  source: string,
  destination: string,
  runtimeRoot: string,
): Promise<void> {
  const sourcePath = join(REPOSITORY_ROOT, source)
  const destinationPath = join(runtimeRoot, destination)
  await mkdir(resolve(destinationPath, '..'), { recursive: true })
  await cp(sourcePath, destinationPath, {
    recursive: true,
    force: true,
    preserveTimestamps: true,
  })
}

async function moveDeploymentClosure(
  source: string,
  destination: string,
): Promise<void> {
  await mkdir(resolve(destination, '..'), { recursive: true })
  await rename(source, destination)
}

async function assertBuiltArtifacts(): Promise<void> {
  for (const path of [
    'dist/main.js',
    'ui/dist/index.html',
    'services/uta/dist/uta.js',
    'services/connector/dist/connector.cjs',
    'packages/guardian-runtime/dist/index.js',
  ]) {
    try {
      await stat(join(REPOSITORY_ROOT, path))
    } catch {
      throw new Error(
        `Missing ${path}; run pnpm build:server before --skip-build.`,
      )
    }
  }
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB']
  let value = bytes
  let unit = units[0]
  for (let index = 1; index < units.length && value >= 1_024; index += 1) {
    value /= 1_024
    unit = units[index]
  }
  return `${value.toFixed(value >= 10 || unit === 'B' ? 0 : 1)} ${unit}`
}

main().catch((error: unknown) => {
  process.stderr.write(
    `[headless-runtime] ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exitCode = 1
})
