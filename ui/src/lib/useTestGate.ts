/**
 * Shared "test before save" gate for AI-config forms.
 *
 * The standard hook behind both the credential vault and the per-workspace AI
 * config modal: you can only Save a connection once the CURRENT form has a
 * passing Test. Editing any tested field invalidates the result (Save re-locks).
 *
 * Genericity is via a plain string `key` that the caller derives from the
 * testable fields (baseUrl|apiKey|model|wireShape|…). The hook stores the key
 * the result was bound to; `passedFor(currentKey)` is the Save gate. No form
 * type leaks in — the caller owns what "the same form" means.
 */

import { useState } from 'react'

export interface TestOutcome {
  ok: boolean
  response?: string
  error?: string
}

export interface TestGate {
  testing: boolean
  /** Result bound to the key it was tested against (null until first test). */
  result: (TestOutcome & { key: string }) | null
  /** Run a probe for `key`; the result is bound to that key. */
  run: (key: string, probe: () => Promise<TestOutcome>) => Promise<void>
  /** Save gate: true only when the current key has a passing test. */
  passedFor: (key: string) => boolean
  /** Whether the last result is still for the current key (else "re-test"). */
  matchesCurrent: (key: string) => boolean
  reset: () => void
}

export function useTestGate(): TestGate {
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<(TestOutcome & { key: string }) | null>(null)

  const run = async (key: string, probe: () => Promise<TestOutcome>): Promise<void> => {
    setTesting(true)
    setResult(null)
    try {
      const r = await probe()
      setResult({ ...r, key })
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err), key })
    } finally {
      setTesting(false)
    }
  }

  return {
    testing,
    result,
    run,
    passedFor: (key) => !!result && result.ok && result.key === key,
    matchesCurrent: (key) => !!result && result.key === key,
    reset: () => setResult(null),
  }
}
