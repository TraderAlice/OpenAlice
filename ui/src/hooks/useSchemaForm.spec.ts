import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSchemaForm } from './useSchemaForm'
import type { JsonSchema } from '../api/types'

// Mirrors the JSON Schema the backend emits for the CCXT Custom preset
// (z.boolean().default(false) → { type: 'boolean', default: false }, and
// the defaulted key lands in `required`). Regression guard for the bug
// where boolean fields were rendered as text inputs and submitted as the
// strings 'true'/'false', which the backend z.boolean() schema rejected
// with "expected boolean, received string".
const ccxtCustomSchema: JsonSchema = {
  type: 'object',
  properties: {
    exchange: { type: 'string', title: 'Exchange' },
    sandbox: { type: 'boolean', default: false, title: 'Sandbox / Testnet' },
    demoTrading: { type: 'boolean', default: false, title: 'Demo Trading' },
    apiKey: { type: 'string', writeOnly: true, title: 'API Key' },
  },
  required: ['exchange', 'sandbox', 'demoTrading'],
}

describe('useSchemaForm — boolean fields', () => {
  it('parses boolean JSON-schema props as boolean fields', () => {
    const { result } = renderHook(() => useSchemaForm(ccxtCustomSchema))
    const byKey = Object.fromEntries(result.current.fields.map(f => [f.key, f]))
    expect(byKey['sandbox'].type).toBe('boolean')
    expect(byKey['demoTrading'].type).toBe('boolean')
    // sibling fields keep their own types
    expect(byKey['exchange'].type).toBe('text')
    expect(byKey['apiKey'].type).toBe('password')
  })

  it('submits real booleans, not the strings "true"/"false"', () => {
    const { result } = renderHook(() => useSchemaForm(ccxtCustomSchema))

    // Default state: unchecked → real `false`, not "false"
    let data = result.current.getSubmitData()
    expect(data.sandbox).toBe(false)
    expect(data.demoTrading).toBe(false)
    expect(typeof data.sandbox).toBe('boolean')

    // Check the box → real `true`
    act(() => result.current.setField('sandbox', 'true'))
    data = result.current.getSubmitData()
    expect(data.sandbox).toBe(true)
    expect(data.demoTrading).toBe(false)
  })

  it('seeds + submits a required boolean that has no .default() (defaults to false)', () => {
    // z.boolean() with no .default() lands in required[] but emits no `default`.
    // It must still seed form state and submit a real `false`, not go missing.
    const schema: JsonSchema = {
      type: 'object',
      properties: { flag: { type: 'boolean', title: 'Flag' } },
      required: ['flag'],
    }
    const { result } = renderHook(() => useSchemaForm(schema))
    expect(result.current.validate()).toBeNull() // not falsely "Flag is required"
    expect(result.current.getSubmitData().flag).toBe(false)
  })

  it('round-trips a stored boolean via String()-ified initialValues (edit dialog)', () => {
    // EditUTADialog passes presetConfig through String(v); a stored `true`
    // boolean arrives here as the string 'true'.
    const { result } = renderHook(() =>
      useSchemaForm(ccxtCustomSchema, { exchange: 'binance', sandbox: 'true', demoTrading: 'false' }),
    )
    const data = result.current.getSubmitData()
    expect(data.sandbox).toBe(true)
    expect(data.demoTrading).toBe(false)
    expect(data.exchange).toBe('binance')
  })
})
