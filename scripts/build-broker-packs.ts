/** Build platform-specific, self-contained broker-pack release archives. */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import * as tar from 'tar'
import {
  BROKER_PACK_API_VERSION,
  INSTALLABLE_BROKER_ENGINES,
  type InstallableBrokerEngine,
} from '../src/core/broker-packs.js'
import {
  brokerPackArchiveFileName,
  brokerPackCatalogFileName,
  type BrokerPackReleaseAsset,
  type BrokerPackRequirement,
  type BrokerPackReleaseCatalog,
} from '../src/core/broker-pack-catalog.js'
import { composePnpmCommand } from './pnpm-command.mjs'

const repoRoot = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8')) as { version: string }
const outputArg = process.argv.indexOf('--out-dir')
const outDir = resolve(repoRoot, outputArg >= 0 ? process.argv[outputArg + 1] : 'dist/broker-packs')

const packageNames: Record<InstallableBrokerEngine, string> = {
  ccxt: '@traderalice/uta-broker-ccxt',
  alpaca: '@traderalice/uta-broker-alpaca',
  ibkr: '@traderalice/uta-broker-ibkr',
  leverup: '@traderalice/uta-broker-leverup',
  longbridge: '@traderalice/uta-broker-longbridge',
}

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

const tempRoot = await mkdtemp(resolve(tmpdir(), 'openalice-broker-packs-'))
const packs: BrokerPackReleaseAsset[] = []
try {
  for (const engine of INSTALLABLE_BROKER_ENGINES) {
    const deployRoot = resolve(tempRoot, engine)
    deployPackage(packageNames[engine], deployRoot)
    await sanitizeDeployment(engine, deployRoot)

    const file = brokerPackArchiveFileName(packageJson.version, engine)
    const archivePath = resolve(outDir, file)
    await tar.c({ gzip: true, cwd: deployRoot, file: archivePath, portable: true }, ['.'])
    const archiveStat = await stat(archivePath)
    packs.push({
      engine,
      version: packageJson.version,
      apiVersion: BROKER_PACK_API_VERSION,
      file: basename(archivePath),
      sha256: await sha256File(archivePath),
      size: archiveStat.size,
      entry: 'dist/index.js',
      ...requirementsFor(engine),
    })
    console.log(`[broker-packs] ${engine} -> ${file} (${formatBytes(archiveStat.size)})`)
  }

  const catalog: BrokerPackReleaseCatalog = {
    schemaVersion: 1,
    openAliceVersion: packageJson.version,
    platform: process.platform,
    arch: process.arch,
    generatedAt: new Date().toISOString(),
    packs,
  }
  const catalogPath = resolve(outDir, brokerPackCatalogFileName(packageJson.version))
  await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n')
  console.log(`[broker-packs] catalog -> ${catalogPath}`)
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

function deployPackage(packageName: string, target: string): void {
  const command = composePnpmCommand([
    '--config.inject-workspace-packages=true',
    '--filter', packageName,
    'deploy', '--prod', target,
  ])
  const result = spawnSync(command.command, command.args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`pnpm deploy failed for ${packageName} (${result.status})`)
}

async function sanitizeDeployment(engine: InstallableBrokerEngine, deployRoot: string): Promise<void> {
  const deployedPackagePath = resolve(deployRoot, 'package.json')
  const deployedPackage = JSON.parse(await readFile(deployedPackagePath, 'utf8')) as {
    dependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
  }
  const releasePackage = {
    name: packageNames[engine],
    version: packageJson.version,
    type: 'module',
    main: './dist/index.js',
    exports: { '.': './dist/index.js' },
    dependencies: externalDependencies(deployedPackage.dependencies),
    optionalDependencies: externalDependencies(deployedPackage.optionalDependencies),
  }

  await Promise.all([
    rm(resolve(deployRoot, 'pnpm-lock.yaml'), { force: true }),
    rm(resolve(deployRoot, 'pnpm-workspace.yaml'), { force: true }),
    rm(resolve(deployRoot, 'node_modules', '.modules.yaml'), { force: true }),
    rm(resolve(deployRoot, 'node_modules', '.pnpm-workspace-state-v1.json'), { force: true }),
    rm(resolve(deployRoot, 'node_modules', '.pnpm', 'lock.yaml'), { force: true }),
    rm(resolve(deployRoot, 'node_modules', '@traderalice'), { recursive: true, force: true }),
    rm(resolve(deployRoot, 'node_modules', '.pnpm', 'node_modules', '@traderalice'), { recursive: true, force: true }),
  ])
  const virtualStore = resolve(deployRoot, 'node_modules', '.pnpm')
  for (const entry of await readdir(virtualStore, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('@traderalice+')) {
      await rm(resolve(virtualStore, entry.name), { recursive: true, force: true })
    }
  }
  await writeFile(deployedPackagePath, JSON.stringify(releasePackage, null, 2) + '\n')
}

function externalDependencies(dependencies: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dependencies ?? {}).filter(([name]) => !name.startsWith('@traderalice/')),
  )
}

function requirementsFor(engine: InstallableBrokerEngine): { requirements?: BrokerPackRequirement } {
  if (engine === 'longbridge' && process.platform === 'linux') {
    // longbridge 4.0.5's current GNU prebuild links against glibc 2.39.
    // Refuse before module evaluation on older Ubuntu/WSL installations.
    return { requirements: { libc: { family: 'glibc', minVersion: '2.39' } } }
  }
  return {}
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}
