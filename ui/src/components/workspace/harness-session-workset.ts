export const RECENT_SIDEBAR_WORKSET_LIMIT = 8

/**
 * Bound the Ask Alice / AutoQuant quick sidebar to the newest recent rows.
 * `recent` must already be in roster order and must exclude running /
 * headless-occupying rows. If the active row sits past the cap, it replaces
 * the last visible row; retained rows keep their relative order.
 */
export function selectRecentSidebarWorkset<T>(
  recent: readonly T[],
  isActive: (row: T) => boolean,
  limit = RECENT_SIDEBAR_WORKSET_LIMIT,
): T[] {
  if (limit <= 0 || recent.length === 0) return []
  if (recent.length <= limit) return [...recent]

  let overflowActiveIndex = -1
  for (let index = limit; index < recent.length; index += 1) {
    const row = recent[index]
    if (row !== undefined && isActive(row)) {
      overflowActiveIndex = index
      break
    }
  }
  if (overflowActiveIndex < 0) return recent.slice(0, limit)

  return recent.filter((_, index) => index < limit - 1 || index === overflowActiveIndex)
}
