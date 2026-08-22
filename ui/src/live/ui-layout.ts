import type { Page } from '../App'

export const ACTIVITY_PAGE_IDS = [
  'chat',
  'auto-quant',
  'prediction',
  'inbox',
  'tracked',
  'workspaces',
  'portfolio',
  'office',
  'automation',
  'market',
  'issue',
  'connectors',
  'settings',
  'dev',
] as const satisfies readonly Page[]

export type ActivityPageId = (typeof ACTIVITY_PAGE_IDS)[number]

export const BUILTIN_GROUP_IDS = ['primary', 'beta', 'system'] as const
export type BuiltinGroupId = (typeof BUILTIN_GROUP_IDS)[number]

export const PINNED_ACTIVITY_PAGE: ActivityPageId = 'settings'
export const MAX_CUSTOM_GROUP_LABEL = 40
export const CUSTOM_GROUP_ID_RE = /^custom:[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/

const PAGE_SET = new Set<string>(ACTIVITY_PAGE_IDS)
const BUILTIN_SET = new Set<string>(BUILTIN_GROUP_IDS)

export interface UiLayoutGroup {
  id: string
  label?: string
  items: ActivityPageId[]
}

export interface UiLayout {
  version: 1
  groups: UiLayoutGroup[]
  hidden: ActivityPageId[]
}

export function defaultUiLayout(): UiLayout {
  return {
    version: 1,
    groups: [
      { id: 'primary', items: ['chat', 'inbox', 'issue', 'auto-quant', 'tracked', 'market'] },
      { id: 'beta', items: ['prediction', 'office', 'portfolio', 'connectors'] },
      { id: 'system', items: ['workspaces', 'automation', 'settings', 'dev'] },
    ],
    hidden: ['dev'],
  }
}

export function isBuiltinGroupId(id: string): id is BuiltinGroupId {
  return BUILTIN_SET.has(id)
}

export function isCustomGroupId(id: string): boolean {
  return CUSTOM_GROUP_ID_RE.test(id)
}

export function isGroupId(id: string): boolean {
  return isBuiltinGroupId(id) || isCustomGroupId(id)
}

export function defaultGroupIdForPage(page: ActivityPageId): BuiltinGroupId {
  for (const group of defaultUiLayout().groups) {
    if (group.items.includes(page)) return group.id as BuiltinGroupId
  }
  return 'primary'
}

function asActivityPage(value: unknown): ActivityPageId | null {
  return typeof value === 'string' && PAGE_SET.has(value) ? value as ActivityPageId : null
}

export function normalizeUiLayout(input: unknown): UiLayout {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const rawGroups = Array.isArray(raw.groups) ? raw.groups : []
  const seen = new Set<ActivityPageId>()
  const groups: UiLayoutGroup[] = []

  for (const entry of rawGroups) {
    if (!entry || typeof entry !== 'object') continue
    const group = entry as Record<string, unknown>
    const id = typeof group.id === 'string' ? group.id : ''
    if (!isGroupId(id) || groups.some((existing) => existing.id === id)) continue

    const items: ActivityPageId[] = []
    if (Array.isArray(group.items)) {
      for (const value of group.items) {
        const page = asActivityPage(value)
        if (!page || seen.has(page)) continue
        seen.add(page)
        items.push(page)
      }
    }

    if (isBuiltinGroupId(id)) {
      groups.push({ id, items })
      continue
    }

    const label = typeof group.label === 'string' ? group.label.trim() : ''
    if (!label || label.length > MAX_CUSTOM_GROUP_LABEL) continue
    groups.push({ id, label, items })
  }

  if (!groups.some((group) => group.id === 'primary')) {
    groups.unshift({ id: 'primary', items: [] })
  }
  for (const id of ['beta', 'system'] as const) {
    if (!groups.some((group) => group.id === id)) {
      groups.push({ id, items: [] })
    }
  }

  for (const page of ACTIVITY_PAGE_IDS) {
    if (seen.has(page)) continue
    const targetId = defaultGroupIdForPage(page)
    const target = groups.find((group) => group.id === targetId) ?? groups[0]
    target.items.push(page)
    seen.add(page)
  }

  const hidden: ActivityPageId[] = []
  if (Array.isArray(raw.hidden)) {
    for (const value of raw.hidden) {
      const page = asActivityPage(value)
      if (!page || page === PINNED_ACTIVITY_PAGE || hidden.includes(page)) continue
      hidden.push(page)
    }
  }

  return { version: 1, groups, hidden }
}

export function createCustomGroupId(): string {
  const seed = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return `custom:${seed.replace(/-/g, '').slice(0, 16)}`
}

function cloneLayout(layout: UiLayout): UiLayout {
  return {
    version: 1,
    groups: layout.groups.map((group) => ({
      id: group.id,
      ...(group.label ? { label: group.label } : {}),
      items: [...group.items],
    })),
    hidden: [...layout.hidden],
  }
}

export function setPageHidden(layout: UiLayout, page: ActivityPageId, hidden: boolean): UiLayout {
  if (page === PINNED_ACTIVITY_PAGE) return layout
  const next = cloneLayout(layout)
  const set = new Set(next.hidden)
  if (hidden) set.add(page)
  else set.delete(page)
  next.hidden = [...set]
  return normalizeUiLayout(next)
}

export function moveGroup(layout: UiLayout, groupId: string, destIndex: number): UiLayout {
  const next = cloneLayout(layout)
  const from = next.groups.findIndex((group) => group.id === groupId)
  if (from < 0) return layout
  const [group] = next.groups.splice(from, 1)
  const index = Math.max(0, Math.min(destIndex, next.groups.length))
  next.groups.splice(index, 0, group)
  return normalizeUiLayout(next)
}

export function movePage(
  layout: UiLayout,
  page: ActivityPageId,
  destGroupId: string,
  destIndex: number,
): UiLayout {
  const next = cloneLayout(layout)
  const dest = next.groups.find((group) => group.id === destGroupId)
  if (!dest) return layout
  for (const group of next.groups) {
    group.items = group.items.filter((item) => item !== page)
  }
  const index = Math.max(0, Math.min(destIndex, dest.items.length))
  dest.items.splice(index, 0, page)
  return normalizeUiLayout(next)
}

export function addCustomGroup(layout: UiLayout, id: string, label: string): UiLayout {
  const next = cloneLayout(layout)
  next.groups.push({ id, label: label.trim(), items: [] })
  return normalizeUiLayout(next)
}

export function renameCustomGroup(layout: UiLayout, id: string, label: string): UiLayout {
  if (!isCustomGroupId(id)) return layout
  const next = cloneLayout(layout)
  const group = next.groups.find((entry) => entry.id === id)
  if (!group) return layout
  group.label = label.trim()
  return normalizeUiLayout(next)
}

export function deleteCustomGroup(layout: UiLayout, id: string): UiLayout {
  if (!isCustomGroupId(id)) return layout
  const next = cloneLayout(layout)
  const group = next.groups.find((entry) => entry.id === id)
  if (!group) return layout
  const primary = next.groups.find((entry) => entry.id === 'primary')
  if (primary) primary.items.push(...group.items)
  next.groups = next.groups.filter((entry) => entry.id !== id)
  return normalizeUiLayout(next)
}
