/**
 * thinking-domain calculate parity harness.
 *
 * Locks the legacy public calculation entry points before the first Rust slice:
 *   - calculate(expression) (src/domain/thinking/tools/calculate.tool.ts)
 *   - createThinkingTools().calculate.execute (src/tool/thinking.ts)
 *
 * Cases driven by docs/autonomous-refactor/fixtures/analysis-core/legacy-calculation-fixtures.json
 * with OPENALICE_RUST_ANALYSIS pinned to "0" for the legacy code path.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { calculate } from '../tools/calculate.tool'
import { createThinkingTools } from '@/tool/thinking'

interface FixtureCase {
  id: string
  entryPoint: string
  input: { expression: string }
  result:
    | { ok: true; output: unknown }
    | { ok: false; error: { name: string; message: string } }
}

interface FixtureFile {
  thinkingCalculateCases: FixtureCase[]
  thinkingToolShimCases: FixtureCase[]
}

function loadFixture(): FixtureFile {
  const here = dirname(fileURLToPath(import.meta.url))
  const repoRoot = resolve(here, '..', '..', '..', '..')
  const path = resolve(
    repoRoot,
    'docs/autonomous-refactor/fixtures/analysis-core/legacy-calculation-fixtures.json',
  )
  return JSON.parse(readFileSync(path, 'utf8')) as FixtureFile
}

const fixture = loadFixture()

let originalFlag: string | undefined

beforeAll(() => {
  originalFlag = process.env.OPENALICE_RUST_ANALYSIS
  process.env.OPENALICE_RUST_ANALYSIS = '0'
})

afterAll(() => {
  if (originalFlag === undefined) {
    delete process.env.OPENALICE_RUST_ANALYSIS
  } else {
    process.env.OPENALICE_RUST_ANALYSIS = originalFlag
  }
})

describe('thinking_core: legacy flag pinning', () => {
  it('keeps OPENALICE_RUST_ANALYSIS=0 for the legacy path', () => {
    expect(process.env.OPENALICE_RUST_ANALYSIS).toBe('0')
  })
})

describe('thinking_core: calculate(expression) parity (legacy path, flag=0)', () => {
  for (const testCase of fixture.thinkingCalculateCases) {
    it(testCase.id, () => {
      expect(process.env.OPENALICE_RUST_ANALYSIS).toBe('0')
      const expr = testCase.input.expression
      if (testCase.result.ok) {
        expect(calculate(expr)).toEqual(testCase.result.output)
      } else {
        expect(() => calculate(expr)).toThrow(testCase.result.error.message)
      }
    })
  }
})

describe('thinking_core: createThinkingTools().calculate parity (legacy path, flag=0)', () => {
  for (const testCase of fixture.thinkingToolShimCases) {
    it(testCase.id, async () => {
      expect(process.env.OPENALICE_RUST_ANALYSIS).toBe('0')
      const tool = createThinkingTools().calculate as unknown as {
        execute: (input: { expression: string }) => unknown
      }
      const expr = testCase.input.expression
      if (testCase.result.ok) {
        const out = await tool.execute({ expression: expr })
        expect(out).toEqual(testCase.result.output)
      } else {
        await expect(
          (async () => tool.execute({ expression: expr }))(),
        ).rejects.toThrow(testCase.result.error.message)
      }
    })
  }
})
