import { describe, expect, it } from 'vitest'

import { reconcileJsonCollection, reconcileJsonSnapshot } from './reconcile-json-state'

interface Row {
  id: string
  nested: { value: number }
}

function row(id: string, value: number): Row {
  return { id, nested: { value } }
}

describe('reconcileJsonSnapshot', () => {
  it('preserves the current identity for an identical JSON snapshot', () => {
    const current = { id: 'manager', sessions: [row('s1', 1)] }

    expect(reconcileJsonSnapshot(current, structuredClone(current))).toBe(current)
  })

  it('publishes a genuinely changed snapshot', () => {
    const current = { id: 'manager', sessions: [row('s1', 1)] }
    const incoming = { id: 'manager', sessions: [row('s1', 2)] }

    expect(reconcileJsonSnapshot(current, incoming)).toBe(incoming)
  })
})

describe('reconcileJsonCollection', () => {
  it('preserves the array and row identities for an identical response', () => {
    const current = [row('a', 1), row('b', 2)]

    const reconciled = reconcileJsonCollection(current, structuredClone(current), (value) => value.id)

    expect(reconciled).toBe(current)
    expect(reconciled[0]).toBe(current[0])
    expect(reconciled[1]).toBe(current[1])
  })

  it('publishes order changes while reusing unchanged rows', () => {
    const current = [row('a', 1), row('b', 2)]
    const incoming = [structuredClone(current[1]!), structuredClone(current[0]!)]

    const reconciled = reconcileJsonCollection(current, incoming, (value) => value.id)

    expect(reconciled).not.toBe(current)
    expect(reconciled).toEqual([current[1], current[0]])
    expect(reconciled[0]).toBe(current[1])
    expect(reconciled[1]).toBe(current[0])
  })

  it('replaces only changed rows', () => {
    const current = [row('a', 1), row('b', 2)]
    const incoming = [structuredClone(current[0]!), row('b', 3)]

    const reconciled = reconcileJsonCollection(current, incoming, (value) => value.id)

    expect(reconciled[0]).toBe(current[0])
    expect(reconciled[1]).toBe(incoming[1])
  })
})
