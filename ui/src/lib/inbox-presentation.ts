import type { InboxDoc } from '../api/inbox'

/**
 * Inbox navigator / lead presentation. Derives a scan subject, an optional
 * bounded excerpt, and a short accessible row name from stored comments and
 * attachments. Never invents wording and never mutates the stored body.
 */

export const INBOX_SUBJECT_LIMIT = 72
export const INBOX_EXCERPT_LIMIT = 88
const EXCERPT_MIN = 12

// Latin terminals need a following space so "3.1x" stays one token.
// CJK terminals end the sentence even when the next clause is adjacent.
const SENTENCE_END = /[.!?…](?=$|\s)|[。！？]/u

export interface InboxPresentationInput {
  comments?: string
  docs?: ReadonlyArray<Pick<InboxDoc, 'path'>>
}

export interface InboxPresentationCopy {
  untitled: string
  unreadLabel: string
  moreAttachments: (count: number) => string
}

export interface InboxPresentationOptions extends InboxPresentationCopy {
  source: string
  unread: boolean
  time: string
}

export interface InboxPresentation {
  subject: string
  /** Full lead title for the reading pane; unlike the scan subject, this is not truncated. */
  documentTitle: string
  excerpt?: string
  rowLabel: string
  /** The stored body already opens with the same Markdown heading. */
  repeatsLeadingHeading: boolean
}

export function presentInboxEntry(
  entry: InboxPresentationInput,
  options: InboxPresentationOptions,
): InboxPresentation {
  const { subject, excerpt } = inboxScan(entry, options)
  const heading = leadingMarkdownHeading(entry.comments ?? '')
  return {
    subject,
    documentTitle: heading || subject,
    ...(excerpt ? { excerpt } : {}),
    repeatsLeadingHeading: Boolean(heading),
    rowLabel: inboxRowLabel({
      subject,
      source: options.source,
      unread: options.unread,
      time: options.time,
      unreadLabel: options.unreadLabel,
    }),
  }
}

function leadingMarkdownHeading(comments: string): string | undefined {
  const match = /^\s*#{1,6}\s+(.+?)\s*#*\s*(?:\n|$)/u.exec(comments.replace(/\r\n/g, '\n'))
  return match?.[1] ? stripMarkdownLine(match[1]) : undefined
}

export function inboxScan(
  entry: InboxPresentationInput,
  copy: InboxPresentationCopy,
): Pick<InboxPresentation, 'subject' | 'excerpt'> {
  const blocks = collectPlainBlocks(entry.comments ?? '')
  let rawSubject = ''
  let remainder = ''
  let subject = ''

  if (blocks.length > 0) {
    const first = blocks[0]!
    const split = splitFirstSentence(first)
    if (split) {
      rawSubject = stripTrailingPeriod(split.sentence)
      remainder = [split.rest, ...blocks.slice(1)].filter(Boolean).join(' ')
      subject = truncateScanText(rawSubject, INBOX_SUBJECT_LIMIT)
      // A truncated first sentence already ends with an ellipsis; prefer the
      // next clause as the excerpt instead of repeating the cut words.
      if (subject !== rawSubject && !remainder) {
        remainder = remainderAfterTruncate(rawSubject, subject)
      }
    } else {
      rawSubject = first
      subject = truncateScanText(rawSubject, INBOX_SUBJECT_LIMIT)
      remainder = [
        subject !== rawSubject ? remainderAfterTruncate(rawSubject, subject) : '',
        ...blocks.slice(1),
      ].filter(Boolean).join(' ')
    }
  } else {
    subject = attachmentSubject(entry.docs, copy) || copy.untitled
  }

  const excerpt = excerptFromRemainder(remainder, rawSubject, subject)
  return excerpt ? { subject, excerpt } : { subject }
}

export function inboxRowLabel(input: {
  subject: string
  source: string
  unread: boolean
  time: string
  unreadLabel: string
}): string {
  const parts = [
    input.unread ? input.unreadLabel.trim() : '',
    input.subject.trim(),
    input.source.trim(),
    input.time.trim(),
  ].filter(Boolean)
  return parts.join(' · ')
}

function documentFileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? ''
}

function attachmentSubject(
  docs: InboxPresentationInput['docs'],
  copy: InboxPresentationCopy,
): string {
  if (!docs || docs.length === 0) return ''
  const name = documentFileName(docs[0]!.path) || docs[0]!.path.trim()
  if (!name) return ''
  const extra = docs.length - 1
  return extra > 0 ? `${name} · ${copy.moreAttachments(extra)}` : name
}

function excerptFromRemainder(remainder: string, rawSubject: string, subject: string): string | undefined {
  const cleaned = remainder.replace(/\s+/g, ' ').trim()
  if (graphemeLength(cleaned) < EXCERPT_MIN) return undefined
  if (cleaned === rawSubject || cleaned === subject) return undefined
  if (subject.startsWith(cleaned) || rawSubject.startsWith(cleaned)) return undefined
  return truncateScanText(cleaned, INBOX_EXCERPT_LIMIT)
}

function collectPlainBlocks(comments: string): string[] {
  const lines = comments.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').split('\n')
  const blocks: string[] = []
  let inFence = false
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence || isSkippableLine(line)) continue
    const plain = stripMarkdownLine(line)
    if (plain) blocks.push(plain)
  }
  return blocks
}

function isSkippableLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return true
  if (/^[-*_]{3,}$/.test(trimmed)) return true
  if (/^\|/.test(trimmed)) return true
  if (/^[:\-|+\s]+$/.test(trimmed)) return true
  return false
}

function stripMarkdownLine(line: string): string {
  let text = line.trim()
  text = text.replace(/^(?:>\s*)+/, '')
  text = text.replace(/^#{1,6}\s+/, '')
  text = text.replace(/\s+#+\s*$/, '')
  text = text.replace(/^([-*+]|\d+[.)])\s+/, '')
  text = text.replace(/^\[[ xX]\]\s+/, '')
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  text = text.replace(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g, '$1')
  text = text.replace(/\*\*(.+?)\*\*/g, '$1')
  text = text.replace(/__(.+?)__/g, '$1')
  text = text.replace(/(^|[\s(])\*(?!\s)([^*]+?)\*(?=[\s).,!?;:]|$)/g, '$1$2')
  text = text.replace(/(^|[\s(])_(?!\s)([^_]+?)_(?=[\s).,!?;:]|$)/g, '$1$2')
  text = text.replace(/~~(.+?)~~/g, '$1')
  text = text.replace(/`([^`]+)`/g, '$1')
  text = text.replace(/<\/?[^>]+>/g, '')
  return text.replace(/\s+/g, ' ').trim()
}

function splitFirstSentence(text: string): { sentence: string; rest: string } | null {
  const pattern = new RegExp(SENTENCE_END.source, 'gu')
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    if (isDecimalDot(text, match.index, match[0]!)) continue
    const sentence = text.slice(0, match.index + match[0]!.length).trim()
    const rest = text.slice(match.index + match[0]!.length).trim()
    if (sentence) return { sentence, rest }
  }
  return null
}

function isDecimalDot(text: string, index: number, token: string): boolean {
  if (token !== '.') return false
  const before = text[index - 1]
  const after = text[index + 1]
  return Boolean(before && after && /\d/.test(before) && /\d/.test(after))
}

function stripTrailingPeriod(text: string): string {
  return text.replace(/[.。]+$/u, '').trim()
}

function remainderAfterTruncate(original: string, truncated: string): string {
  const stem = truncated.replace(/…$/u, '')
  if (stem && original.startsWith(stem)) return original.slice(stem.length).trim()
  return ''
}

function truncateScanText(text: string, limit: number): string {
  const chars = graphemes(text)
  if (chars.length <= limit) return text
  const slice = chars.slice(0, limit).join('')
  const lastSpace = slice.lastIndexOf(' ')
  const cut = lastSpace >= Math.floor(limit * 0.55) ? slice.slice(0, lastSpace) : slice
  return `${cut.replace(/[\s.,;:，、；：-]+$/u, '')}…`
}

function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)]
      .map((part) => part.segment)
  }
  return Array.from(text)
}

function graphemeLength(text: string): number {
  return graphemes(text).length
}
