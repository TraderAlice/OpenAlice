import type { TFunction } from 'i18next'

import type { OfficeBubble } from '../api/office'

export function officeBubbleText(bubble: OfficeBubble, t: TFunction): string {
  if (bubble.kind === 'text' || bubble.kind === 'error') return bubble.text
  if (bubble.kind === 'tool') return String(t('office.bubbleTool', { name: bubble.name }))
  return String(t('office.bubbleRejected'))
}
