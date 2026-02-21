/**
 * Session compaction — modeled after Claude Code CLI's internal compact mechanism.
 *
 * Two-phase approach:
 *   1. Microcompact: strip large old tool results (no LLM call, in-memory only)
 *   2. Full compact:  LLM summarization → compact_boundary + summary written to JSONL
 *
 * The caller decides which model to use for summarization by providing a `summarize` function.
 */

import { randomUUID } from 'node:crypto'
import type { SessionEntry, ContentBlock } from './session.js'
import type { SessionStore } from './session.js'

// ==================== Configuration ====================

export interface CompactionConfig {
  /** Max context window for the model. Default: 200_000 */
  maxContextTokens: number
  /** Reserved tokens for model output. Default: 20_000 */
  maxOutputTokens: number
  /** Buffer below effective window to trigger auto-compact. Default: 13_000 */
  autoCompactBuffer: number
  /** Number of recent tool results to keep during microcompact. Default: 3 */
  microcompactKeepRecent: number
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  maxContextTokens: 200_000,
  maxOutputTokens: 20_000,
  autoCompactBuffer: 13_000,
  microcompactKeepRecent: 3,
}

// ==================== Token Estimation ====================

/** Rough chars-per-token ratio for Claude models. */
const CHARS_PER_TOKEN = 3.5

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export function estimateEntryTokens(entry: SessionEntry): number {
  const { content } = entry.message
  if (typeof content === 'string') {
    return estimateTokens(content)
  }
  let chars = 0
  for (const block of content) {
    if (block.type === 'text') chars += block.text.length
    else if (block.type === 'tool_use') chars += JSON.stringify(block.input).length + block.name.length
    else if (block.type === 'tool_result') chars += block.content.length
  }
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

export function estimateSessionTokens(entries: SessionEntry[]): number {
  return entries.reduce((sum, e) => sum + estimateEntryTokens(e), 0)
}

// ==================== Threshold ====================

export function getEffectiveWindow(config: CompactionConfig): number {
  return config.maxContextTokens - config.maxOutputTokens
}

export function getAutoCompactThreshold(config: CompactionConfig): number {
  const effectiveWindow = getEffectiveWindow(config)
  const pctOverride = process.env.COMPACT_PCT_OVERRIDE
    ? parseFloat(process.env.COMPACT_PCT_OVERRIDE)
    : undefined

  if (pctOverride && !isNaN(pctOverride) && pctOverride > 0 && pctOverride <= 100) {
    return Math.min(
      Math.floor(effectiveWindow * (pctOverride / 100)),
      effectiveWindow - config.autoCompactBuffer,
    )
  }
  return effectiveWindow - config.autoCompactBuffer
}

// ==================== Active Entries (like Claude Code's vZ) ====================

/** Find the last compact_boundary and return entries from that point onward. */
export function getActiveEntries(entries: SessionEntry[]): SessionEntry[] {
  let boundaryIdx = -1
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].type === 'system' && entries[i].subtype === 'compact_boundary') {
      boundaryIdx = i
      break
    }
  }
  return boundaryIdx === -1 ? entries : entries.slice(boundaryIdx)
}

// ==================== Microcompact (no LLM call) ====================

const TRUNCATION_PLACEHOLDER = '[content truncated during compaction]'
const LARGE_TOOL_RESULT_THRESHOLD = 500 // characters
const MIN_MICROCOMPACT_SAVINGS = 20_000  // tokens

/**
 * Strip large old tool results in-memory. Does NOT write to disk.
 * Returns a new entry array and the estimated token savings.
 */
export function microcompact(
  entries: SessionEntry[],
  config: CompactionConfig,
): { entries: SessionEntry[]; savedTokens: number } {
  // Collect indices of entries that contain tool_result blocks
  const toolResultIndices: number[] = []
  for (let i = 0; i < entries.length; i++) {
    const content = entries[i].message.content
    if (Array.isArray(content) && content.some(b => b.type === 'tool_result')) {
      toolResultIndices.push(i)
    }
  }

  // Keep the most recent N tool results intact
  const truncatable = new Set(
    toolResultIndices.slice(0, Math.max(0, toolResultIndices.length - config.microcompactKeepRecent)),
  )

  let savedTokens = 0
  const result = entries.map((entry, i) => {
    if (!truncatable.has(i)) return entry

    const content = entry.message.content
    if (!Array.isArray(content)) return entry

    const newContent: ContentBlock[] = content.map(block => {
      if (block.type === 'tool_result' && block.content.length > LARGE_TOOL_RESULT_THRESHOLD) {
        savedTokens += estimateTokens(block.content) - estimateTokens(TRUNCATION_PLACEHOLDER)
        return { ...block, content: TRUNCATION_PLACEHOLDER }
      }
      return block
    })

    return { ...entry, message: { ...entry.message, content: newContent } }
  })

  return { entries: result, savedTokens }
}

// ==================== Full Compact (LLM summarization) ====================

/** Build the summarization prompt. Modeled after Claude Code's t2A function. */
export function buildSummarizationPrompt(entries: SessionEntry[]): string {
  const conversationText = entries
    .filter(e => e.type !== 'system')
    .map(e => {
      const role = e.message.role.toUpperCase()
      const content = typeof e.message.content === 'string'
        ? e.message.content
        : e.message.content
            .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
            .map(b => b.text)
            .join('\n')
      return `[${role}]: ${content}`
    })
    .join('\n\n')

  return `Your task is to create a detailed summary of the conversation so far, preserving all important context needed to continue the session.

<conversation>
${conversationText}
</conversation>

Produce a summary inside <summary> tags with these sections:

1. **Primary Request and Intent**: What is the user's main goal or ongoing task?
2. **Key Technical Concepts**: Important domain concepts, terminology, or constraints mentioned.
3. **Current State**: What has been accomplished so far? What is the current situation?
4. **Important Data Points**: Specific numbers, prices, positions, or configuration values that matter.
5. **User Preferences**: Any expressed preferences, constraints, or style requests.
6. **Pending Tasks**: What still needs to be done?
7. **Current Work**: What was being actively worked on when this summary was created?

Be thorough but concise. Preserve specific values (numbers, names, IDs) exactly.
IMPORTANT: Respond with ONLY the <summary>...</summary> block. Do NOT use any tools.`
}

/** Create a compact_boundary system entry. */
export function createCompactBoundary(
  trigger: 'auto' | 'manual',
  preTokens: number,
  sessionId: string,
  parentUuid: string | null,
): SessionEntry {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    message: { role: 'system', content: 'Conversation compacted' },
    compactMetadata: { trigger, preTokens },
    uuid: randomUUID(),
    parentUuid,
    sessionId,
    timestamp: new Date().toISOString(),
    provider: 'compaction',
  }
}

/** Create the summary user entry that follows a compact_boundary. */
export function createSummaryEntry(
  summaryText: string,
  sessionId: string,
  parentUuid: string,
): SessionEntry {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: `This session is being continued from a previous conversation. The summary below covers the earlier portion of the conversation.\n\n${summaryText}`,
    },
    uuid: randomUUID(),
    parentUuid,
    sessionId,
    timestamp: new Date().toISOString(),
    provider: 'compaction',
    isCompactSummary: true,
  }
}

// ==================== Orchestrator ====================

export interface CompactionResult {
  compacted: boolean
  method: 'none' | 'microcompact' | 'full'
  /** Microcompacted entries (in-memory only, not persisted). Only set when method === 'microcompact'. */
  activeEntries?: SessionEntry[]
}

/**
 * Check if compaction is needed and perform it.
 *
 * - If below threshold → returns { compacted: false, method: 'none' }
 * - If microcompact is enough → returns microcompacted entries (in-memory, not written to disk)
 * - If full compact needed → writes boundary + summary to JSONL, future readActive() will pick them up
 */
export async function compactIfNeeded(
  session: SessionStore,
  config: CompactionConfig,
  summarize: (prompt: string) => Promise<string>,
): Promise<CompactionResult> {
  const allEntries = await session.readAll()
  const activeEntries = getActiveEntries(allEntries)
  const currentTokens = estimateSessionTokens(activeEntries)
  const threshold = getAutoCompactThreshold(config)

  if (currentTokens < threshold) {
    return { compacted: false, method: 'none' }
  }

  console.log(`compaction: session ${session.id} exceeded threshold (${currentTokens}/${threshold} tokens)`)

  // Phase 1: try microcompact
  const { entries: microcompacted, savedTokens } = microcompact(activeEntries, config)
  if (savedTokens >= MIN_MICROCOMPACT_SAVINGS && estimateSessionTokens(microcompacted) < threshold) {
    console.log(`compaction: microcompact saved ~${savedTokens} tokens (${currentTokens} → ${estimateSessionTokens(microcompacted)} tokens, ${activeEntries.length} entries)`)
    return { compacted: true, method: 'microcompact', activeEntries: microcompacted }
  }

  // Phase 2: full compact
  console.log(`compaction: microcompact insufficient (saved ${savedTokens}), running full LLM summarization...`)
  const prompt = buildSummarizationPrompt(activeEntries)
  const summaryText = await summarize(prompt)

  const lastEntry = allEntries[allEntries.length - 1]
  const boundary = createCompactBoundary('auto', currentTokens, session.id, lastEntry?.uuid ?? null)
  const summary = createSummaryEntry(summaryText, session.id, boundary.uuid)

  await session.appendRaw(boundary)
  await session.appendRaw(summary)

  console.log(`compaction: full compact done. ${activeEntries.length} entries → summary`)
  return { compacted: true, method: 'full' }
}

/**
 * Force a full compact regardless of token threshold.
 * Skips microcompact and goes straight to LLM summarization.
 * Returns token count before compaction, or null if session was empty.
 */
export async function forceCompact(
  session: SessionStore,
  summarize: (prompt: string) => Promise<string>,
): Promise<{ preTokens: number } | null> {
  const allEntries = await session.readAll()
  const activeEntries = getActiveEntries(allEntries)
  if (activeEntries.length === 0) return null

  const currentTokens = estimateSessionTokens(activeEntries)
  console.log(`compaction: manual compact for session ${session.id} (~${currentTokens} tokens, ${activeEntries.length} entries)`)

  const prompt = buildSummarizationPrompt(activeEntries)
  const summaryText = await summarize(prompt)

  const lastEntry = allEntries[allEntries.length - 1]
  const boundary = createCompactBoundary('manual', currentTokens, session.id, lastEntry?.uuid ?? null)
  const summary = createSummaryEntry(summaryText, session.id, boundary.uuid)

  await session.appendRaw(boundary)
  await session.appendRaw(summary)

  console.log(`compaction: manual compact done. ${activeEntries.length} entries → summary`)
  return { preTokens: currentTokens }
}
