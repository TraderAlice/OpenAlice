import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { analyzeInactive, validateInactiveAnalysis, type InactiveAnalysisManifest } from './inactive-analysis.js'
import type { RuntimeBindingManifest, StaticColorManifest, ThemeColorEvidenceBundle } from './types.js'

const root = resolve(import.meta.dirname, '../..')
const artifactRoot = resolve(root, '.artifacts/theme-color-audit')
const output = resolve(artifactRoot, 'inactive-analysis.json')

async function read<T>(name: string): Promise<T> { return JSON.parse(await readFile(resolve(artifactRoot, name), 'utf8')) as T }

async function build(): Promise<InactiveAnalysisManifest> {
  const [staticManifest, runtimeManifest, evidence] = await Promise.all([
    read<StaticColorManifest>('static-manifest.json'), read<RuntimeBindingManifest>('runtime-bindings.json'), read<ThemeColorEvidenceBundle>('evidence-bundle.json'),
  ])
  if (new Set([staticManifest.sourceCommit, runtimeManifest.sourceCommit, evidence.sourceCommit]).size !== 1) throw new Error('inactive analysis inputs have stale commit mismatch')
  const ids = new Set(evidence.occurrenceRecords.filter((record) => record.kind === 'non-visual-probe' && record.reason === 'inactive-in-scenario').map((record) => record.inventoryId))
  const manifest = analyzeInactive(staticManifest.sourceCommit, staticManifest.occurrences, runtimeManifest.bindings, ids)
  validateInactiveAnalysis(manifest, ids)
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

async function check(): Promise<InactiveAnalysisManifest> {
  const [manifest, evidence] = await Promise.all([read<InactiveAnalysisManifest>('inactive-analysis.json'), read<ThemeColorEvidenceBundle>('evidence-bundle.json')])
  const ids = new Set(evidence.occurrenceRecords.filter((record) => record.kind === 'non-visual-probe' && record.reason === 'inactive-in-scenario').map((record) => record.inventoryId))
  validateInactiveAnalysis(manifest, ids); return manifest
}

const command = process.argv[2]
if (command === 'report') {
  const manifest = await build()
  console.log(`reported ${manifest.records.length} inactive occurrences`)
} else if (command === 'check') {
  const manifest = await check()
  console.log(`validated ${manifest.records.length} exhaustive inactive analyses`)
} else if (command === 'verify-samples') {
  const run = spawnSync('pnpm', ['audit:theme-colors:check-runtime-bindings'], { cwd: root, stdio: 'inherit' })
  if (run.status !== 0) throw new Error(`fresh Chromium binding run failed: ${run.status}`)
  const staticRun = spawnSync('pnpm', ['audit:theme-colors:scan'], { cwd: root, stdio: 'inherit' })
  if (staticRun.status !== 0) throw new Error(`fresh static scan failed: ${staticRun.status}`)
  const manifest = await build()
  const groups = new Map<string, number>()
  for (const record of manifest.records) groups.set(record.reason, (groups.get(record.reason) ?? 0) + 1)
  console.log(`verified fresh Chromium evidence for ${[...groups].map(([reason, count]) => `${reason}=${count}`).join(', ')}`)
} else throw new Error(`unknown inactive analysis command: ${command ?? '<missing>'}`)
