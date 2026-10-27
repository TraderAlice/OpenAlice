/**
 * News Collector — Zero-dependency RSS / Atom parser
 *
 * Handles standard RSS 2.0 (<item>) and Atom (<entry>) feeds.
 * Extracts: title, description/summary, link, guid, pubDate, and safe image URLs.
 * Supports CDATA-wrapped content.
 */

export interface ParsedFeedItem {
  title: string
  content: string
  contentBasis: 'feed-content' | 'feed-summary' | 'missing'
  link: string | null
  guid: string | null
  pubDate: Date | null
  pubDateRaw?: string
  /** Safe HTTP(S) image URL when the feed supplied one. */
  image?: string
}

export const MAX_FEED_RESPONSE_BYTES = 8 * 1024 * 1024

class FeedResponseTooLargeError extends Error {
  constructor() { super(`RSS response exceeds ${MAX_FEED_RESPONSE_BYTES} bytes`); this.name = 'FeedResponseTooLargeError' }
}

/**
 * Fetch a feed URL and return parsed items.
 * Retries once after a 2s delay on failure, except a response rejected by the byte limit.
 */
export async function fetchAndParseFeed(url: string, retries = 1, rejectRedirects = false): Promise<ParsedFeedItem[]> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        ...(rejectRedirects ? { redirect: 'error' as const } : {}),
        headers: { 'User-Agent': 'OpenAlice/1.0 NewsCollector' },
      })
      if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`)
      const xml = await readFeedResponse(res)
      if (!hasFeedEnvelope(xml)) {
        throw new Error('RSS response failed: expected an RSS or Atom document')
      }
      return parseRSSXml(xml)
    } catch (err) {
      lastError = err
      if (err instanceof FeedResponseTooLargeError) break
      if (attempt < retries) await new Promise((r) => setTimeout(r, 2000))
    }
  }
  throw lastError
}

async function readFeedResponse(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_FEED_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new FeedResponseTooLargeError()
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let xml = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_FEED_RESPONSE_BYTES) {
        await reader.cancel()
        throw new FeedResponseTooLargeError()
      }
      xml += decoder.decode(value, { stream: true })
    }
    return xml + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

/** Recognize the supported feed envelope, not full XML/RFC validity. */
function hasFeedEnvelope(xml: string): boolean {
  const token = /<!--[^]*?-->|<!\[CDATA\[[^]*?\]\]>|<\?[^]*?\?>|<\/?[\w.:-]+(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?\s*\/?>|[^<]+/y
  const stack: string[] = []
  let root: string | undefined
  let closed = false
  let channel = false
  let offset = 0
  while (offset < xml.length) {
    token.lastIndex = offset
    const match = token.exec(xml)
    if (!match) return false
    const part = match[0]
    offset = token.lastIndex
    if (part.startsWith('<!--') || part.startsWith('<?')) continue
    if (part.startsWith('<![CDATA[')) {
      if (!stack.length) return false
      continue
    }
    if (!part.startsWith('<')) {
      if (!stack.length && part.trim()) return false
      continue
    }
    const name = /^<\/?([\w.:-]+)/.exec(part)![1]
    if (part.startsWith('</')) {
      if (stack.pop() !== name) return false
      if (!stack.length) closed = true
      continue
    }
    if (closed) return false
    if (!root) {
      root = name
      if (!/^(?:rss|(?:[\w.-]+:)?feed|rdf:RDF)$/.test(root)) return false
    }
    if (stack.length === 1 && name === 'channel') channel = true
    if (/\/\s*>$/.test(part)) {
      if (!stack.length) closed = true
    } else {
      stack.push(name)
    }
  }
  return closed && !stack.length && (root === 'rss' || root === 'rdf:RDF' ? channel : true)
}

/**
 * Parse an RSS/Atom XML string into structured items.
 */
export function parseRSSXml(xml: string): ParsedFeedItem[] {
  const items: ParsedFeedItem[] = []

  // Match <item>...</item> (RSS 2.0) or <entry>...</entry> (Atom)
  const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi
  let match: RegExpExecArray | null
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]
    let contentRaw = ''
    let content = ''
    let contentBasis: ParsedFeedItem['contentBasis'] = 'missing'
    for (const contentTag of ['content:encoded', 'content', 'description', 'summary']) {
      if (extractTagRaw(block, contentTag) === null) continue
      const isHtml = !/^<entry[\s>]/i.test(match[0]) || contentTag === 'content:encoded' || extractAttr(block, contentTag, 'type') === 'html'
      // XML-escaped HTML needs its outer layer decoded before tags are stripped; Atom text keeps literal markup.
      contentRaw = (isHtml ? extractTag(block, contentTag) : extractTagRaw(block, contentTag)) ?? ''
      content = cleanText(contentRaw)
      if (!content) continue
      contentBasis = contentTag === 'content' || contentTag === 'content:encoded' ? 'feed-content' : 'feed-summary'
      break
    }
    const image = extractImage(block, contentRaw)
    const pubDateRaw = extractTag(block, 'pubDate') ?? extractTag(block, 'published') ?? extractTag(block, 'updated')

    items.push({
      title: cleanRssHeadline(cleanText(extractTagRaw(block, 'title') ?? '')),
      content,
      contentBasis,
      link: extractTag(block, 'link') ?? extractAttr(block, 'link', 'href'),
      guid: extractTag(block, 'guid') ?? extractTag(block, 'id'),
      pubDate: parseDate(pubDateRaw),
      ...(pubDateRaw ? { pubDateRaw } : {}),
      ...(image ? { image } : {}),
    })
  }

  return items
}

// ==================== Helpers ====================

/**
 * Extract raw text content of an XML tag (no entity decoding).
 * CDATA content is returned as-is. Non-CDATA content is returned with entities intact.
 */
function extractTagRaw(xml: string, tag: string): string | null {
  // Try CDATA first: <tag><![CDATA[content]]></tag>
  const cdataRegex = new RegExp(
    String.raw`<${escapeRegex(tag)}\b[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*</${escapeRegex(tag)}>`,
    'i',
  )
  const cdataMatch = cdataRegex.exec(xml)
  if (cdataMatch) return cdataMatch[1].trim()

  // Plain text: <tag>content</tag>
  const regex = new RegExp(
    String.raw`<${escapeRegex(tag)}\b[^>]*>([\s\S]*?)</${escapeRegex(tag)}>`,
    'i',
  )
  const match = regex.exec(xml)
  return match ? match[1].trim() : null
}

/**
 * Find the first feed-provided image that is both an image media item and a
 * safe remote URL. Feed metadata is trusted only after this boundary check.
 */
function extractImage(block: string, contentRaw: string): string | null {
  const thumbnail = safeHttpImageUrl(
    extractAttr(block, 'media:thumbnail', 'url')
      ?? extractAttr(block, 'media:thumbnail', 'href'),
  )
  if (thumbnail) return thumbnail

  for (const tag of ['enclosure', 'media:content']) {
    const tagRegex = new RegExp(`<${escapeRegex(tag)}\\b[^>]*>`, 'gi')
    let match: RegExpExecArray | null
    while ((match = tagRegex.exec(block)) !== null) {
      const tagText = match[0]
      const url = extractAttr(tagText, tag, 'url')
      if (!url || !isImageMedia(tagText, tag, url)) continue
      const image = safeHttpImageUrl(url)
      if (image) return image
    }
  }

  const nestedImage = extractTagRaw(block, 'image')
  const imageUrl = nestedImage ? extractTag(nestedImage, 'url') : null
  const feedImage = safeHttpImageUrl(imageUrl)
  if (feedImage) return feedImage

  const htmlImage = /<img\b[^>]*>/i.exec(decodeXmlEntities(contentRaw))
  return htmlImage ? safeHttpImageUrl(extractAttr(htmlImage[0], 'img', 'src')) : null
}

function isImageMedia(tagText: string, tag: string, url: string): boolean {
  const type = extractAttr(tagText, tag, 'type')?.toLowerCase()
  const medium = extractAttr(tagText, tag, 'medium')?.toLowerCase()
  if (medium && medium !== 'image') return false
  if (type && !type.startsWith('image/')) return false
  return Boolean(type || medium || hasImageExtension(url))
}

function hasImageExtension(url: string): boolean {
  try {
    return /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(new URL(url).pathname)
  } catch {
    return false
  }
}

export function safeHttpImageUrl(raw: string | null): string | null {
  if (!raw) return null
  const url = decodeXmlEntities(raw.trim())
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (parsed.username || parsed.password) return null
    return url
  } catch {
    return null
  }
}

/**
 * Strip HTML tags first, then decode XML entities.
 * Order matters: &lt;tag&gt; → (strip: no-op) → decode → "<tag>" (preserved)
 */
export function cleanText(raw: string): string {
  return decodeXmlEntities(stripHtml(raw)).trim()
}

/** RSSHub can leave escaped formatting in headlines; unknown literal tags stay text. */
export function cleanRssHeadline(title: string): string {
  return title.replace(/<\/?(b|strong|i|em|span|br|p|div)(?:\s(?:[^<>"']|"[^"]*"|'[^']*')*)?\/?>/gi,
    (_, tag: string) => /^(?:br|p|div)$/i.test(tag) ? ' ' : '').replace(/[ \t]{2,}/g, ' ').trim()
}

/**
 * Extract the text content of an XML tag, handling CDATA. Decodes entities.
 */
function extractTag(xml: string, tag: string): string | null {
  // Try CDATA first: <tag><![CDATA[content]]></tag>
  const cdataRegex = new RegExp(
    String.raw`<${escapeRegex(tag)}\b[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*</${escapeRegex(tag)}>`,
    'i',
  )
  const cdataMatch = cdataRegex.exec(xml)
  if (cdataMatch) return cdataMatch[1].trim()

  // Plain text: <tag>content</tag>
  const regex = new RegExp(
    String.raw`<${escapeRegex(tag)}\b[^>]*>([\s\S]*?)</${escapeRegex(tag)}>`,
    'i',
  )
  const match = regex.exec(xml)
  return match ? decodeXmlEntities(match[1].trim()) : null
}

/**
 * Extract an attribute value from a self-closing or opening tag.
 * e.g. <link href="https://..."/> → "https://..."
 */
function extractAttr(xml: string, tag: string, attr: string): string | null {
  const regex = new RegExp(String.raw`<${escapeRegex(tag)}\b[^>]*\s${escapeRegex(attr)}\s*=(?:"([^"]*)"|'([^']*)')`, 'i')
  const match = regex.exec(xml)
  return match ? (match[1] ?? match[2]) : null
}

/**
 * Parse a date string, returning null if unparseable.
 */
function parseDate(dateStr: string | null): Date | null {
  if (!dateStr) return null
  // An unzoned source date must not inherit the collector machine's timezone.
  if (!/(?:Z|[+-]\d{2}:?\d{2}|\b(?:UT|UTC|GMT|EST|EDT|CST|CDT|MST|MDT|PST|PDT))\s*$/i.test(dateStr)) return null
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Decode common text entities once so nested escapes keep their meaning.
 */
function decodeXmlEntities(text: string): string {
  const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': '\u00a0' }
  return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-fA-F]+);/g, entity => {
    if (named[entity] !== undefined) return named[entity]
    const hex = entity.startsWith('&#x')
    const code = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10)
    return code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity
  })
}

/**
 * Strip HTML tags from a string (best-effort, for summaries).
 */
function stripHtml(html: string): string {
  return html.replace(/<!--[\s\S]*?-->|<\/?[a-z][\w:.-]*(?:\s(?:[^<>"']|"[^"]*"|'[^']*')*)?\/?>/gi, '').trim()
}

/**
 * Escape a string for use in a RegExp.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
