import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { assertUiSourceTreeMatchesCommit, buildStaticManifest } from './static-inventory.js'
import { validateThemeColorEvidenceManifest, type ThemeColorEvidenceManifest } from './evidence.js'
import { assertEvidenceFiles, exportContracts, hashJson, suggestMigration, validateDecisionManifest, validateSuggestionManifest, type MigrationDecisionManifest, type MigrationSuggestionManifest } from './migration-contract.js'

const root = resolve(import.meta.dirname, '../..')
const artifactRoot = resolve(root, '.artifacts/theme-color-audit')
const evidenceRoot = resolve(artifactRoot, 'evidence')
const evidencePath = resolve(evidenceRoot, 'manifest.json')
const suggestionsPath = resolve(artifactRoot, 'suggestions.json')
const decisionsPath = resolve(artifactRoot, 'decisions.json')

async function evidence(): Promise<{ manifest: ThemeColorEvidenceManifest; raw: unknown }> {
  const raw = JSON.parse(await readFile(evidencePath, 'utf8')) as unknown
  const declaredCommit = (raw as { sourceCommit?: unknown }).sourceCommit
  if (typeof declaredCommit !== 'string') throw new Error('evidence manifest sourceCommit must be a string')
  assertUiSourceTreeMatchesCommit(root, declaredCommit)
  const source = await buildStaticManifest(root, declaredCommit)
  const runtime = source.occurrences.filter((entry) => entry.sourceClass === 'runtime' && entry.role === 'color-consumer')
  const manifest = validateThemeColorEvidenceManifest(raw, runtime.map((entry) => ({ inventoryId: entry.inventoryId, path: entry.path, sourceText: entry.sourceText, span: entry.span })), source.sourceCommit)
  await assertEvidenceFiles(evidenceRoot, manifest.entries)
  return { manifest, raw }
}

async function analyze(): Promise<void> {
  const { manifest, raw } = await evidence()
  const output: MigrationSuggestionManifest = { schemaVersion: 1, sourceCommit: manifest.sourceCommit, evidenceManifestSha256: hashJson(raw), suggestions: manifest.entries.map(suggestMigration) }
  validateSuggestionManifest(output, manifest.entries.map((entry) => entry.inventoryId))
  await writeFile(suggestionsPath, `${JSON.stringify(output, null, 2)}\n`)
  console.log(`generated ${output.suggestions.length} evidence-linked migration suggestions`)
}

async function review(): Promise<void> {
  const reviewerId = process.env['THEME_COLOR_REVIEWER_ID']; const reviewedAt = process.env['THEME_COLOR_REVIEWED_AT']
  if (!reviewerId || !reviewedAt) throw new Error('review requires THEME_COLOR_REVIEWER_ID and THEME_COLOR_REVIEWED_AT')
  const suggestions = JSON.parse(await readFile(suggestionsPath, 'utf8')) as MigrationSuggestionManifest
  const { manifest } = await evidence(); validateSuggestionManifest(suggestions, manifest.entries.map((entry) => entry.inventoryId))
  const output: MigrationDecisionManifest = { schemaVersion: 1, sourceCommit: suggestions.sourceCommit, suggestionManifestSha256: hashJson(suggestions), decisions: suggestions.suggestions.map((suggestion) => ({ ...suggestion, reviewer: { status: 'accepted', reviewerId, reviewedAt, policyVersion: 1 } })) }
  validateDecisionManifest(output, suggestions); await writeFile(decisionsPath, `${JSON.stringify(output, null, 2)}\n`)
  console.log(`recorded ${output.decisions.length} explicit reviewed final decisions by ${reviewerId}`)
}

async function validateDecisions(): Promise<void> {
  const suggestions = JSON.parse(await readFile(suggestionsPath, 'utf8')) as MigrationSuggestionManifest
  const decisions = JSON.parse(await readFile(decisionsPath, 'utf8')) as MigrationDecisionManifest
  validateDecisionManifest(decisions, suggestions)
  console.log(`validated ${decisions.decisions.length} reviewed final decisions; suggestions are stored separately`)
}

async function checkCompleteness(): Promise<void> {
  const { manifest } = await evidence()
  const suggestions = JSON.parse(await readFile(suggestionsPath, 'utf8')) as MigrationSuggestionManifest
  const decisions = JSON.parse(await readFile(decisionsPath, 'utf8')) as MigrationDecisionManifest
  validateSuggestionManifest(suggestions, manifest.entries.map((entry) => entry.inventoryId)); validateDecisionManifest(decisions, suggestions)
  if (decisions.decisions.some((item) => item.disposition.kind === 'non-runtime')) throw new Error('runtime decision manifest contains non-runtime disposition')
  console.log(`complete: ${manifest.entries.length} evidence records -> ${suggestions.suggestions.length} suggestions -> ${decisions.decisions.length} reviewed final decisions`)
}

async function exportMigrationContracts(): Promise<void> {
  const suggestions = JSON.parse(await readFile(suggestionsPath, 'utf8')) as MigrationSuggestionManifest
  const decisions = JSON.parse(await readFile(decisionsPath, 'utf8')) as MigrationDecisionManifest
  validateDecisionManifest(decisions, suggestions)
  const [frontend, protectedDecisions] = exportContracts(decisions)
  await writeFile(resolve(artifactRoot, 'migration-contract-16.json'), `${JSON.stringify(frontend, null, 2)}\n`)
  await writeFile(resolve(artifactRoot, 'migration-contract-18.json'), `${JSON.stringify(protectedDecisions, null, 2)}\n`)
  console.log(`exported mutually exclusive contracts: #16=${frontend.decisions.length}, #18=${protectedDecisions.decisions.length}, total=${decisions.decisions.length}`)
}

const command = process.argv[2]
if (command === 'analyze') await analyze()
else if (command === 'review') await review()
else if (command === 'validate-decisions') await validateDecisions()
else if (command === 'check-completeness') await checkCompleteness()
else if (command === 'export') await exportMigrationContracts()
else throw new Error('usage: migration-contract-cli.ts <analyze|review|validate-decisions|check-completeness|export>')
