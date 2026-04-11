/**
 * Explorer — the core exploration loop.
 *
 * Four phases per run:
 *   1. Guard    — skip if user is actively chatting (last session mtime within N minutes)
 *   2. Recall   — load relevant skills based on market/portfolio context
 *   3. Explore  — askWithSession with Alice persona + skills injected
 *                  Streams tool_use events to count the depth of the exploration.
 *   4. Reflect  — if depth >= threshold, ask Alice to write a skill markdown;
 *                  persist to data/skills/ and mark Brain commit.
 *
 * Hard design choices:
 *   - Always Sonnet 4.6 (user preference — see exploration config.model)
 *   - No automatic push notifications (user sees results by inspecting
 *     data/skills/ + brain commits; can opt in later via notifyChannels)
 *   - All state is file-driven — no in-memory accumulation across runs
 */

import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { SessionStore } from '../../core/session.js'
import type { AgentCenter } from '../../core/agent-center.js'
import type { EventLog, EventLogEntry } from '../../core/event-log.js'
import type { ConnectorCenter } from '../../core/connector-center.js'
import type { Brain } from '../brain/index.js'
import type { SkillCurator } from './skill-curator.js'
import { EXPLORATION_EVENTS } from './types.js'
import type {
  ExplorationConfig,
  ExplorationResult,
  ExplorationTrigger,
  Skill,
} from './types.js'

export interface ExplorerDeps {
  agentCenter: AgentCenter
  eventLog: EventLog
  connectorCenter: ConnectorCenter
  brain: Brain
  skillCurator: SkillCurator
  config: ExplorationConfig
  /** Where session JSONLs live — used for user-active detection. */
  sessionsDir?: string
  /** Injected clock for tests. */
  now?: () => number
}

export interface Explorer {
  run(trigger: ExplorationTrigger): Promise<ExplorationResult>
  lastRunAt: number | null
  lastError: string | null
}

// ==================== Prompts ====================

const EXPLORATION_TOPICS = [
  '挑一個你最近最好奇、但還沒深挖過的台股題材（不要挑熱門大型權值股），用工具查資料、驗證你的假設，然後寫下你學到什麼',
  '複盤最近一次你認為判斷失誤的決策（如果有），挖出真正的原因（不是表面的）',
  '找一個反直覺的市場現象（例如 VIX 低點後反而沒有下跌），用數據驗證是真是假',
  '挑一個你持倉裡最不確定的部位，用至少三個資料來源交叉驗證它現在的處境',
  '研究一個你平常忽略的指標（例如匯率、長短天期利差、原油 beta），看它對你的交易有沒有新的 signal',
  '找一個巨人傑/沈萬鈞/菲比斯的交易原則，用最新的台股資料測試它在 2026 還有沒有效',
]

function pickTopic(trigger: ExplorationTrigger): string {
  if (trigger.topic) return trigger.topic
  // Rotate based on hour-of-day so consecutive runs don't repeat.
  const idx = new Date().getHours() % EXPLORATION_TOPICS.length
  return EXPLORATION_TOPICS[idx]
}

function buildExplorationPrompt(
  topic: string,
  recalled: Skill[],
  contextNotes?: string,
): string {
  let recalledBlock = ''
  if (recalled.length > 0) {
    const lines = recalled.map((s) => {
      const summary = s.frontmatter.summary ?? s.body.split('\n')[0].replace(/^#+\s*/, '')
      return `- [${s.frontmatter.id}] ${summary}（confidence ${s.frontmatter.confidence.toFixed(1)}）`
    })
    recalledBlock = `\n\n## 你之前學到的相關經驗（先讀過再開始探索）\n${lines.join('\n')}\n\n如果其中哪一條跟這次任務有關，優先引用、別重新踩一次坑。`
  }

  const notes = contextNotes ? `\n\n## 額外 context\n${contextNotes}` : ''

  return `現在是閒時自由探索時間。以下是你要自主深挖的題目：

**${topic}**${recalledBlock}${notes}

## 你的工作方式
- 完全自主，不要問我要不要執行
- 至少用 3 個工具收集真實資料，不要憑記憶
- 有假設 → 驗證 → 對照結果 → 修正，而不是下結論就結束
- 如果發現反直覺或重複出現的模式，特別標記 **INSIGHT:** 讓我知道
- 最後給我一段 300–500 字的總結，含：做了什麼、學到什麼、有沒有 INSIGHT 值得記起來`
}

function buildReflectionPrompt(explorationSummary: string, topic: string): string {
  return `你剛剛做了一次自由探索，題目是：

> ${topic}

你的總結是：

---
${explorationSummary}
---

## 任務
從這次探索裡提煉一份 **skill markdown**。只有當這份 skill 符合下面任一條件才寫：
- 反直覺（跟常識相反的發現）
- 可重複使用（下次類似 context 你就會直接 load 它）
- 具體到可以照步驟執行

如果不符合，直接回傳單字 \`SKIP\`（不要寫 skill，也不要解釋）。

## skill 格式
如果要寫，**只回傳下面的 JSON**，不要 markdown fence、不要任何說明文字：

{
  "triggers": ["關鍵字1", "關鍵字2", "關鍵字3"],
  "confidence": 0.0 到 1.0 的數字,
  "summary": "一行說明這個 skill 是幹嘛的",
  "body": "# 標題\\n\\n## When to load\\n什麼情境下要叫出這個 skill\\n\\n## Procedure\\n1. 第一步...\\n2. 第二步...\\n\\n## Pitfalls\\n- 陷阱 1\\n- 陷阱 2\\n\\n## Verification\\n怎麼驗證 skill 跑對了"
}`
}

// ==================== User-active guard ====================

async function userActiveWithin(
  sessionsDir: string,
  excludeNamespace: string,
  withinMin: number,
  now: number,
): Promise<boolean> {
  if (withinMin <= 0) return false
  const thresholdMs = withinMin * 60 * 1000
  const rootAbs = resolve(sessionsDir)

  async function walk(dir: string): Promise<boolean> {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return false
    }
    for (const name of entries) {
      const full = join(dir, name)
      // Skip the exploration namespace so our own writes don't block us.
      const rel = full.slice(rootAbs.length + 1)
      if (rel.startsWith(excludeNamespace)) continue

      let st: Awaited<ReturnType<typeof stat>>
      try {
        st = await stat(full)
      } catch {
        continue
      }

      if (st.isDirectory()) {
        if (await walk(full)) return true
        continue
      }
      if (!name.endsWith('.jsonl')) continue
      if (now - st.mtimeMs < thresholdMs) return true
    }
    return false
  }

  return walk(rootAbs)
}

// ==================== Reflection parsing ====================

interface ParsedReflection {
  skip: boolean
  triggers?: string[]
  confidence?: number
  summary?: string
  body?: string
}

function parseReflection(raw: string): ParsedReflection {
  const trimmed = raw.trim()
  if (trimmed.toUpperCase() === 'SKIP' || trimmed.startsWith('SKIP')) {
    return { skip: true }
  }
  // Tolerate code fences even though we asked not to use them.
  let jsonStr = trimmed
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed)
  if (fenceMatch) jsonStr = fenceMatch[1]
  // Grab the first {...} block.
  const start = jsonStr.indexOf('{')
  const end = jsonStr.lastIndexOf('}')
  if (start === -1 || end <= start) return { skip: true }

  try {
    const parsed = JSON.parse(jsonStr.slice(start, end + 1)) as {
      triggers?: unknown
      confidence?: unknown
      summary?: unknown
      body?: unknown
    }
    const triggers = Array.isArray(parsed.triggers)
      ? parsed.triggers.filter((t): t is string => typeof t === 'string')
      : []
    const confidence =
      typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5
    const summary = typeof parsed.summary === 'string' ? parsed.summary : undefined
    const body = typeof parsed.body === 'string' ? parsed.body : undefined
    if (!body || triggers.length === 0) return { skip: true }
    return { skip: false, triggers, confidence, summary, body }
  } catch {
    return { skip: true }
  }
}

// ==================== Explorer ====================

export function createExplorer(deps: ExplorerDeps): Explorer {
  const sessionNs = deps.config.sessionNamespace
  const sessionsDir = deps.sessionsDir ?? 'data/sessions'
  const now = deps.now ?? (() => Date.now())

  let lastRunAt: number | null = null
  let lastError: string | null = null

  async function run(trigger: ExplorationTrigger): Promise<ExplorationResult> {
    const startedAtIso = new Date().toISOString()
    const startMs = now()
    lastError = null

    // -------------- Phase 0: Guard --------------
    const active = await userActiveWithin(
      sessionsDir,
      sessionNs,
      deps.config.pauseIfUserActiveWithinMin,
      startMs,
    )
    if (active) {
      await deps.eventLog.append(EXPLORATION_EVENTS.PAUSED_USER_ACTIVE, {
        trigger: trigger.source,
        startedAt: startedAtIso,
      })
      console.log('Exploration skipped: user active within %d min', deps.config.pauseIfUserActiveWithinMin)
      return {
        ok: false,
        startedAt: startedAtIso,
        durationMs: now() - startMs,
        toolCalls: 0,
        summary: '',
        recalledSkillIds: [],
        createdSkillId: null,
        error: 'paused_user_active',
      }
    }

    await deps.eventLog.append(EXPLORATION_EVENTS.STARTED, {
      trigger: trigger.source,
      topic: trigger.topic ?? null,
      startedAt: startedAtIso,
    })
    console.log('Exploration started (trigger=%s)', trigger.source)

    // -------------- Phase 1: Recall --------------
    const topic = pickTopic(trigger)
    const recalled = await deps.skillCurator.recall({
      context: [topic, trigger.contextNotes ?? ''].join(' '),
      limit: 5,
    })
    const recalledIds = recalled.map((s) => s.frontmatter.id)
    await deps.eventLog.append(EXPLORATION_EVENTS.RECALL_COMPLETED, {
      recalledIds,
      count: recalled.length,
    })

    // -------------- Phase 2: Explore --------------
    const session = new SessionStore(sessionNs)
    const prompt = buildExplorationPrompt(topic, recalled, trigger.contextNotes)
    let summaryText = ''
    let toolCalls = 0
    try {
      const stream = deps.agentCenter.askWithSession(prompt, session, {
        historyPreamble: '以下是你最近的自由探索紀錄：',
      })
      for await (const event of stream) {
        if (event.type === 'tool_use') toolCalls += 1
        if (event.type === 'done') summaryText = event.result.text
      }
    } catch (err) {
      lastError = String(err)
      await deps.eventLog.append(EXPLORATION_EVENTS.EXPLORE_FAILED, {
        error: lastError,
        durationMs: now() - startMs,
      })
      console.error('Exploration failed: %s', err)
      return {
        ok: false,
        startedAt: startedAtIso,
        durationMs: now() - startMs,
        toolCalls,
        summary: '',
        recalledSkillIds: recalledIds,
        createdSkillId: null,
        error: lastError,
      }
    }

    await deps.eventLog.append(EXPLORATION_EVENTS.EXPLORE_COMPLETED, {
      toolCalls,
      summaryLength: summaryText.length,
      durationMs: now() - startMs,
    })

    // Mark the recalled skills as used (bumps usageCount, updates lastUsedAt).
    if (recalledIds.length > 0) {
      await deps.skillCurator.markUsed(recalledIds)
    }

    // -------------- Phase 3: Reflect --------------
    let createdSkillId: string | null = null
    const shouldReflect = toolCalls >= deps.config.reflection.minToolCalls
    if (shouldReflect && summaryText.trim().length > 0) {
      const reflectionPrompt = buildReflectionPrompt(summaryText, topic)
      try {
        const reflectionResult = await deps.agentCenter.ask(reflectionPrompt)
        const parsed = parseReflection(reflectionResult.text)
        if (!parsed.skip && parsed.body && parsed.triggers) {
          const skill = await deps.skillCurator.persist({
            triggers: parsed.triggers,
            body: parsed.body,
            confidence: parsed.confidence,
            summary: parsed.summary,
          })
          createdSkillId = skill.frontmatter.id
          await deps.eventLog.append(EXPLORATION_EVENTS.SKILL_CREATED, {
            id: createdSkillId,
            triggers: parsed.triggers,
            confidence: parsed.confidence,
          })
          // Prune if over capacity.
          const pruned = await deps.skillCurator.prune(deps.config.reflection.maxSkills)
          if (pruned.length > 0) {
            await deps.eventLog.append(EXPLORATION_EVENTS.SKILL_PRUNED, { ids: pruned })
          }
        }
      } catch (err) {
        console.warn('Reflection failed (non-fatal): %s', err)
      }
    }

    // -------------- Phase 4: Brain commit --------------
    const brainNote = [
      `🔍 Exploration @ ${startedAtIso.slice(11, 16)}`,
      `Topic: ${topic}`,
      `Tool calls: ${toolCalls}`,
      createdSkillId ? `New skill: ${createdSkillId}` : 'No new skill',
      '',
      summaryText.slice(0, 800),
    ].join('\n')
    deps.brain.updateFrontalLobe(brainNote)

    await deps.eventLog.append(EXPLORATION_EVENTS.COMPLETED, {
      ok: true,
      toolCalls,
      createdSkillId,
      durationMs: now() - startMs,
    })

    lastRunAt = now()
    return {
      ok: true,
      startedAt: startedAtIso,
      durationMs: now() - startMs,
      toolCalls,
      summary: summaryText,
      recalledSkillIds: recalledIds,
      createdSkillId,
    }
  }

  return {
    run,
    get lastRunAt() {
      return lastRunAt
    },
    get lastError() {
      return lastError
    },
  }
}

/** Exported for tests. */
export const __internal = {
  pickTopic,
  buildExplorationPrompt,
  buildReflectionPrompt,
  parseReflection,
  userActiveWithin,
  EXPLORATION_TOPICS,
}
