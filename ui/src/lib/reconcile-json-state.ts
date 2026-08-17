/**
 * Polling endpoints in OpenAlice return JSON-only DTOs. A successful request
 * is not automatically a state change: preserve the current identity when the
 * serialized snapshot is unchanged so React/Zustand selectors stay quiet.
 */
export function reconcileJsonSnapshot<T>(current: T, incoming: T): T {
  return JSON.stringify(current) === JSON.stringify(incoming) ? current : incoming
}

/**
 * Reconcile a keyed JSON collection while preserving unchanged row identities.
 * Order remains server-authoritative; reordering publishes a new array while
 * reusing the existing objects.
 */
export function reconcileJsonCollection<T, K>(
  current: T[],
  incoming: T[],
  keyOf: (value: T) => K,
): T[] {
  const currentByKey = new Map(current.map((value) => [keyOf(value), value]))
  let changed = current.length !== incoming.length

  const next = incoming.map((value, index) => {
    const previous = currentByKey.get(keyOf(value))
    if (previous === undefined || reconcileJsonSnapshot(previous, value) !== previous) {
      changed = true
      return value
    }
    if (current[index] !== previous) changed = true
    return previous
  })

  return changed ? next : current
}
