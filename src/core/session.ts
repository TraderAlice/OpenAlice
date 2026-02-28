/**
 * Unified session store — JSONL format compatible with Claude Code.
 *
 * Both engine.ask() (Vercel AI SDK) and Claude Code CLI read/write to
 * the same session file under data/sessions/{sessionId}.jsonl.
 *
 * Claude Code format (per line):
 *   { type: "user",      message: { role: "user",      content: ... }, uuid, parentUuid, sessionId, timestamp, ... }
 *   { type: "assistant",  message: { role: "assistant",  content: [...] }, uuid, parentUuid, sessionId, timestamp, ... }
 *   { type: "system",     subtype: "compact_boundary", compactMetadata: {...}, ... }
 *
 * We store a compatible subset:
 *   - type, message, uuid, parentUuid, sessionId, timestamp  (required)
 *   - cwd, provider  (our extensions)
 *   - subtype, compactMetadata, isCompactSummary  (compaction)
 *
 * The converter can extract ModelMessage[] for Vercel AI SDK from this format.
 */

import { randomUUID } from 'node:crypto'
import { readFile, appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getActiveEntries } from './compaction.js'

// ==================== Types ====================

/** A single entry in the session JSONL file. */
export interface SessionEntry {
  type: 'user' | 'assistant' | 'meta' | 'system'
  message: {
    role: 'user' | 'assistant' | 'system'
    content: string | ContentBlock[]
  }
  uuid: string
  parentUuid: string | null
  sessionId: string
  timestamp: string
  /** Which provider generated this entry. */
  provider?: 'engine' | 'claude-code' | 'human' | 'compaction'
  cwd?: string
  /** Arbitrary metadata attached to the entry (e.g. { kind: 'notification', source: 'heartbeat' }). */
  metadata?: Record<string, unknown>
  /** Identifies a compact_boundary entry (type === 'system'). */
  subtype?: 'compact_boundary'
  /** Metadata attached to compact_boundary entries. */
  compactMetadata?: { trigger: 'auto' | 'manual'; preTokens: number }
  /** Marks this entry as a compacted summary (not a real user message). */
  isCompactSummary?: boolean
}

/** Anthropic-style content blocks (compatible with Claude Code session format). */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }

// ==================== Session Store ====================

const SESSIONS_DIR = join(process.cwd(), 'data', 'sessions')

export class SessionStore {
  private sessionId: string
  private lastUuid: string | null = null

  constructor(sessionId?: string) {
    this.sessionId = sessionId ?? randomUUID()
  }

  get id(): string {
    return this.sessionId
  }

  private get filePath(): string {
    return join(SESSIONS_DIR, `${this.sessionId}.jsonl`)
  }

  /** Append a user message to the session. */
  async appendUser(content: string | ContentBlock[], provider: SessionEntry['provider'] = 'human'): Promise<SessionEntry> {
    return this.append({
      type: 'user',
      message: { role: 'user', content },
      provider,
    })
  }

  /** Append an assistant message to the session. */
  async appendAssistant(
    content: string | ContentBlock[],
    provider: SessionEntry['provider'] = 'engine',
    metadata?: Record<string, unknown>,
  ): Promise<SessionEntry> {
    return this.append({
      type: 'assistant',
      message: { role: 'assistant', content },
      provider,
      ...(metadata ? { metadata } : {}),
    })
  }

  /** Read all entries from the session file (including system/compact entries). */
  async readAll(): Promise<SessionEntry[]> {
    try {
      const raw = await readFile(this.filePath, 'utf-8')
      return raw
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as SessionEntry)
        .filter((entry) => entry.type === 'user' || entry.type === 'assistant' || entry.type === 'system')
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw err
    }
  }

  /** Read only the active window — entries from the last compact_boundary onward. */
  async readActive(): Promise<SessionEntry[]> {
    const all = await this.readAll()
    return getActiveEntries(all)
  }

  /** Append a pre-built entry directly (used by compaction for boundary/summary). */
  async appendRaw(entry: SessionEntry): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await appendFile(this.filePath, JSON.stringify(entry) + '\n')
    this.lastUuid = entry.uuid
  }

  /** Restore lastUuid from existing file so new entries chain correctly. */
  async restore(): Promise<void> {
    const entries = await this.readAll()
    if (entries.length > 0) {
      this.lastUuid = entries[entries.length - 1].uuid
    }
  }

  /** Check if this session file exists. */
  async exists(): Promise<boolean> {
    try {
      await readFile(this.filePath, 'utf-8')
      return true
    } catch {
      return false
    }
  }

  private async append(partial: Omit<SessionEntry, 'uuid' | 'parentUuid' | 'sessionId' | 'timestamp'>): Promise<SessionEntry> {
    const entry: SessionEntry = {
      ...partial,
      uuid: randomUUID(),
      parentUuid: this.lastUuid,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    }

    await mkdir(dirname(this.filePath), { recursive: true })
    await appendFile(this.filePath, JSON.stringify(entry) + '\n')

    this.lastUuid = entry.uuid
    return entry
  }
}

// ==================== Format Conversion ====================

/**
 * Vercel AI SDK ModelMessage types (inlined to avoid deep import).
 * These match @ai-sdk/provider-utils exactly.
 */
export interface SDKUserMessage {
  role: 'user'
  content: string | Array<{ type: 'text'; text: string }>
}

export interface SDKAssistantMessage {
  role: 'assistant'
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  >
}

export interface SDKToolMessage {
  role: 'tool'
  content: Array<{ type: 'tool-result'; toolCallId: string; toolName: string; output: { type: 'text'; value: string } }>
}

export type SDKModelMessage = SDKUserMessage | SDKAssistantMessage | SDKToolMessage

/**
 * Convert session entries → Vercel AI SDK ModelMessage[].
 *
 * - user text   → { role: 'user', content: "..." }
 * - assistant text → { role: 'assistant', content: "..." }
 * - tool_use/tool_result are converted to SDK's tool-call/tool-result format
 * - compact_boundary entries are skipped (metadata only)
 * - isCompactSummary entries are included as normal user messages (summary = context)
 *
 * Tool calls from Claude Code (Read, Edit, Bash...) are mapped as-is.
 * The Vercel AI SDK agent won't re-execute them — they serve as context.
 */
export function toModelMessages(entries: SessionEntry[]): SDKModelMessage[] {
  const messages: SDKModelMessage[] = []

  for (const entry of entries) {
    // Skip compact boundary markers — they are metadata, not conversation
    if (entry.type === 'system' && entry.subtype === 'compact_boundary') continue

    const { message } = entry

    if (message.role === 'user') {
      if (typeof message.content === 'string') {
        messages.push({ role: 'user', content: message.content })
      } else {
        // Could be tool_result blocks from Claude Code
        const toolResults = message.content.filter(
          (b): b is Extract<ContentBlock, { type: 'tool_result' }> => b.type === 'tool_result',
        )
        if (toolResults.length > 0) {
          messages.push({
            role: 'tool',
            content: toolResults.map((tr) => ({
              type: 'tool-result' as const,
              toolCallId: tr.tool_use_id,
              toolName: 'unknown', // Claude Code format doesn't store tool name in result
              output: { type: 'text' as const, value: tr.content },
            })),
          })
        } else {
          // Text blocks
          const text = message.content
            .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
            .map((b) => b.text)
            .join('\n')
          if (text) {
            messages.push({ role: 'user', content: text })
          }
        }
      }
    } else if (message.role === 'assistant') {
      if (typeof message.content === 'string') {
        messages.push({ role: 'assistant', content: message.content })
      } else {
        const parts: SDKAssistantMessage['content'] = []

        for (const block of message.content) {
          if (block.type === 'text') {
            parts.push({ type: 'text', text: block.text })
          } else if (block.type === 'tool_use') {
            parts.push({
              type: 'tool-call',
              toolCallId: block.id,
              toolName: block.name,
              input: block.input,
            })
          }
          // tool_result in assistant content is unusual, skip
        }

        if (parts.length > 0) {
          messages.push({ role: 'assistant', content: parts })
        }
      }
    }
    // system role messages (non-boundary) are skipped — they don't map to SDK messages
  }

  return messages
}

/** Max characters for a tool input/output summary line. */
const TOOL_SUMMARY_MAX = 200

/** Truncate a string to maxLen, appending "…" if trimmed. */
function truncate(s: string, maxLen: number): string {
  return s.length <= maxLen ? s : s.slice(0, maxLen) + '…'
}

/** Summarize a single ContentBlock into a human-readable line (or null to skip). */
function summarizeBlock(block: ContentBlock): string | null {
  if (block.type === 'text') return block.text
  if (block.type === 'tool_use') {
    const inputStr = truncate(JSON.stringify(block.input), TOOL_SUMMARY_MAX)
    return `[Tool: ${block.name} ${inputStr}]`
  }
  if (block.type === 'tool_result') {
    return `[Result: ${truncate(block.content, TOOL_SUMMARY_MAX)}]`
  }
  return null
}

/**
 * Extract conversation history including tool call summaries.
 *
 * Text blocks are preserved as-is. Tool calls and results are converted to
 * short summary lines so the Claude Code provider can see what happened in
 * prior rounds without the full payloads.
 */
export function toTextHistory(entries: SessionEntry[]): Array<{ role: 'user' | 'assistant'; text: string }> {
  const history: Array<{ role: 'user' | 'assistant'; text: string }> = []

  for (const entry of entries) {
    // Skip system entries (compact boundaries)
    if (entry.type === 'system') continue

    const { message } = entry
    if (message.role !== 'user' && message.role !== 'assistant') continue

    let text: string
    if (typeof message.content === 'string') {
      text = message.content
    } else {
      text = message.content
        .map(summarizeBlock)
        .filter(Boolean)
        .join('\n')
    }

    if (text.trim()) {
      history.push({ role: message.role as 'user' | 'assistant', text })
    }
  }

  return history
}

// ==================== Chat History (for Web UI) ====================

/** A display-ready chat history item — either plain text or a group of paired tool calls. */
export type ChatHistoryItem =
  | { kind: 'text'; role: 'user' | 'assistant'; text: string; timestamp?: string; metadata?: Record<string, unknown>; media?: Array<{ type: string; url: string }> }
  | { kind: 'tool_calls'; calls: Array<{ name: string; input: string; result?: string }>; timestamp?: string }

/** Strip common MCP tool-name prefixes for cleaner display. */
function shortToolName(name: string): string {
  return name.replace(/^mcp__[^_]+__/, '')
}

/**
 * Convert session entries → display-ready chat history for the Web UI.
 *
 * - Text blocks are preserved as-is.
 * - tool_use entries are paired with their corresponding tool_result entries
 *   and emitted as `{ kind: 'tool_calls' }` items.
 * - Consumed tool_result entries are skipped so they don't appear twice.
 */
export function toChatHistory(entries: SessionEntry[]): ChatHistoryItem[] {
  const items: ChatHistoryItem[] = []

  // Set of entry indices that have been consumed as tool results.
  const consumed = new Set<number>()

  for (let i = 0; i < entries.length; i++) {
    if (consumed.has(i)) continue

    const entry = entries[i]
    if (entry.type === 'system') continue

    const { message } = entry
    if (message.role !== 'user' && message.role !== 'assistant') continue

    // Plain string content — always text.
    if (typeof message.content === 'string') {
      if (message.content.trim()) {
        items.push({ kind: 'text', role: message.role as 'user' | 'assistant', text: message.content, timestamp: entry.timestamp, metadata: entry.metadata })
      }
      continue
    }

    // Content block array — classify by block types present.
    const textBlocks = message.content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    const imageBlocks = message.content.filter((b): b is Extract<ContentBlock, { type: 'image' }> => b.type === 'image')
    const toolUseBlocks = message.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
    const toolResultBlocks = message.content.filter((b): b is Extract<ContentBlock, { type: 'tool_result' }> => b.type === 'tool_result')
    const media = imageBlocks.length > 0 ? imageBlocks.map((b) => ({ type: 'image', url: b.url })) : undefined

    // If this entry has tool_use blocks, pair them with tool_results from the next entry.
    if (toolUseBlocks.length > 0) {
      // Build a result map from the next entry (if it contains tool_results).
      const resultMap = new Map<string, string>()
      if (i + 1 < entries.length) {
        const nextEntry = entries[i + 1]
        if (nextEntry.type !== 'system' && typeof nextEntry.message.content !== 'string') {
          for (const block of nextEntry.message.content) {
            if (block.type === 'tool_result') {
              resultMap.set(block.tool_use_id, block.content)
            }
          }
          if (resultMap.size > 0) {
            consumed.add(i + 1)
          }
        }
      }

      const calls = toolUseBlocks.map((tu) => ({
        name: shortToolName(tu.name),
        input: truncate(JSON.stringify(tu.input), TOOL_SUMMARY_MAX),
        result: resultMap.get(tu.id) ? truncate(resultMap.get(tu.id)!, TOOL_SUMMARY_MAX) : undefined,
      }))

      items.push({ kind: 'tool_calls', calls, timestamp: entry.timestamp })

      // If there were also text blocks in this same entry, emit them separately.
      const text = textBlocks.map((b) => b.text).join('\n')
      if (text.trim() || media) {
        items.push({ kind: 'text', role: message.role as 'user' | 'assistant', text, timestamp: entry.timestamp, metadata: entry.metadata, media })
      }
      continue
    }

    // Pure tool_result entry (not consumed by a preceding tool_use) — skip it.
    if (toolResultBlocks.length > 0 && textBlocks.length === 0) {
      continue
    }

    // Text (+ optional image) entry.
    const text = textBlocks.map((b) => b.text).join('\n')
    if (text.trim() || media) {
      items.push({ kind: 'text', role: message.role as 'user' | 'assistant', text, timestamp: entry.timestamp, metadata: entry.metadata, media })
    }
  }

  return items
}
