import chardet from 'chardet'
import iconv from 'iconv-lite'

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
// chardet is deliberately conservative for some short single-byte documents
// (often scoring them in the 20-40 range). A low candidate floor is safe here
// only because conversion must also pass text-likeness and byte round-trip
// checks before Alice changes anything at the external delivery boundary.
const MIN_DETECTION_CONFIDENCE = 20

export interface NormalizedTextAttachment {
  /** Bytes handed to external connector adapters. Workspace bytes stay untouched. */
  content: Buffer
  mediaType: string
  detectedEncoding?: string
  detectionConfidence?: number
  warning?: string
}

export type ConnectorTextMediaType = 'text/markdown' | 'text/html'

/**
 * Normalize an external text attachment without changing the Workspace file.
 *
 * Mobile document viewers frequently receive bot uploads as
 * `application/octet-stream`, so a MIME charset alone cannot prevent locale
 * based guesses. A UTF-8 BOM gives those viewers an encoding signal that is
 * independent of the user's language. BOM-marked encodings and strict UTF-8
 * are deterministic; legacy encodings use bounded statistical detection and
 * round-trip/text sanity checks before conversion.
 */
export function normalizeConnectorTextAttachment(
  source: Buffer,
  mediaType: ConnectorTextMediaType,
): NormalizedTextAttachment {
  const bomEncoding = detectBomEncoding(source)
  if (bomEncoding) {
    const decoded = decodeWithEncoding(source, bomEncoding)
    const roundTrip = decoded !== null && iconv.encodingExists(bomEncoding)
      ? iconv.encode(decoded, bomEncoding, { addBOM: true })
      : null
    if (decoded !== null && isTextLike(decoded) && roundTrip?.equals(source)) {
      return normalized(decoded, mediaType, canonicalEncodingName(bomEncoding), 100)
    }
    return unchanged(source, mediaType, `BOM declared ${bomEncoding}, but the report bytes could not be decoded safely`)
  }

  // A UTF-16/32 or binary file can contain only byte values that are legal
  // UTF-8. NUL bytes are therefore routed through the detector first.
  if (!source.includes(0) && isStrictUtf8(source)) {
    return normalized(source.toString('utf8'), mediaType, 'UTF-8', 100)
  }

  const candidates = chardet.analyse(source)
  for (const candidate of candidates) {
    if (candidate.confidence < MIN_DETECTION_CONFIDENCE) break
    if (candidate.name === 'ASCII' || candidate.name === 'UTF-8') continue
    const decoded = decodeWithEncoding(source, candidate.name)
    if (decoded === null || !isTextLike(decoded)) continue
    if (iconv.encodingExists(candidate.name)) {
      const roundTrip = iconv.encode(decoded, candidate.name)
      if (!roundTrip.equals(source)) continue
    }
    return normalized(decoded, mediaType, candidate.name, candidate.confidence)
  }

  return unchanged(source, mediaType, 'Report attachment encoding could not be determined safely')
}

function normalized(
  text: string,
  mediaType: ConnectorTextMediaType,
  detectedEncoding: string,
  detectionConfidence: number,
): NormalizedTextAttachment {
  const withoutBom = text.startsWith('\uFEFF') ? text.slice(1) : text
  return {
    content: Buffer.concat([UTF8_BOM, Buffer.from(withoutBom, 'utf8')]),
    mediaType: `${mediaType}; charset=utf-8`,
    detectedEncoding,
    detectionConfidence,
  }
}

function unchanged(
  source: Buffer,
  mediaType: ConnectorTextMediaType,
  warning: string,
): NormalizedTextAttachment {
  return {
    content: source,
    mediaType,
    warning,
  }
}

function detectBomEncoding(source: Buffer): string | null {
  if (startsWith(source, [0x00, 0x00, 0xfe, 0xff])) return 'UTF-32BE'
  if (startsWith(source, [0xff, 0xfe, 0x00, 0x00])) return 'UTF-32LE'
  if (startsWith(source, [0xef, 0xbb, 0xbf])) return 'UTF-8'
  if (startsWith(source, [0xfe, 0xff])) return 'UTF-16BE'
  if (startsWith(source, [0xff, 0xfe])) return 'UTF-16LE'
  return null
}

function startsWith(source: Buffer, prefix: readonly number[]): boolean {
  return source.length >= prefix.length && prefix.every((byte, index) => source[index] === byte)
}

function decodeWithEncoding(source: Buffer, encoding: string): string | null {
  try {
    if (iconv.encodingExists(encoding)) return iconv.decode(source, encoding)
    return new TextDecoder(encoding, { fatal: true }).decode(source)
  } catch {
    return null
  }
}

function isStrictUtf8(source: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(source)
    return true
  } catch {
    return false
  }
}

function isTextLike(value: string): boolean {
  if (!value) return true
  let controlCount = 0
  let characterCount = 0
  for (const character of value) {
    characterCount += 1
    const codePoint = character.codePointAt(0) ?? 0
    const allowedWhitespace = codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d
    if (!allowedWhitespace && (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f))) {
      controlCount += 1
    }
  }
  return controlCount / characterCount <= 0.01
}

function canonicalEncodingName(encoding: string): string {
  return encoding.toUpperCase().replace(/^UTF(\d)/, 'UTF-$1')
}
