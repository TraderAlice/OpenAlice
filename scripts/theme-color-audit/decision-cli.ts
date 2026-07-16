import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  analyze, assertEvidence, buildAnalysisBundle, exportContracts, jsonSha256, reviewSuggestions,
  validateDecisions, validateSuggestions,
} from './decisions.js'
import type {
  RuntimeBindingManifest, StaticColorManifest, ThemeColorAnalysisBundle, ThemeColorDecisionManifest,
  ThemeColorEvidenceBundle, ThemeColorSuggestionManifest,
} from './types.js'

const root = resolve(import.meta.dirname, '../..')
const artifactRoot = resolve(root, '.artifacts/theme-color-audit')
const paths = {
  static: resolve(artifactRoot, 'static-manifest.json'), runtime: resolve(artifactRoot, 'runtime-bindings.json'),
  evidence: resolve(artifactRoot, 'evidence-bundle.json'), input: resolve(artifactRoot, 'analysis-input.json'),
  suggestions: resolve(artifactRoot, 'suggestions.json'), decisions: resolve(artifactRoot, 'decisions.json'),
  frontend: resolve(artifactRoot, 'migration-contract-16.json'), market: resolve(artifactRoot, 'migration-contract-18.json'),
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function readJson<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, 'utf8')) as T }
async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function createInput(): Promise<ThemeColorAnalysisBundle> {
  const [staticManifest, runtimeManifest, evidenceBundle] = await Promise.all([
    readJson<StaticColorManifest>(paths.static), readJson<RuntimeBindingManifest>(paths.runtime), readJson<ThemeColorEvidenceBundle>(paths.evidence),
  ])
  if (new Set([staticManifest.sourceCommit, runtimeManifest.sourceCommit, evidenceBundle.sourceCommit]).size !== 1) throw new Error('analysis inputs have stale commit mismatch')
  const input = buildAnalysisBundle(staticManifest, runtimeManifest, evidenceBundle)
  await writeJson(paths.input, input); return input
}

async function analyzeCommand(): Promise<void> {
  const inputPath = option('--input')
  const outputPath = resolve(root, option('--output') ?? paths.suggestions)
  const input = inputPath ? await readJson<ThemeColorAnalysisBundle>(resolve(root, inputPath)) : await createInput()
  const suggestions = analyze(input); validateSuggestions(suggestions); await writeJson(outputPath, suggestions)
  console.log(`wrote ${suggestions.suggestions.length} evidence-linked suggestions to ${outputPath}`)
}

async function ensureDecisions(): Promise<ThemeColorDecisionManifest> {
  let suggestions: ThemeColorSuggestionManifest
  try { suggestions = await readJson<ThemeColorSuggestionManifest>(paths.suggestions) }
  catch { const input = await createInput(); suggestions = analyze(input); await writeJson(paths.suggestions, suggestions) }
  validateSuggestions(suggestions)
  const input = await readJson<ThemeColorAnalysisBundle>(paths.input)
  const decisions = reviewSuggestions(suggestions, input); validateDecisions(decisions); await writeJson(paths.decisions, decisions)
  return decisions
}

async function checkCompleteness(): Promise<void> {
  const [staticManifest, runtimeManifest, evidenceBundle, input, suggestions, decisions] = await Promise.all([
    readJson<StaticColorManifest>(paths.static), readJson<RuntimeBindingManifest>(paths.runtime), readJson<ThemeColorEvidenceBundle>(paths.evidence),
    readJson<ThemeColorAnalysisBundle>(paths.input), readJson<ThemeColorSuggestionManifest>(paths.suggestions), readJson<ThemeColorDecisionManifest>(paths.decisions),
  ])
  if (new Set([staticManifest.sourceCommit, runtimeManifest.sourceCommit, evidenceBundle.sourceCommit, input.sourceCommit, suggestions.sourceCommit, decisions.sourceCommit]).size !== 1) throw new Error('stale commit in decision chain')
  if (input.staticManifestSha256 !== jsonSha256(staticManifest) || input.runtimeBindingManifestSha256 !== jsonSha256(runtimeManifest) || input.evidenceBundleSha256 !== jsonSha256(evidenceBundle)) throw new Error('analysis input hash mismatch')
  if (suggestions.analysisBundleSha256 !== jsonSha256(input) || decisions.suggestionManifestSha256 !== jsonSha256(suggestions)) throw new Error('decision chain hash mismatch')
  validateSuggestions(suggestions); validateDecisions(decisions)
  const expected = new Set(staticManifest.occurrences.map((entry) => entry.inventoryId))
  if (expected.size !== decisions.decisions.length || decisions.decisions.some((decision) => !expected.has(decision.inventoryId))) throw new Error('final decisions do not exactly cover static inventory')
  const sourceClass = new Map(staticManifest.occurrences.map((entry) => [entry.inventoryId, entry.sourceClass]))
  for (const decision of decisions.decisions) {
    const runtime = sourceClass.get(decision.inventoryId) === 'runtime'
    assertEvidence(decision.evidence, runtime)
    if (runtime === (decision.disposition.kind === 'non-runtime')) throw new Error(`source classification mismatch: ${decision.inventoryId}`)
  }
  console.log(`validated complete decision chain for ${decisions.decisions.length} static and ${runtimeManifest.bindings.length} runtime bindings`)
}

async function exportCommand(): Promise<void> {
  const decisions = await readJson<ThemeColorDecisionManifest>(paths.decisions); validateDecisions(decisions)
  const [frontend, market] = exportContracts(decisions)
  const left = new Set(frontend.decisions.map((decision) => decision.inventoryId))
  if (market.decisions.some((decision) => left.has(decision.inventoryId))) throw new Error('migration contracts overlap')
  await writeJson(paths.frontend, frontend); await writeJson(paths.market, market)
  console.log(`exported #16=${frontend.decisions.length} and #18=${market.decisions.length} mutually exclusive runtime decisions`)
}

const command = process.argv[2]
if (command === 'analyze') await analyzeCommand()
else if (command === 'validate-decisions') { const decisions = await ensureDecisions(); console.log(`validated suggestion/final review separation for ${decisions.decisions.length} decisions`) }
else if (command === 'check-decisions') { const decisions = await readJson<ThemeColorDecisionManifest>(paths.decisions); validateDecisions(decisions); console.log(`validated ${decisions.decisions.length} exhaustive disposition records`) }
else if (command === 'check-completeness') await checkCompleteness()
else if (command === 'export-migration-contracts') await exportCommand()
else throw new Error(`unknown decision command: ${command ?? '<missing>'}`)
