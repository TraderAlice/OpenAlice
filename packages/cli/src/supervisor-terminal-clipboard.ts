const DEFAULT_CLIPBOARD_LIMIT_BYTES = 24 * 1024

export interface SupervisorClipboardPayload {
  sequence: string
  text: string
  truncated: boolean
}

/**
 * Build an explicit OSC 52 clipboard request without reading host clipboard
 * state or launching a platform helper. The byte cap protects terminals with
 * conservative control-sequence limits.
 */
export function supervisorClipboardPayload(
  value: string,
  limitBytes = DEFAULT_CLIPBOARD_LIMIT_BYTES,
): SupervisorClipboardPayload {
  const safeLimit = Math.max(0, Math.floor(limitBytes))
  let bytes = 0
  let text = ''
  let truncated = false

  for (const codePoint of value) {
    const size = Buffer.byteLength(codePoint)
    if (bytes + size > safeLimit) {
      truncated = true
      break
    }
    text += codePoint
    bytes += size
  }

  return {
    sequence: `\u001b]52;c;${Buffer.from(text).toString('base64')}\u0007`,
    text,
    truncated,
  }
}
