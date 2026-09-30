import { DeriveOpSchema, FactSchema, FactsDocumentSchema, type DeriveOp, type Fact, type FactsDocument } from './schema.js'

function asNumber(value: Fact['value'], id: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  throw new Error(`Fact ${id} value is not numeric`)
}

function requireFact(byId: Map<string, Fact>, id: string): Fact {
  const fact = byId.get(id)
  if (!fact) throw new Error(`Missing fact id: ${id}`)
  return fact
}

function laterAsof(a: string, b: string): string {
  return a >= b ? a : b
}

function derivedBase(inputs: Fact[], id: string, seriesId: string, value: number, unit: string, caliber: string): Fact {
  const asof = inputs.reduce((acc, f) => laterAsof(acc, f.asof), inputs[0]!.asof)
  const sources = [...new Set(inputs.map((f) => f.source))].join('+')
  return FactSchema.parse({
    id,
    series_id: seriesId,
    value,
    unit,
    asof,
    source: sources,
    caliber,
    fetched_at: new Date().toISOString(),
    kind: 'derived',
    derived_from: inputs.map((f) => f.id),
  })
}

export function applyDeriveOp(doc: FactsDocument, op: DeriveOp): FactsDocument {
  const byId = new Map(doc.facts.map((f) => [f.id, f]))
  if (byId.has(op.id)) throw new Error(`Fact id already exists: ${op.id}`)

  let next: Fact
  switch (op.op) {
    case 'delta_bp': {
      const from = requireFact(byId, op.from_id)
      const to = requireFact(byId, op.to_id)
      const delta = (asNumber(to.value, to.id) - asNumber(from.value, from.id)) * op.scale
      next = derivedBase(
        [from, to],
        op.id,
        `${to.series_id}.delta_bp`,
        Number(delta.toFixed(6)),
        'bp',
        `derived:delta_bp(${op.from_id},${op.to_id},scale=${op.scale})`,
      )
      break
    }
    case 'spread': {
      const left = requireFact(byId, op.left_id)
      const right = requireFact(byId, op.right_id)
      const value = asNumber(left.value, left.id) - asNumber(right.value, right.id)
      next = derivedBase(
        [left, right],
        op.id,
        `${left.series_id}.minus.${right.series_id}`,
        Number(value.toFixed(6)),
        left.unit ?? right.unit ?? 'spread',
        `derived:spread(${op.left_id}-${op.right_id})`,
      )
      break
    }
    case 'pct_change': {
      const from = requireFact(byId, op.from_id)
      const to = requireFact(byId, op.to_id)
      const base = asNumber(from.value, from.id)
      if (base === 0) throw new Error(`pct_change base is zero for ${op.from_id}`)
      const pct = ((asNumber(to.value, to.id) - base) / base) * 100
      next = derivedBase(
        [from, to],
        op.id,
        `${to.series_id}.pct_change`,
        Number(pct.toFixed(6)),
        'pct',
        `derived:pct_change(${op.from_id},${op.to_id})`,
      )
      break
    }
    default: {
      const _exhaustive: never = op
      throw new Error(`Unknown derive op: ${JSON.stringify(_exhaustive)}`)
    }
  }

  return FactsDocumentSchema.parse({
    ...doc,
    facts: [...doc.facts, next],
  })
}

export function deriveFacts(doc: FactsDocument, ops: DeriveOp[]): FactsDocument {
  let current = FactsDocumentSchema.parse(doc)
  for (const raw of ops) {
    current = applyDeriveOp(current, DeriveOpSchema.parse(raw))
  }
  return current
}
