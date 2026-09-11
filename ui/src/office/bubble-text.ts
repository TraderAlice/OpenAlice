import type { TFunction } from 'i18next'

import type { OfficeBubble } from '../api/office'

type OfficeToolBubbleKey =
  | 'office.bubbleToolWorkspace'
  | 'office.bubbleToolResearch'
  | 'office.bubbleToolRead'
  | 'office.bubbleToolWrite'
  | 'office.bubbleToolRun'

const OFFICE_TOOL_BUBBLE_PATTERNS: ReadonlyArray<{
  pattern: RegExp
  key: OfficeToolBubbleKey
}> = [
  { pattern: /workspace|session|office|issue/, key: 'office.bubbleToolWorkspace' },
  { pattern: /research|search|browser|web|market|news/, key: 'office.bubbleToolResearch' },
  { pattern: /read|fetch|get|list|inspect|find/, key: 'office.bubbleToolRead' },
  { pattern: /write|edit|patch|save|create|update/, key: 'office.bubbleToolWrite' },
  { pattern: /bash|shell|exec|command|run|terminal/, key: 'office.bubbleToolRun' },
]

export function officeToolBubbleKey(name: string): OfficeToolBubbleKey | null {
  const normalized = name.toLowerCase()
  return OFFICE_TOOL_BUBBLE_PATTERNS.find(({ pattern }) => pattern.test(normalized))?.key ?? null
}

export function humanizeOfficeToolName(name: string): string {
  const leaf = name.split(/[/:.]/).filter(Boolean).at(-1) ?? name
  return leaf
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
}

export function officeBubbleText(bubble: OfficeBubble, t: TFunction): string {
  if (bubble.kind === 'text' || bubble.kind === 'error') return bubble.text
  if (bubble.kind === 'tool') {
    const key = officeToolBubbleKey(bubble.name)
    if (key) return String(t(key))
    return String(t('office.bubbleTool', { name: humanizeOfficeToolName(bubble.name) }))
  }
  return String(t('office.bubbleRejected'))
}
