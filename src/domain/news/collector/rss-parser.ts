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
  link: string | null
  guid: string | null
  pubDate: Date | null
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
    const contentRaw = extractTagRaw(block, 'content:encoded')
      ?? extractTagRaw(block, 'description')
      ?? extractTagRaw(block, 'summary')
      ?? extractTagRaw(block, 'content')
      ?? ''
    const image = extractImage(block, contentRaw)

    items.push({
      title: cleanText(extractTagRaw(block, 'title') ?? ''),
      content: cleanText(contentRaw),
      link: extractTag(block, 'link') ?? extractAttr(block, 'link', 'href'),
      guid: extractTag(block, 'guid') ?? extractTag(block, 'id'),
      pubDate: parseDate(
        extractTag(block, 'pubDate')
        ?? extractTag(block, 'published')
        ?? extractTag(block, 'updated'),
      ),
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
  return decodeXmlEntities(stripHtml(raw))
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
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Decode common XML entities.
 */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

/**
 * Strip HTML tags from a string (best-effort, for summaries).
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim()
}

/**
 * Escape a string for use in a RegExp.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
