export interface SortRect {
  id: string
  top: number
  bottom: number
}

export interface ItemGroupSlot {
  id: string
  top: number
  bottom: number
  items: readonly SortRect[]
}

/** Insert-before index for a pointer Y among stacked rows. */
export function insertIndexFromY(rects: readonly SortRect[], y: number): number {
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index]
    if (y < (rect.top + rect.bottom) / 2) return index
  }
  return rects.length
}

/**
 * Hit-test a pointer Y against last-committed group boxes.
 * Gaps between groups return null so the item stays put.
 * Crossing into another group requires `crossGroupInset` px of overlap
 * so a small overshoot past the last row does not yeet the item.
 */
export function resolveItemInsert(
  groups: readonly ItemGroupSlot[],
  y: number,
  options?: { sourceGroupId?: string; crossGroupInset?: number },
): { groupId: string; destIndex: number } | null {
  const group = groups.find((entry) => y >= entry.top && y < entry.bottom)
  if (!group) return null
  const inset = options?.crossGroupInset ?? 0
  if (
    options?.sourceGroupId
    && group.id !== options.sourceGroupId
    && (y < group.top + inset || y >= group.bottom - inset)
  ) {
    return null
  }
  return { groupId: group.id, destIndex: insertIndexFromY(group.items, y) }
}

/** Cancel WAAPI transforms before measuring so FLIP does not feed hit-testing. */
export function layoutRect(node: HTMLElement): DOMRect {
  if (typeof node.getAnimations === 'function') {
    for (const animation of node.getAnimations()) animation.cancel()
  }
  return node.getBoundingClientRect()
}

/**
 * `movePage` / `moveGroup` remove the dragged row first. If the destination
 * was measured while it was still in the same list, subtract that hole.
 */
export function adjustInsertIndex(
  sourceIndex: number,
  destIndex: number,
  sameContainer: boolean,
): number {
  if (sameContainer && sourceIndex >= 0 && sourceIndex < destIndex) return destIndex - 1
  return destIndex
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
