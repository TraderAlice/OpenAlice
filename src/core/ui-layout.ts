/**
 * Home-scoped Activity Bar layout.
 *
 * This is user chrome, not operator/runtime configuration. It lives beside
 * `preferences.json` under `data/` so it follows the Alice home. Missing or
 * malformed files equal the default document (Dev Panel hidden).
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

import { dataPath } from './paths.js'

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
] as const

export type ActivityPageId = (typeof ACTIVITY_PAGE_IDS)[number]

export const BUILTIN_GROUP_IDS = ['primary', 'beta', 'system'] as const
export type BuiltinGroupId = (typeof BUILTIN_GROUP_IDS)[number]

export const PINNED_ACTIVITY_PAGE: ActivityPageId = 'settings'
export const MAX_CUSTOM_GROUP_LABEL = 40
export const CUSTOM_GROUP_ID_RE = /^custom:[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/

const PAGE_SET = new Set<string>(ACTIVITY_PAGE_IDS)
const BUILTIN_SET = new Set<string>(BUILTIN_GROUP_IDS)

export class UiLayoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UiLayoutError'
  }
}

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

export function uiLayoutPath(): string {
  return dataPath('ui-layout.json')
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

const activityPageSchema = z.enum(ACTIVITY_PAGE_IDS)

const groupWriteSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().max(MAX_CUSTOM_GROUP_LABEL).optional(),
  items: z.array(activityPageSchema),
})

export const uiLayoutWriteSchema = z.object({
  version: z.literal(1),
  groups: z.array(groupWriteSchema).min(1),
  hidden: z.array(activityPageSchema).default([]),
}).superRefine((value, ctx) => {
  const seen = new Set<string>()
  const groupIds = new Set<string>()
  for (const [index, group] of value.groups.entries()) {
    if (!isGroupId(group.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown group id: ${group.id}`,
        path: ['groups', index, 'id'],
      })
    }
    if (groupIds.has(group.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate group id: ${group.id}`,
        path: ['groups', index, 'id'],
      })
    }
    groupIds.add(group.id)
    if (isCustomGroupId(group.id)) {
      const label = group.label?.trim() ?? ''
      if (!label) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Custom groups need a label',
          path: ['groups', index, 'label'],
        })
      } else if (label.length > MAX_CUSTOM_GROUP_LABEL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Group label must be at most ${MAX_CUSTOM_GROUP_LABEL} characters`,
          path: ['groups', index, 'label'],
        })
      }
    }
    for (const [itemIndex, page] of group.items.entries()) {
      if (seen.has(page)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Page appears in more than one group: ${page}`,
          path: ['groups', index, 'items', itemIndex],
        })
      }
      seen.add(page)
    }
  }
  if (value.hidden.includes(PINNED_ACTIVITY_PAGE)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Settings cannot be hidden from the Activity Bar',
      path: ['hidden'],
    })
  }
})

function asActivityPage(value: unknown): ActivityPageId | null {
  return typeof value === 'string' && PAGE_SET.has(value) ? value as ActivityPageId : null
}

/**
 * Coerce any unknown document into a complete layout. Unknown pages drop out,
 * missing catalog pages return to their default group, and Settings stays visible.
 */
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

export function parseUiLayoutWrite(input: unknown): UiLayout {
  const parsed = uiLayoutWriteSchema.safeParse(input)
  if (!parsed.success) {
    throw new UiLayoutError(parsed.error.issues[0]?.message ?? 'Invalid Activity Bar layout')
  }
  return normalizeUiLayout(parsed.data)
}

/** Missing or malformed files equal the default document. */
export async function readUiLayout(path = uiLayoutPath()): Promise<UiLayout> {
  try {
    return normalizeUiLayout(JSON.parse(await readFile(path, 'utf-8')))
  } catch {
    return defaultUiLayout()
  }
}

let mutationQueue: Promise<unknown> = Promise.resolve()

async function writeUiLayoutFile(layout: UiLayout, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.${process.pid}.tmp`
  try {
    await writeFile(tempPath, JSON.stringify(layout, null, 2) + '\n', { mode: 0o600 })
    await rename(tempPath, path)
  } catch (error) {
    await unlink(tempPath).catch(() => undefined)
    throw error
  }
}

export async function writeUiLayout(input: unknown, path = uiLayoutPath()): Promise<UiLayout> {
  const operation = mutationQueue.catch(() => undefined).then(async () => {
    const layout = parseUiLayoutWrite(input)
    await writeUiLayoutFile(layout, path)
    return layout
  })
  mutationQueue = operation
  return operation
}
