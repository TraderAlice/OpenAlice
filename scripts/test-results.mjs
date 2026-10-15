import { existsSync, readFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { lanesForTestFile } from './test-lanes.mjs'

export function requiredGate(root, name, gates = JSON.parse(readFileSync(resolve(root, 'tests/gates.json'), 'utf8'))) {
  const gate = gates[name]
  if (!gate || !Array.isArray(gate.evidence) || !gate.evidence.length) throw new Error(`Unknown or empty required gate: ${name}`)
  const evidence = gate.evidence.map(entry => {
    if (!entry.spec || entry.command || !['hermetic', 'integration'].includes(lanesForTestFile(entry.spec)[0])) throw new Error(`Required gate ${name} cannot automatically run dedicated/external evidence`)
    const safe = !entry.spec.startsWith('/') && !entry.spec.includes('\\') && !entry.spec.includes(':') && !entry.spec.split('/').includes('..')
    if (!safe || !existsSync(resolve(root, entry.spec)) || !entry.requirement || !entry.assertion || !readFileSync(resolve(root, entry.spec), 'utf8').includes(entry.assertion)) throw new Error(`Required gate ${name} has a missing/stale assertion: ${entry.spec}`)
    return entry
  })
  const ids = evidence.map(entry => JSON.stringify([entry.spec, entry.assertion]))
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate required gate evidence: ${name}`)
  return { name, description: gate.description, evidence, files: [...new Set(evidence.map(entry => entry.spec))].sort() }
}

// Interpret actual assertion rows, not numTotalTests (which includes skips).
// Never retain output/error messages: reporters may contain user/provider data.
export function inspectVitestResult(root, report, exitCode, expectedFiles = []) {
  const errors = []
  const tests = []
  if (!report || !Array.isArray(report.testResults) || typeof report.success !== 'boolean') {
    errors.push('missing or invalid Vitest JSON result')
    report = { success: false, testResults: [] }
  }
  const counts = { executed: 0, passed: 0, failed: 0, skipped: 0 }
  for (const file of report?.testResults ?? []) {
    if (!file || typeof file.name !== 'string') { errors.push('invalid reported spec path'); continue }
    const path = relative(root, resolve(root, file.name)).replaceAll('\\', '/')
    if (!Array.isArray(file.assertionResults)) { errors.push(`missing assertion results: ${path}`); continue }
    if (file.status !== 'passed') errors.push(`file/cleanup hook failure: ${path}`)
    for (const assertion of file.assertionResults) {
      const status = assertion.status
      if (status === 'passed' || status === 'failed') {
        counts.executed++; counts[status]++
      } else if (['skipped', 'pending', 'todo', 'disabled'].includes(status)) counts.skipped++
      else errors.push(`unknown assertion status: ${path}`)
      tests.push({ spec: path, title: assertion.title, fullName: assertion.fullName, status })
    }
  }
  if (exitCode !== 0) errors.push(`runner exited ${exitCode ?? 'without a status'}`)
  if (counts.failed || report?.numFailedTestSuites > 0) errors.push('failed assertions or suites are not acceptance')
  if (report?.success !== true) errors.push('Vitest did not report success')
  if (!counts.executed) errors.push('zero executed assertions (empty/all-skipped is not acceptance)')
  for (const file of expectedFiles) if (!tests.some(test => test.spec === file)) errors.push(`selected spec was not reported: ${file}`)
  return { accepted: errors.length === 0, counts, tests, errors }
}

export function evaluateRequiredEvidence(evidence, tests) {
  return evidence.map(entry => {
    // Catalog validation permits a unique title fragment; runtime validation
    // requires exactly one matching assertion and its actual passed status.
    const matches = tests.filter(test => test.spec === entry.spec && test.title.includes(entry.assertion))
    return { ...entry, status: matches.length === 1 ? matches[0].status : matches.length ? 'ambiguous' : 'not-executed', accepted: matches.length === 1 && matches[0].status === 'passed' }
  })
}
