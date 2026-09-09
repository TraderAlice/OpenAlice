/** Verify generated Broker Pack catalogs and import every release artifact. */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as tar from 'tar'

import {
  BROKER_PACK_API_VERSION,
  INSTALLABLE_BROKER_ENGINES,
  type InstallableBrokerEngine,
} from '../src/core/broker-packs.js'
import {
  brokerPackCatalogFileName,
  type BrokerPackReleaseAsset,
  type BrokerPackReleaseCatalog,
} from '../src/core/broker-pack-catalog.js'

const repoRoot = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8')) as { version: string }
const outputArg = process.argv.indexOf('--out-dir')
const outDir = resolve(repoRoot, outputArg >= 0 ? process.argv[outputArg + 1] : 'dist/broker-packs')
const catalogPath = resolve(outDir, brokerPackCatalogFileName(packageJson.version))
const catalog = parseCatalog(JSON.parse(await readFile(catalogPath, 'utf8')))

const expectedEngines = new Set<string>(INSTALLABLE_BROKER_ENGINES)
const actualEngines = new Set(catalog.packs.map((asset) => asset.engine))
if (catalog.packs.length !== expectedEngines.size || actualEngines.size !== expectedEngines.size) {
  throw new Error(`Broker Pack catalog must contain each engine exactly once; got ${catalog.packs.map((row) => row.engine).join(', ')}`)
}
for (const engine of expectedEngines) {
  if (!actualEngines.has(engine)) throw new Error(`Broker Pack catalog is missing ${engine}`)
}

const compiled = process.argv.includes('--compiled')
let compiledProbe: string | undefined
const tempRoot = await mkdtemp(resolve(tmpdir(), 'openalice-broker-pack-verify-'))
try {
  if (compiled) {
    const probe = resolve(tempRoot, 'probe.ts')
    const options = pathToFileURL(resolve(repoRoot, 'scripts/bun-compile-options.ts')).href
    const builder = resolve(tempRoot, 'build.ts')
    compiledProbe = resolve(tempRoot, process.platform === 'win32' ? 'probe.exe' : 'probe')
    await writeFile(probe, `
const m = await import(process.argv[2]);
const engine = process.argv[3];
if (m.BROKER_ENGINE !== engine || m.BROKER_PACK_API_VERSION !== 1) throw new Error('Invalid pack');
const configs = {
  ccxt: {exchange:'binance', keyless:true}, alpaca:{paper:true}, ibkr:{},
  leverup:{network:'testnet',privateKey:'0x'+'1'.repeat(64)},
  longbridge:{appKey:'offline',appSecret:'offline',accessToken:'offline',paper:true},
};
const broker = m.createBroker({id:'offline-pack-smoke',brokerConfig:configs[engine]});
if (typeof broker.getAccount !== 'function') throw new Error('Invalid broker');
await broker.close();
console.log('COMPILED_PACK_OK', engine);
`)
    await writeFile(builder, `import {runtimeCompileOptions} from ${JSON.stringify(options)};
const r=await Bun.build({entrypoints:[${JSON.stringify(probe)}],compile:{...runtimeCompileOptions,outfile:${JSON.stringify(compiledProbe)}}}); if(!r.success) throw new Error(String(r.logs));`)
    const result = spawnSync('bun', [builder], {cwd: tempRoot, encoding:'utf8', timeout:120_000})
    if (result.error || result.status !== 0) throw new Error(`Compiled probe build failed: ${result.error ?? result.stderr}`)
  }
  for (const asset of catalog.packs) await verifyAsset(asset, tempRoot)
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

console.log(`[broker-packs] verified ${catalog.packs.length} release artifacts for ${process.platform}-${process.arch}`)

function parseCatalog(raw: unknown): BrokerPackReleaseCatalog {
  if (!raw || typeof raw !== 'object') throw new Error('Broker Pack catalog is not an object')
  const row = raw as Partial<BrokerPackReleaseCatalog>
  if (
    row.schemaVersion !== 1
    || row.openAliceVersion !== packageJson.version
    || row.platform !== process.platform
    || row.arch !== process.arch
    || !Array.isArray(row.packs)
  ) {
    throw new Error(`Broker Pack catalog does not match OpenAlice ${packageJson.version} on ${process.platform}-${process.arch}`)
  }
  return row as BrokerPackReleaseCatalog
}

async function verifyAsset(asset: BrokerPackReleaseAsset, root: string): Promise<void> {
  if (!INSTALLABLE_BROKER_ENGINES.includes(asset.engine as InstallableBrokerEngine)) {
    throw new Error(`Unknown Broker Pack engine: ${asset.engine}`)
  }
  if (asset.version !== packageJson.version) throw new Error(`${asset.engine} version mismatch: ${asset.version}`)
  if (asset.apiVersion !== BROKER_PACK_API_VERSION) throw new Error(`${asset.engine} API mismatch: ${asset.apiVersion}`)
  if (basename(asset.file) !== asset.file) throw new Error(`${asset.engine} has an unsafe asset filename`)
  if (!/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error(`${asset.engine} has an invalid SHA-256`)

  const archive = resolve(outDir, asset.file)
  const archiveStat = await stat(archive)
  if (archiveStat.size !== asset.size) {
    throw new Error(`${asset.engine} size mismatch: catalog=${asset.size}, file=${archiveStat.size}`)
  }
  const digest = await sha256File(archive)
  if (digest !== asset.sha256) throw new Error(`${asset.engine} SHA-256 mismatch`)

  const packageRoot = resolve(root, asset.engine)
  await mkdir(packageRoot)
  await tar.x({ file: archive, cwd: packageRoot, strict: true, preservePaths: false })
  const pkg = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8')) as {
    name?: unknown
    version?: unknown
    dependencies?: Record<string, unknown>
    optionalDependencies?: Record<string, unknown>
  }
  if (pkg.name !== `@traderalice/uta-broker-${asset.engine}` || pkg.version !== packageJson.version) {
    throw new Error(`${asset.engine} archive package identity mismatch`)
  }
  await verifyPortableDeployment(asset.engine, packageRoot, pkg)

  const [realRoot, realEntry] = await Promise.all([
    realpath(packageRoot),
    realpath(resolve(packageRoot, asset.entry)),
  ])
  if (realEntry === realRoot || !realEntry.startsWith(`${realRoot}${sep}`)) {
    throw new Error(`${asset.engine} entry escapes its extracted archive`)
  }

  verifyModuleInCleanProcess(asset.engine, realEntry, packageRoot)
  if (compiledProbe) {
    const result = spawnSync(compiledProbe, [realEntry, asset.engine], {cwd:packageRoot, encoding:'utf8', timeout:60_000, env:{...process.env, NODE_PATH:''}})
    if (result.error || result.status !== 0 || !result.stdout.includes('COMPILED_PACK_OK')) {
      throw new Error(`${asset.engine} compiled import/construction failed: ${result.error ?? result.stderr}`)
    }
    console.log(result.stdout.trim())
  }
  await rm(packageRoot, { recursive: true, force: true })
  console.log(`[broker-packs] verified ${asset.engine} (${formatBytes(asset.size)})`)
}

async function verifyPortableDeployment(
  engine: InstallableBrokerEngine,
  packageRoot: string,
  pkg: { dependencies?: Record<string, unknown>; optionalDependencies?: Record<string, unknown> },
): Promise<void> {
  for (const [name, spec] of Object.entries({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
    if (name.startsWith('@traderalice/')) throw new Error(`${engine} archive contains an unbundled workspace dependency: ${name}`)
    if (typeof spec !== 'string' || /^(?:file|link|workspace):/.test(spec) || spec.includes('file://')) {
      throw new Error(`${engine} archive contains a non-portable dependency spec: ${name}@${String(spec)}`)
    }

    const dependencyPath = resolve(packageRoot, 'node_modules', ...name.split('/'))
    let dependencyStat
    try {
      dependencyStat = await lstat(dependencyPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`${engine} archive is missing declared dependency: ${name}`)
      }
      throw error
    }
    if (!dependencyStat.isDirectory() || dependencyStat.isSymbolicLink()) {
      throw new Error(`${engine} archive dependency must be a portable directory: ${name}`)
    }
  }

  const forbiddenMetadata = [
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'node_modules/.modules.yaml',
    'node_modules/.pnpm-workspace-state-v1.json',
    'node_modules/.pnpm/lock.yaml',
    'node_modules/@traderalice',
    'node_modules/.pnpm/node_modules/@traderalice',
  ]
  for (const relativePath of forbiddenMetadata) {
    if (await pathExists(resolve(packageRoot, relativePath))) {
      throw new Error(`${engine} archive contains workspace/deployment metadata: ${relativePath}`)
    }
  }
  const virtualStore = resolve(packageRoot, 'node_modules', '.pnpm')
  const workspaceEntries = (await readdir(virtualStore)).filter((name) => name.startsWith('@traderalice+'))
  if (workspaceEntries.length > 0) {
    throw new Error(`${engine} archive contains workspace package paths: ${workspaceEntries.join(', ')}`)
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function verifyModuleInCleanProcess(engine: InstallableBrokerEngine, entry: string, cwd: string): void {
  const script = [
    'const m = await import(process.env.BROKER_PACK_ENTRY)',
    'if (m.BROKER_PACK_API_VERSION !== Number(process.env.BROKER_PACK_API)) throw new Error("module API export mismatch")',
    'if (m.BROKER_ENGINE !== process.env.BROKER_PACK_ENGINE) throw new Error("module engine export mismatch")',
    'if (!m.configSchema || typeof m.createBroker !== "function") throw new Error("module is missing configSchema/createBroker")',
  ].join(';')
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_PATH: '',
      BROKER_PACK_ENTRY: pathToFileURL(entry).href,
      BROKER_PACK_API: String(BROKER_PACK_API_VERSION),
      BROKER_PACK_ENGINE: engine,
    },
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${engine} failed clean-process import:\n${(result.stderr || result.stdout).trim()}`)
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}
