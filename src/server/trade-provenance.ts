export interface TradeDecisionRef {
  accountId: string
  decisionId: string
}

const inlineCommitTools = new Set([
  'placeOrder',
  'modifyOrder',
  'closePosition',
  'cancelOrder',
])

function textPayload(content: readonly unknown[]): unknown {
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const candidate = block as { type?: unknown; text?: unknown }
    if (candidate.type !== 'text' || typeof candidate.text !== 'string') continue
    try {
      return JSON.parse(candidate.text)
    } catch {
      // Non-JSON text is not a structured trading result.
    }
  }
  return undefined
}

function decisionFrom(value: unknown, hashKey: 'hash' | 'committed'): TradeDecisionRef | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const accountId = record['source']
  const decisionId = hashKey === 'hash'
    ? record['hash']
    : record['committed'] && typeof record['committed'] === 'object'
      ? (record['committed'] as Record<string, unknown>)['hash']
      : undefined
  return typeof accountId === 'string' && accountId && typeof decisionId === 'string' && decisionId
    ? { accountId, decisionId }
    : null
}

/**
 * Extract only newly-created UTA commits from a successful Workspace CLI
 * invocation. Broker order/fill ids are deliberately ignored: the Git commit
 * hash is the durable trading-decision identity.
 */
export function extractTradeDecisionRefs(
  toolName: string,
  content: readonly unknown[],
): TradeDecisionRef[] {
  const payload = textPayload(content)
  const refs: TradeDecisionRef[] = []
  if (toolName === 'tradingCommit') {
    for (const value of Array.isArray(payload) ? payload : [payload]) {
      const ref = decisionFrom(value, 'hash')
      if (ref) refs.push(ref)
    }
  } else if (inlineCommitTools.has(toolName)) {
    const ref = decisionFrom(payload, 'committed')
    if (ref) refs.push(ref)
  }
  const unique = new Map(refs.map((ref) => [`${ref.accountId}\0${ref.decisionId}`, ref]))
  return [...unique.values()]
}

