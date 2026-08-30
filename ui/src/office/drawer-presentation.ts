import type { TFunction } from 'i18next'

import type { OfficeDrawerItem } from '../api/office'

export function officeDrawerKindLabel(item: OfficeDrawerItem, t: TFunction): string {
  if (item.kind === 'report') return t('office.drawerKindReport')
  if (item.kind === 'issue') return t('office.drawerKindIssue')
  if (item.kind === 'inbox') return t('office.drawerKindInbox')
  return t('office.drawerKindTradeDecision')
}

export function officeDrawerTitle(item: OfficeDrawerItem, t: TFunction): string {
  if (item.kind === 'inbox') return t('office.drawerInboxRecord')
  if (item.kind === 'trade-decision') return t('office.drawerTradeDecisionRecord')
  return item.label
}

export function officeDrawerTitles(
  items: readonly OfficeDrawerItem[],
  t: TFunction,
): ReadonlyMap<string, string> {
  const baseTitles = items.map((item) => officeDrawerTitle(item, t))
  const totals = new Map<string, number>()
  items.forEach((item, index) => {
    const key = `${item.kind}\u0000${baseTitles[index]}`
    totals.set(key, (totals.get(key) ?? 0) + 1)
  })
  const seen = new Map<string, number>()
  return new Map(items.map((item, index) => {
    const baseTitle = baseTitles[index]!
    const key = `${item.kind}\u0000${baseTitle}`
    const count = totals.get(key) ?? 1
    if (count === 1) return [item.id, baseTitle]
    const ordinal = (seen.get(key) ?? 0) + 1
    seen.set(key, ordinal)
    return [item.id, t('office.drawerRepeatedRecord', { record: baseTitle, index: ordinal, count })]
  }))
}
