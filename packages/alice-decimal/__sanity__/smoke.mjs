// Smoke test for @traderalice/alice-decimal. Run with Homebrew Node:
//   /opt/homebrew/bin/node packages/alice-decimal/__sanity__/smoke.mjs
//
// Mirrors the alice-analysis smoke style; intentionally tiny.

import {
  encodeDecimal,
  decodeDecimal,
  validateWireDecimal,
  addWireDecimals,
  DecimalError,
  version,
} from '../ts/dist/index.js'
import Decimal from 'decimal.js'

let failed = 0
const eq = (label, got, want) => {
  const ok = got === want
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
  if (!ok) failed++
}

eq('version()', version(), '0.1.0')

// JS codec round-trip
eq('encodeDecimal(123.456)', encodeDecimal(new Decimal('123.456')), '123.456')
// decimal.js strips trailing zeros (stage-2 will pick a Money flavour that
// preserves them); rust_decimal preserves them. Asymmetry documented in
// `src/lib.rs::negative_zero_decodes_to_zero` and OK for stage 1.
eq('decodeDecimal("100.00").toFixed()', decodeDecimal('100.00').toFixed(), '100')
eq('validateWireDecimal("100.00")', validateWireDecimal('100.00'), '100.00')

// Rust napi
eq('validateWireDecimal("12.3")', validateWireDecimal('12.3'), '12.3')
eq('addWireDecimals("1.5", "2.5")', addWireDecimals('1.5', '2.5'), '4.0')

// JS-side reject
try {
  decodeDecimal('1.5e10')
  console.log('FAIL decodeDecimal exponent should throw')
  failed++
} catch (e) {
  console.log(`OK   decodeDecimal exponent throws: ${e.message}`)
}

// Rust napi reject — error envelope
try {
  validateWireDecimal('NaN')
  console.log('FAIL validateWireDecimal NaN should throw')
  failed++
} catch (e) {
  // Raw napi Error has CODE|message envelope; unwrapped DecimalError below
  console.log(`OK   napi reject envelope: ${e.message}`)
  if (!e.message.startsWith('DECIMAL_FORMAT|')) {
    console.log('FAIL envelope code missing')
    failed++
  }
}

// DecimalError class is exported
console.log('OK   DecimalError class exported:', DecimalError.name)

if (failed > 0) {
  console.error(`\n${failed} sanity check(s) failed`)
  process.exit(1)
}
console.log('\nAll alice-decimal sanity checks passed.')
