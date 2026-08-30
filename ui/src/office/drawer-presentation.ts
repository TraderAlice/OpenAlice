import type { TFunction } from 'i18next'

import type { OfficeDrawerItem } from '../api/office'

const PLAYER_TITLE_ACRONYMS = new Set([
  'ai',
  'api',
  'cli',
  'gba',
  'http',
  'id',
  'llm',
  'npc',
  'qa',
  'rpg',
  'rss',
  'sdk',
  'ui',
  'ux',
])

function officeDrawerPlayerTitle(label: string): string {
  const extensionMatch = label.match(/\.(?:md|markdown)$/i)
  const withoutExtension = extensionMatch ? label.slice(0, -extensionMatch[0].length) : label
  const timestampMatch = withoutExtension.match(/[-_](\d{4})(\d{2})(\d{2})(?:[-_](\d{2})(\d{2}))?$/)
  const slug = timestampMatch
    ? withoutExtension.slice(0, timestampMatch.index)
    : withoutExtension
  const clearlyMachineNamed = /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/i.test(slug)
  if (!clearlyMachineNamed) return label

  const title = slug
    .split(/[-_]+/)
    .map((token) => PLAYER_TITLE_ACRONYMS.has(token.toLowerCase())
      ? token.toUpperCase()
      : `${token.charAt(0).toUpperCase()}${token.slice(1).toLowerCase()}`)
    .join(' ')
  if (!timestampMatch) return title

  const [, year, month, day, hour, minute] = timestampMatch
  const beats = [title, `${year}-${month}-${day}`]
  if (hour && minute) beats.push(`${hour}:${minute}`)
  return beats.join(' · ')
}

export function officeDrawerKindLabel(item: OfficeDrawerItem, t: TFunction): string {
  if (item.kind === 'report') return t('office.drawerKindReport')
  if (item.kind === 'issue') return t('office.drawerKindIssue')
  if (item.kind === 'inbox') return t('office.drawerKindInbox')
  return t('office.drawerKindTradeDecision')
}

export function officeDrawerTitle(item: OfficeDrawerItem, t: TFunction): string {
  if (item.kind === 'inbox') return t('office.drawerInboxRecord')
  if (item.kind === 'trade-decision') return t('office.drawerTradeDecisionRecord')
  return officeDrawerPlayerTitle(item.label)
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
