import { tool } from 'ai'
import { z } from 'zod'
import { readdir, stat } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { ConnectorCenter } from '@/core/connector-center.js'
import { getActiveEntries } from '@/core/compaction.js'
import { toTextHistory, type SessionEntry } from '@/core/session.js'

const DEFAULT_SESSIONS_DIR = join(process.cwd(), 'data', 'sessions')

function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/')
}

/**
 * Create session awareness tools — cross-session visibility for the AI.
 *
 * Tools:
 * - listConnectors: See registered connectors + last interaction
 * - listSessions: Discover all session files on disk
 * - readSession: Read recent messages from any session
 */
export function createSessionTools(
  connectorCenter: ConnectorCenter,
  sessionsDir = DEFAULT_SESSIONS_DIR,
) {
  return {
    listConnectors: tool({
      description:
        'List all registered communication connectors (Web, Telegram, MCP, etc.) and the last user interaction info. Use this to understand which channels are active and where the user was last seen.',
      inputSchema: z.object({}),
      execute: async () => {
        const connectors = connectorCenter.list().map((c) => ({
          channel: c.channel,
          to: c.to,
          capabilities: c.capabilities,
        }))
        const raw = connectorCenter.getLastInteraction()
        const lastInteraction = raw
          ? { channel: raw.channel, to: raw.to, time: new Date(raw.ts).toISOString() }
          : null
        return { connectors, lastInteraction }
      },
    }),

    listSessions: tool({
      description:
        'List all conversation sessions on disk with size and last-modified time. Session IDs follow the pattern: web/default, telegram/{userId}, heartbeat, cron/default, etc.',
      inputSchema: z.object({}),
      execute: async () => {
        const sessions = await findJsonlFiles(sessionsDir, sessionsDir)
        return { sessions }
      },
    }),

    readSession: tool({
      description:
        'Read recent messages from a specific session. Returns text summaries of each message (tool calls are compressed to one-line summaries). Use listSessions first to discover available session IDs.',
      inputSchema: z.object({
        sessionId: z.string().describe('Session ID to read, e.g. "web/default", "heartbeat", "telegram/12345"'),
        limit: z.number().int().positive().optional().describe('Number of recent messages to return (default: 20)'),
        offset: z.number().int().nonnegative().optional().describe('Number of messages to skip from the end for pagination (default: 0)'),
        includeToolCalls: z.boolean().optional().describe('Include tool call details in output (default: true). Set to false to see only text content, keeping context concise.'),
      }),
      execute: async ({ sessionId, limit = 20, offset = 0, includeToolCalls = true }) => {
        // Security: prevent path traversal
        const filePath = resolve(join(sessionsDir, sessionId + '.jsonl'))
        if (!filePath.startsWith(resolve(sessionsDir))) {
          return { error: 'Invalid session ID' }
        }

        try {
          const raw = await readFile(filePath, 'utf-8')
          const allEntries = raw
            .split('\n')
            .filter((line) => line.trim())
            .map((line) => {
              try { return JSON.parse(line) as SessionEntry } catch { return null }
            })
            .filter((e): e is SessionEntry =>
              e !== null && (e.type === 'user' || e.type === 'assistant' || e.type === 'system'),
            )

          const active = getActiveEntries(allEntries)

          // When includeToolCalls is false, strip tool blocks from entries before conversion
          const filtered = includeToolCalls ? active : stripToolBlocks(active)
          const history = toTextHistory(filtered)

          // Add timestamps from the original entries
          const withTimestamps = history.map((h, i) => {
            // Find the matching active entry by walking in parallel
            const entry = active.filter((e) => e.type !== 'system')[i]
            return { ...h, timestamp: entry?.timestamp }
          })

          // Slice: most recent `limit` entries, skipping `offset` from the end
          const end = offset > 0 ? -offset : undefined
          const start = -(offset + limit)
          const sliced = withTimestamps.slice(start, end)

          return { sessionId, total: withTimestamps.length, messages: sliced }
        } catch (err: unknown) {
          if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            return { error: 'Session not found', sessionId }
          }
          throw err
        }
      },
    }),
  }
}

// ==================== Helpers ====================

/**
 * Strip tool_use and tool_result blocks from session entries.
 * Entries that become empty after stripping are dropped entirely.
 */
function stripToolBlocks(entries: SessionEntry[]): SessionEntry[] {
  const result: SessionEntry[] = []
  for (const entry of entries) {
    if (typeof entry.message.content === 'string') {
      result.push(entry)
      continue
    }
    const textOnly = entry.message.content.filter(
      (b) => b.type !== 'tool_use' && b.type !== 'tool_result',
    )
    if (textOnly.length > 0) {
      result.push({ ...entry, message: { ...entry.message, content: textOnly } })
    }
  }
  return result
}

/** Recursively find all .jsonl files under a directory. */
async function findJsonlFiles(
  dir: string,
  base: string,
): Promise<Array<{ id: string; sizeBytes: number; lastModified: string }>> {
  const results: Array<{ id: string; sizeBytes: number; lastModified: string }> = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...await findJsonlFiles(fullPath, base))
      } else if (entry.name.endsWith('.jsonl')) {
        const s = await stat(fullPath)
        const id = toPosixPath(relative(base, fullPath).replace(/\.jsonl$/, ''))
        results.push({ id, sizeBytes: s.size, lastModified: s.mtime.toISOString() })
      }
    }
  } catch { /* directory doesn't exist yet */ }
  return results
}
