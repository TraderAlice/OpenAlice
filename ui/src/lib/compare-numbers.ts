export type SortDirection = 'ascending' | 'descending'

/** Missing quotes stay last in either direction. */
export function compareNumbers(left: number | null | undefined, right: number | null | undefined, direction: SortDirection) {
  if (left == null || !Number.isFinite(left)) return right == null || !Number.isFinite(right) ? 0 : 1
  if (right == null || !Number.isFinite(right)) return -1
  return direction === 'ascending' ? left - right : right - left
}
