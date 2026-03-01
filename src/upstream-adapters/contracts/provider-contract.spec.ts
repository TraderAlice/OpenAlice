import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

interface ReasonCodeEntry {
  code?: unknown
}

interface ReasonCodeSourceFile {
  codes?: ReasonCodeEntry[]
}

const REASON_CODE_SOURCE = new URL(
  '../../../docs/research/templates/verdict_reason_codes.v1.json',
  import.meta.url,
)
const REQUIRED_CANONICAL_CODE = 'HARD_REASON_CODE_UNKNOWN'

async function loadReasonCodeSource(): Promise<ReasonCodeSourceFile> {
  const raw = await readFile(REASON_CODE_SOURCE, 'utf8')
  return JSON.parse(raw) as ReasonCodeSourceFile
}

describe('governance provider contract', () => {
  it('loads the canonical reason code source file', async () => {
    const source = await loadReasonCodeSource()

    expect(Array.isArray(source.codes)).toBe(true)
    expect(source.codes?.length).toBeGreaterThan(0)
  })

  it('contains required canonical reason code name', async () => {
    const source = await loadReasonCodeSource()
    const codes = Array.isArray(source.codes)
      ? source.codes
          .map((entry) => (typeof entry.code === 'string' ? entry.code : null))
          .filter((entry): entry is string => entry !== null)
      : []

    expect(codes).toContain(REQUIRED_CANONICAL_CODE)
  })
})
