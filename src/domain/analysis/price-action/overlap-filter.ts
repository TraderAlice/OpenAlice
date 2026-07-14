import type {
  PriceActionFamilyFilterMeta,
  ZoneDirection,
  ZoneKind,
  ZoneOverlapPolicy,
  ZoneState,
} from './types.js'

export interface OverlapZoneView {
  kind: ZoneKind
  direction: ZoneDirection
  top: number
  bottom: number
  state: ZoneState
  timeframe?: string
  rank?: number
  size?: number
  sizeAtr?: number
  formedAtIndex?: number
  confirmedAtIndex?: number
}

export interface ApplyZoneOverlapFilteringResult<T> {
  items: T[]
  overlapFilteredCount: number
}

export function rangesOverlap(a: Pick<OverlapZoneView, 'top' | 'bottom'>, b: Pick<OverlapZoneView, 'top' | 'bottom'>): boolean {
  return Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom) > 0
}

export function applyZoneOverlapFiltering<T>(
  items: T[],
  policy: ZoneOverlapPolicy = 'ranked',
  viewOf: (item: T) => OverlapZoneView,
): ApplyZoneOverlapFilteringResult<T> {
  if (policy === 'none' || items.length <= 1) {
    return { items: [...items], overlapFilteredCount: 0 }
  }

  const kept: Array<{ item: T; view: OverlapZoneView; inputIndex: number }> = []

  for (const [inputIndex, item] of items.entries()) {
    const view = viewOf(item)
    const overlappingIndexes = kept.flatMap((candidate, index) =>
      sameOverlapBucket(candidate.view, view) && rangesOverlap(candidate.view, view) ? [index] : []
    )

    if (overlappingIndexes.length === 0) {
      kept.push({ item, view, inputIndex })
      continue
    }

    const current = { item, view, inputIndex }
    if (!overlappingIndexes.every((index) => shouldReplaceKept(kept[index], current, policy))) continue

    for (const index of overlappingIndexes.reverse()) kept.splice(index, 1)
    kept.push(current)
  }

  kept.sort((a, b) => a.inputIndex - b.inputIndex)

  return {
    items: kept.map(({ item }) => item),
    overlapFilteredCount: items.length - kept.length,
  }
}

export function buildFamilyFilterMeta(args: {
  detectedCount: number
  afterLifecycleCount: number
  overlapFilteredCount: number
  returnedCount: number
}): PriceActionFamilyFilterMeta {
  return {
    detectedCount: args.detectedCount,
    lifecycleFilteredCount: args.detectedCount - args.afterLifecycleCount,
    overlapFilteredCount: args.overlapFilteredCount,
    returnedCount: args.returnedCount,
  }
}

function sameOverlapBucket(a: OverlapZoneView, b: OverlapZoneView): boolean {
  return a.kind === b.kind &&
    a.direction === b.direction &&
    (a.timeframe ?? '') === (b.timeframe ?? '') &&
    a.state === b.state
}

function shouldReplaceKept(
  kept: { view: OverlapZoneView; inputIndex: number },
  current: { view: OverlapZoneView; inputIndex: number },
  policy: Exclude<ZoneOverlapPolicy, 'none'>,
): boolean {
  if (policy === 'older') return olderIndexOf(current.view, current.inputIndex) < olderIndexOf(kept.view, kept.inputIndex)
  if (policy === 'newer') return olderIndexOf(current.view, current.inputIndex) > olderIndexOf(kept.view, kept.inputIndex)

  return rankedScore(current.view) > rankedScore(kept.view)
}

function olderIndexOf(view: OverlapZoneView, inputIndex: number): number {
  return view.confirmedAtIndex ?? view.formedAtIndex ?? inputIndex
}

function rankedScore(view: OverlapZoneView): number {
  return view.rank ??
    view.sizeAtr ??
    view.size ??
    Math.max(0, view.top - view.bottom)
}
