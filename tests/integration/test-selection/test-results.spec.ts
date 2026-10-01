import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { inspectVitestResult, evaluateRequiredEvidence, requiredGate } from '../../../scripts/test-results.mjs'

const root = resolve(import.meta.dirname, '../../..')
function runFixture(body: string) {
  const directory = mkdtempSync(join(tmpdir(), 'oa-report-fixture-'))
  try {
    const spec = join(directory, 'fixture.spec.ts')
    const output = join(directory, 'result.json')
    writeFileSync(spec, `import { it, expect, afterAll } from ${JSON.stringify(resolve(root, 'node_modules/vitest/dist/index.js'))};\n${body}\n`)
    writeFileSync(join(directory, 'vitest.config.mjs'), 'export default { test: { include: ["fixture.spec.ts"], maxWorkers: 1 } }')
    const result = spawnSync(process.execPath, [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', '--root', directory,
      '--config', join(directory, 'vitest.config.mjs'), '--reporter=json', `--outputFile=${output}`], { cwd: directory, encoding: 'utf8', timeout: 20_000 })
    expect(result.error, result.stderr).toBeUndefined()
    const report = JSON.parse(readFileSync(output, 'utf8'))
    return { report, status: result.status, inspected: inspectVitestResult(directory, report, result.status, ['fixture.spec.ts']) }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

it('rejects all-skipped, hook failure, nonzero and missing reports from real Vitest processes', () => {
  const skipped = runFixture('it.skip("required", () => {});')
  expect(skipped.status).toBe(0)
  expect(skipped.inspected.accepted).toBe(false)
  expect(skipped.inspected.counts).toEqual({ executed: 0, passed: 0, failed: 0, skipped: 1 })
  const hook = runFixture('it("required", () => expect(true).toBe(true)); afterAll(() => { throw new Error("cleanup failed") });')
  expect(hook.inspected.accepted).toBe(false)
  expect(hook.inspected.errors).toContain('file/cleanup hook failure: fixture.spec.ts')
  const green = runFixture('it("required", () => expect(true).toBe(true));')
  expect(green.inspected.accepted).toBe(true)
  expect(inspectVitestResult(root, green.report, 1).accepted).toBe(false)
  expect(inspectVitestResult(root, undefined, 0).accepted).toBe(false)
  expect(inspectVitestResult(root, { success: true, testResults: {} }, 0).accepted).toBe(false)
  expect(inspectVitestResult(root, green.report, 0, ['removed.spec.ts']).accepted).toBe(false)
}, 60_000)

it('fails required evidence omitted or skipped despite other passing assertions', () => {
  const evidence = [{ requirement: 'required', spec: 'fixture.spec.ts', assertion: 'required' }]
  const report = runFixture('it.skip("required", () => {}); it("other", () => expect(true).toBe(true));')
  expect(report.inspected.accepted).toBe(true)
  expect(evaluateRequiredEvidence(evidence, report.inspected.tests)).toMatchObject([{ accepted: false, status: 'skipped' }])
  expect(evaluateRequiredEvidence(evidence, [])).toMatchObject([{ accepted: false, status: 'not-executed' }])
  const passed = [{ spec: 'fixture.spec.ts', title: 'required', fullName: 'required', status: 'passed' }]
  expect(evaluateRequiredEvidence(evidence, passed)).toMatchObject([{ accepted: true }])
  expect(evaluateRequiredEvidence(evidence, [...passed, ...passed])).toMatchObject([{ accepted: false, status: 'ambiguous' }])
})

it('rejects attempts to narrow the required gate before execution', () => {
  for (const args of [['--changed'], ['--lane', 'hermetic'], ['--', '-t', 'other'], ['--suite', 'first-run']]) {
    const result = spawnSync(process.execPath, ['scripts/run-tests.mjs', '--gate', 'critical-local', ...args], { cwd: root, encoding: 'utf8' })
    expect(result.status, result.stdout + result.stderr).toBe(2)
    expect(result.stderr).toContain('cannot narrow')
  }
  const plan = spawnSync(process.execPath, ['scripts/run-tests.mjs', '--gate', 'critical-local', '--json'], { cwd: root, encoding: 'utf8' })
  expect(plan.status, plan.stderr).toBe(0)
  const parsed = JSON.parse(plan.stdout)
  expect(parsed.executed).toBe(false)
  expect(parsed.requiredGate.name).toBe('critical-local')
  expect(parsed.requiredGate.evidence.length).toBeGreaterThan(8)
  expect(parsed.invocations.map((entry: { lane: string }) => entry.lane).sort()).toEqual(['hermetic', 'integration'])
})

it('rejects unknown, stale and dedicated acceptance evidence in required local gates', () => {
  expect(() => requiredGate(root, 'missing')).toThrow('Unknown')
  const gate = requiredGate(root, 'critical-local')
  expect(gate.files.length).toBeGreaterThan(3)
  const gates = JSON.parse(readFileSync(join(root, 'tests/gates.json'), 'utf8'))
  const stale = structuredClone(gates)
  stale['critical-local'].evidence[0].assertion = 'a removed assertion title'
  expect(() => requiredGate(root, 'critical-local', stale)).toThrow('missing/stale assertion')
  const dedicated = structuredClone(gates)
  dedicated['critical-local'].evidence[0] = { command: 'open-alice#test:system:guardian', assertion: 'dedicated acceptance' }
  expect(() => requiredGate(root, 'critical-local', dedicated)).toThrow('dedicated/external')
})
