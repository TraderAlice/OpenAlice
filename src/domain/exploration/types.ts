/**
 * Exploration loop — autonomous self-improvement, Hermes-style.
 *
 * Architecture:
 *   [cron trigger or manual]
 *     → recall (skill-curator loads relevant skills from data/skills/)
 *     → explore (askWithSession with skills injected as system context)
 *     → reflect (LLM decides if a new skill is worth persisting, writes markdown)
 *     → brain commit (record insight in frontal lobe)
 *
 * Design principles:
 *   - File-driven: skills are markdown files in data/skills/{slug}.md
 *   - Sonnet 4.6 only (user preference, keeps Max subscription tokens bounded)
 *   - Pauses automatically when the user is actively using ALICE (to avoid stealing tokens)
 *   - Skills have frontmatter for indexing; recall is keyword-based (no FTS5/embedding yet)
 */

import { z } from 'zod'

// ==================== Config ====================

export const explorationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Model used for both exploration and reflection. Hardcoded Sonnet per user request. */
  model: z.string().default('claude-sonnet-4-6'),
  /** Where skill markdown files live. */
  skillsDir: z.string().default('data/skills'),
  /** Directory for exploration session JSONLs. */
  sessionNamespace: z.string().default('exploration/autonomous'),
  schedule: z.object({
    enabled: z.boolean().default(false),
    /**
     * Cron expression (node-cron).
     * Default: every 30 min during TW sleep hours (23:00–06:30).
     * No runs during peak hours (台股盤中、美股盤中、白天活動時段).
     * → ~16 runs/night, 0 runs during the day.
     */
    cronExpression: z.string().default('0,30 23,0-6 * * *'),
    timezone: z.string().default('Asia/Taipei'),
  }).default({
    enabled: false,
    cronExpression: '0,30 23,0-6 * * *',
    timezone: 'Asia/Taipei',
  }),
  reflection: z.object({
    /** Minimum tool-call count before reflection is considered worthwhile. */
    minToolCalls: z.number().int().nonnegative().default(3),
    /** Maximum skills kept in library; oldest-unused pruned first. */
    maxSkills: z.number().int().positive().default(200),
  }).default({
    minToolCalls: 3,
    maxSkills: 200,
  }),
  /** Push high-confidence insights to this channel. Empty = silent mode. */
  notifyChannels: z.array(z.string()).default([]),
  /** Skip the loop if the last user chat interaction was within N minutes. */
  pauseIfUserActiveWithinMin: z.number().int().nonnegative().default(10),
})

export type ExplorationConfig = z.infer<typeof explorationConfigSchema>

// ==================== Skill ====================

/**
 * A skill is a structured markdown file:
 *
 *   ---
 *   id: 2026-04-11-tsmc-earnings-pre-positioning
 *   triggers: [tsmc, earnings, 半導體]
 *   created: 2026-04-11T06:07:00+08:00
 *   usageCount: 0
 *   confidence: 0.7
 *   ---
 *
 *   # 台積電法說前部位調整
 *
 *   ## When to load
 *   ...
 *
 *   ## Procedure
 *   ...
 */
export interface SkillFrontmatter {
  id: string
  triggers: string[]
  created: string
  usageCount: number
  confidence: number
  /** ISO timestamp of last recall (skill-curator uses this for LRU pruning). */
  lastUsedAt?: string
  /** Optional one-line summary for compact listings. */
  summary?: string
}

export interface Skill {
  frontmatter: SkillFrontmatter
  body: string
  filePath: string
}

// ==================== Trigger & result ====================

export type ExplorationTriggerSource = 'manual' | 'cron' | 'tool'

export interface ExplorationTrigger {
  source: ExplorationTriggerSource
  /** Optional seed idea — if missing, explorer picks one from a rotation. */
  topic?: string
  /** Optional extra context to inject into the prompt (e.g. "portfolio down 2% today"). */
  contextNotes?: string
}

export interface ExplorationResult {
  ok: boolean
  startedAt: string
  durationMs: number
  /** Number of tool calls the agent made during exploration. */
  toolCalls: number
  /** The agent's final text output. */
  summary: string
  /** Skills that were loaded before exploration. */
  recalledSkillIds: string[]
  /** Skill that was created from this exploration, if any. */
  createdSkillId: string | null
  error?: string
}

// ==================== Event types ====================

export const EXPLORATION_EVENTS = {
  STARTED: 'exploration.started',
  RECALL_COMPLETED: 'exploration.recall.completed',
  EXPLORE_COMPLETED: 'exploration.explore.completed',
  EXPLORE_FAILED: 'exploration.explore.failed',
  SKILL_CREATED: 'exploration.skill.created',
  SKILL_PRUNED: 'exploration.skill.pruned',
  PAUSED_USER_ACTIVE: 'exploration.paused.user_active',
  COMPLETED: 'exploration.completed',
} as const

export type ExplorationEventType =
  typeof EXPLORATION_EVENTS[keyof typeof EXPLORATION_EVENTS]
