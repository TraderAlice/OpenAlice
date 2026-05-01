/**
 * Phase 0 verification for the temporary canonical decimal formatter.
 *
 * Stand-alone script (NOT a vitest spec) so it runs locally even when the
 * vitest/rollup native dlopen issue blocks `pnpm test` on macOS Sequoia.
 * See `OpenAlice/TODO.md` `[migration][env-blocker]` for the full diagnosis.
 *
 * Usage: pnpm tsx parity/check-canonical-decimal-temp.ts
 *
 * Exit 0 on success; non-zero on first assertion failure with a stack trace.
 *
 * Phase 1c will run the same battery against
 * `src/domain/trading/canonical-decimal.ts`. Output must be byte-identical.
 */

import assert from 'node:assert/strict'
import Decimal from 'decimal.js'
import { toCanonicalDecimalString } from './canonical-decimal-temp.js'

type AdversarialCase = { label: string; input: string | Decimal; expected: string }

const adversarial: AdversarialCase[] = [
  { label: 'integer zero', input: '0', expected: '0' },
  { label: 'negative-zero string', input: '-0', expected: '0' },
  { label: 'trailing zeros after decimal', input: '1.50000', expected: '1.5' },
  { label: 'unit with trailing dot suppressed', input: '1.0', expected: '1' },
  { label: 'negative one and a half', input: '-1.5', expected: '-1.5' },
  { label: '1e30 expanded', input: '1e30', expected: '1000000000000000000000000000000' },
  { label: '1e-30 expanded', input: '1e-30', expected: '0.000000000000000000000000000001' },
  {
    label: 'exact 0.3 (decimal.js exact addition)',
    input: new Decimal('0.1').plus(new Decimal('0.2')),
    expected: '0.3',
  },
  { label: 'negative trailing zeros', input: '-2.30000', expected: '-2.3' },
  { label: '8 dp BTC sub-satoshi', input: '0.00012345', expected: '0.00012345' },
  { label: '12 dp USDT-style', input: '0.000000123456', expected: '0.000000123456' },
  { label: '18 dp ethereum wei', input: '0.000000000000000001', expected: '0.000000000000000001' },
  {
    label: 'large negative',
    input: '-99999999999999999999999999.5',
    expected: '-99999999999999999999999999.5',
  },
  {
    label: 'UNSET_DECIMAL literal (callers gate this; format is well-defined)',
    input: '170141183460469231731687303715884105727',
    expected: '170141183460469231731687303715884105727',
  },
  { label: 'leading-plus normalized', input: '+1.5', expected: '1.5' },
]

type RejectionCase = { label: string; build: () => unknown; matches: RegExp | string }

const rejections: RejectionCase[] = [
  { label: 'NaN', build: () => new Decimal(NaN), matches: /NaN/ },
  { label: '+Infinity', build: () => new Decimal(Infinity), matches: /non-finite/ },
  { label: '-Infinity', build: () => new Decimal(-Infinity), matches: /non-finite/ },
  { label: 'null', build: () => null, matches: /null|undefined/ },
  { label: 'undefined', build: () => undefined, matches: /null|undefined/ },
  { label: 'plain number', build: () => 1.5, matches: /not a Decimal/ },
  { label: 'plain string', build: () => '1.5', matches: /not a Decimal/ },
]

let failures = 0
let passes = 0

function pass(label: string): void {
  passes += 1
  process.stdout.write(`  ok  ${label}\n`)
}

function fail(label: string, err: unknown): void {
  failures += 1
  const msg = err instanceof Error ? err.message : String(err)
  process.stdout.write(`  FAIL ${label}: ${msg}\n`)
}

process.stdout.write('toCanonicalDecimalString — adversarial cases (must succeed, exact output)\n')
for (const c of adversarial) {
  try {
    const d = c.input instanceof Decimal ? c.input : new Decimal(c.input)
    const got = toCanonicalDecimalString(d)
    assert.strictEqual(got, c.expected, `expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(got)}`)
    pass(c.label)
  } catch (err) {
    fail(c.label, err)
  }
}

process.stdout.write('\ntoCanonicalDecimalString — rejection cases (must throw)\n')
for (const c of rejections) {
  try {
    const built = c.build() as Decimal
    let threw = false
    let actualMessage = ''
    try {
      toCanonicalDecimalString(built)
    } catch (e) {
      threw = true
      actualMessage = e instanceof Error ? e.message : String(e)
    }
    assert.strictEqual(threw, true, `expected toCanonicalDecimalString to throw for ${c.label}`)
    if (c.matches instanceof RegExp) {
      assert.match(actualMessage, c.matches)
    } else {
      assert.ok(actualMessage.includes(c.matches), `message ${actualMessage} does not include ${c.matches}`)
    }
    pass(c.label)
  } catch (err) {
    fail(c.label, err)
  }
}

process.stdout.write('\ntoCanonicalDecimalString — round-trip stability\n')
try {
  const samples = ['0', '-1.5', '0.00012345', '1000000000000000000000000000000', '0.000000000000000000000000000001', '0.3']
  for (const s of samples) {
    const d = new Decimal(s)
    const round = toCanonicalDecimalString(d)
    assert.strictEqual(round, s, `round-trip drifted: ${s} → ${round}`)
  }
  pass('canonical strings round-trip through Decimal and back unchanged')
} catch (err) {
  fail('round-trip stability', err)
}

try {
  const unsetDecimal = new Decimal('170141183460469231731687303715884105727')
  assert.strictEqual(toCanonicalDecimalString(unsetDecimal), '170141183460469231731687303715884105727')
  pass('UNSET_DECIMAL literal serializes verbatim (callers must gate upstream)')
} catch (err) {
  fail('sentinel round-trip', err)
}

process.stdout.write(`\nresult: ${passes} passed, ${failures} failed\n`)
process.exit(failures === 0 ? 0 : 1)
