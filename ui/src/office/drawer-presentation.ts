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
