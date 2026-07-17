import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { buildStaticManifest, validateStaticManifest } from './static-inventory.js'
import type { RuntimeColorWorklist, StaticColorManifest } from './types.js'

const root = resolve(import.meta.dirname, '../..')
const outputPath = resolve(root, process.env['OPENALICE_THEME_AUDIT_MANIFEST'] ?? '.artifacts/theme-color-audit/static-manifest.json')
const worklistPath = resolve(root, '.artifacts/theme-color-audit/runtime-worklist.json')

async function writeManifest(): Promise<StaticColorManifest> {
  const manifest = await buildStaticManifest(root)
  await validateStaticManifest(root, manifest)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

async function readManifest(): Promise<StaticColorManifest> {
  return JSON.parse(await readFile(outputPath, 'utf8')) as StaticColorManifest
}

function runtimeWorklist(manifest: StaticColorManifest): RuntimeColorWorklist {
  return { schemaVersion: 1, sourceCommit: manifest.sourceCommit, items: manifest.occurrences
    .filter((occurrence) => occurrence.sourceClass === 'runtime' && occurrence.role === 'color-consumer')
    .map((source) => ({ inventoryId: source.inventoryId, source })) }
}

const command = process.argv[2]
if (command === 'scan') {
  const manifest = await writeManifest()
  console.log(`wrote ${manifest.occurrences.length} occurrences to ${outputPath}`)
} else if (command === 'check-static') {
  const first = await buildStaticManifest(root)
  const second = await buildStaticManifest(root)
  await validateStaticManifest(root, first)
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('static scan is not deterministic')
  console.log(`validated ${first.occurrences.length} deterministic occurrences`)
} else if (command === 'validate-manifest') {
  const manifest = await readManifest()
  await validateStaticManifest(root, manifest)
  console.log(`validated manifest schema ${manifest.schemaVersion} with ${manifest.occurrences.length} occurrences`)
} else if (command === 'export-runtime-worklist') {
  const manifest = await writeManifest()
  const worklist = runtimeWorklist(manifest)
  if (new Set(worklist.items.map((item) => item.inventoryId)).size !== worklist.items.length) throw new Error('runtime worklist contains duplicate inventory IDs')
  await writeFile(worklistPath, `${JSON.stringify(worklist, null, 2)}\n`)
  console.log(`wrote ${worklist.items.length} non-variable runtime work items to ${worklistPath}`)
} else {
  throw new Error(`unknown command: ${command ?? '<missing>'}`)
}
