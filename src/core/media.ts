import type { MediaAttachment } from './types.js'

/**
 * Extract media file paths from a Vercel AI SDK tool result output.
 *
 * Handles the multi-modal AgentToolResult shape:
 *   { content: [{ type: "text", text: "MEDIA:/path/..." }, ...], details: { path: "..." } }
 *
 * Prefers `details.path`, falls back to parsing `MEDIA:` prefix from text blocks.
 */
export function extractMediaFromToolOutput(output: unknown): MediaAttachment[] {
  if (output == null || typeof output !== 'object') return []

  const obj = output as Record<string, unknown>

  // Prefer details.path (most reliable)
  if (obj.details != null && typeof obj.details === 'object') {
    const path = (obj.details as Record<string, unknown>).path
    if (typeof path === 'string' && path) {
      return [{ type: 'image', path }]
    }
  }

  // Fallback: scan content text blocks for MEDIA: prefix
  if ('content' in obj && Array.isArray(obj.content)) {
    return extractMediaPaths(obj.content as Array<Record<string, unknown>>)
  }

  return []
}

/**
 * Extract media file paths from Claude Code JSONL tool_result content.
 *
 * The content string may contain a `MEDIA:/path/to/file` marker.
 * It may also be JSON (stringified content array or AgentToolResult).
 */
export function extractMediaFromToolResultContent(content: string): MediaAttachment[] {
  // Try to parse as JSON first (MCP tool results are typically JSON)
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    // Not JSON — try direct MEDIA: prefix in plain text
    const directMatch = content.match(/MEDIA:(\S+)/)
    if (directMatch) {
      return [{ type: 'image', path: directMatch[1] }]
    }
    return []
  }

  if (parsed == null || typeof parsed !== 'object') return []

  // Could be a full AgentToolResult { details: { path }, content: [...] }
  const obj = parsed as Record<string, unknown>
  if (obj.details != null && typeof obj.details === 'object') {
    const path = (obj.details as Record<string, unknown>).path
    if (typeof path === 'string' && path) {
      return [{ type: 'image', path }]
    }
  }

  // Array of content blocks
  if (Array.isArray(parsed)) {
    return extractMediaPaths(parsed as Array<Record<string, unknown>>)
  }
  if ('content' in obj && Array.isArray(obj.content)) {
    return extractMediaPaths(obj.content as Array<Record<string, unknown>>)
  }

  return []
}

/** Scan text blocks for MEDIA: prefix. */
function extractMediaPaths(items: Array<Record<string, unknown>>): MediaAttachment[] {
  const media: MediaAttachment[] = []
  for (const item of items) {
    if (item.type === 'text' && typeof item.text === 'string') {
      const match = item.text.match(/MEDIA:(\S+)/)
      if (match) {
        media.push({ type: 'image', path: match[1] })
      }
    }
  }
  return media
}
