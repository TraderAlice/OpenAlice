import { tool } from 'ai'
import { z } from 'zod'
import type { Explorer } from '@/domain/exploration/explorer'
import type { ExplorationScheduler } from '@/domain/exploration/scheduler'
import type { SkillCurator } from '@/domain/exploration/skill-curator'
import type { EventLog } from '@/core/event-log'
import { EXPLORATION_EVENTS } from '@/domain/exploration/types.js'

/**
 * Create exploration AI tools (trigger self-exploration, list skills, check status)
 *
 * Tools:
 * - explorationRunNow: fire a self-exploration cycle immediately
 * - explorationStatus: last run, recent events, skill count
 * - skillList: list the most recent / highest-confidence skills
 * - skillDelete: remove a skill by id (user-invoked cleanup)
 */
export function createExplorationTools(
  explorer: Explorer,
  scheduler: ExplorationScheduler,
  curator: SkillCurator,
  eventLog: EventLog,
) {
  return {
    explorationRunNow: tool({
      description: `
Trigger an immediate self-exploration cycle.
Alice will pick a topic (or use the one you provide), recall relevant past skills,
explore autonomously with tools, then decide whether to persist a new skill.

Use this when the user asks Alice to "think about X", "research X", "explore X",
or to "go and learn something" while they are away.
      `.trim(),
      inputSchema: z.object({
        topic: z.string().optional().describe(
          '自由文字題目；留空就讓 Alice 自己從輪替主題裡挑一個',
        ),
        contextNotes: z.string().optional().describe('額外 context，例如當前持倉狀態'),
      }),
      execute: async ({ topic, contextNotes }) => {
        if (scheduler.isRunning()) {
          return { status: 'already_running', message: 'Exploration 正在跑，請稍等' }
        }
        // Fire and forget — tool returns immediately; explorer runs async.
        explorer
          .run({ source: 'tool', topic, contextNotes })
          .catch((err) => console.error('Exploration tool run failed: %s', err))
        return {
          status: 'started',
          message: topic ? `已啟動探索：${topic}` : '已啟動自主探索（輪替主題）',
        }
      },
    }),

    explorationStatus: tool({
      description: `
Check the exploration scheduler status and recent exploration events.
Returns: last run time, whether a run is in-flight, last error (if any),
skill library size, and recent exploration event log entries.
      `.trim(),
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .positive()
          .default(5)
          .describe('Number of recent events to return'),
      }),
      execute: async ({ limit }) => {
        const skills = await curator.list()
        const allTypes = new Set<string>(Object.values(EXPLORATION_EVENTS))
        const recent = eventLog.recent({ limit: 200 })
        const filtered = recent
          .filter((e) => allTypes.has(e.type))
          .slice(-limit)
          .reverse()
        return {
          isRunning: scheduler.isRunning(),
          lastRunAt: explorer.lastRunAt,
          lastError: explorer.lastError,
          skillCount: skills.length,
          recentEvents: filtered.map((e) => ({
            seq: e.seq,
            type: e.type,
            ts: e.ts,
            payload: e.payload,
          })),
        }
      },
    }),

    skillList: tool({
      description: `
List skills currently in the library. Use this when the user asks "what have you learned"
or wants to audit what Alice has persisted.
      `.trim(),
      inputSchema: z.object({
        limit: z.number().int().positive().default(20),
      }),
      execute: async ({ limit }) => {
        const skills = await curator.list()
        skills.sort((a, b) => {
          // Highest confidence first, then most recent lastUsedAt
          const ca = a.frontmatter.confidence
          const cb = b.frontmatter.confidence
          if (ca !== cb) return cb - ca
          const la = a.frontmatter.lastUsedAt ?? a.frontmatter.created
          const lb = b.frontmatter.lastUsedAt ?? b.frontmatter.created
          return lb.localeCompare(la)
        })
        return {
          total: skills.length,
          skills: skills.slice(0, limit).map((s) => ({
            id: s.frontmatter.id,
            summary: s.frontmatter.summary ?? null,
            triggers: s.frontmatter.triggers,
            confidence: s.frontmatter.confidence,
            usageCount: s.frontmatter.usageCount,
            created: s.frontmatter.created,
            lastUsedAt: s.frontmatter.lastUsedAt ?? null,
          })),
        }
      },
    }),

    skillDelete: tool({
      description: `
Delete a skill by id. Use only when the user explicitly asks to forget a skill
(because it was noise, wrong, or obsolete).
      `.trim(),
      inputSchema: z.object({
        id: z.string().describe('The exact skill id as listed by skillList'),
      }),
      execute: async ({ id }) => {
        const removed = await curator.remove(id)
        return { removed, id }
      },
    }),
  }
}
