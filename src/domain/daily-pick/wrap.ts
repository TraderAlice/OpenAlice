/**
 * 5-day wrap — summarizes the last 5 trading days into a markdown brief
 * and extracts lessons into the RAG store.
 *
 * Triggered after the 5th trading day's close. Designed to run weekly
 * (Friday post-close) but works for any 5 consecutive picks regardless
 * of calendar gaps.
 */

import type { AgentCenter } from '../../core/agent-center.js'
import type { DailyPick, Lesson, WrapResult } from './types.js'
import { listRecentPicks, writeWrap, appendLessons } from './store.js'
import { nowIso } from './time.js'

export interface WrapDeps {
  agentCenter: AgentCenter
}

export class WrapWriter {
  constructor(private deps: WrapDeps) {}

  /**
   * Build the wrap from the 5 most recent daily picks.
   * Returns null if fewer than 5 picks exist.
   */
  async writeForLast5(): Promise<WrapResult | null> {
    const picks = (await listRecentPicks(5)).reverse() // chronological
    if (picks.length < 5) return null

    const startDate = picks[0].date
    const endDate = picks[picks.length - 1].date

    const prompt = this.buildPrompt(picks, startDate, endDate)
    const result = await this.deps.agentCenter.ask(prompt)

    const { markdown, lessons } = parseWrapResponse(result.text, picks, endDate)

    await writeWrap(endDate, markdown)
    if (lessons.length > 0) await appendLessons(lessons)

    return { markdown, lessons }
  }

  private buildPrompt(picks: DailyPick[], startDate: string, endDate: string): string {
    const summaries = picks.map((p) => {
      const closed = p.status === 'closed'
      const pnl =
        p.entryPrice && p.exitPrice
          ? `${((Number(p.exitPrice) - Number(p.entryPrice)) / Number(p.entryPrice) * 100).toFixed(2)}%`
          : '(open)'
      const hardRule = p.hourly.find((h) => h.hardRuleTriggered)?.hardRuleTriggered
      const ruleNote = hardRule ? ` [hard rule: ${hardRule}]` : ''
      return [
        `### ${p.date} — ${p.symbol}${p.symbolName ? ` ${p.symbolName}` : ''}`,
        `- Pick reason: ${p.pickReason}`,
        `- Entry: ${p.entryPrice ?? 'never entered'} @ ${p.entryAt ?? '—'}`,
        `- Exit: ${p.exitPrice ?? '(still open)'} @ ${p.exitAt ?? '—'}`,
        `- PnL: ${pnl}${ruleNote}`,
        `- Hours: ${p.hourly.length}`,
      ].join('\n')
    })

    return [
      'You are reviewing 5 trading days of daily picks. Write a 5-day wrap.',
      '',
      `Period: ${startDate} → ${endDate}`,
      '',
      'Daily summaries:',
      ...summaries,
      '',
      'Reply STRICTLY in this format:',
      '',
      '## WRAP',
      '<markdown body, 250-400 words in Traditional Chinese, sections: 表現總覽 / 做對的事 / 做錯的事 / 下週調整>',
      '',
      '## LESSONS',
      '<one lesson per line, format: TAGS=tag1,tag2 | LESSON=<one sentence in Traditional Chinese>>',
      '<…up to 5 lessons total, focused on actionable mistakes and patterns…>',
    ].join('\n')
  }
}

// ==================== Parser ====================

function parseWrapResponse(text: string, picks: DailyPick[], endDate: string): WrapResult {
  const wrapMatch = text.match(/##\s*WRAP\s*\n([\s\S]*?)(?=\n##\s*LESSONS|$)/i)
  const lessonsMatch = text.match(/##\s*LESSONS\s*\n([\s\S]*)/i)

  const wrapBody = wrapMatch?.[1]?.trim() ?? text.trim()
  const lessonsBlock = lessonsMatch?.[1]?.trim() ?? ''

  const markdown = [
    `# 5-Day Wrap (${picks[0].date} → ${endDate})`,
    '',
    `_Generated ${nowIso()}_`,
    '',
    wrapBody,
    '',
    '---',
    '## Daily ledger',
    '',
    ...picks.map((p) => `- ${p.date} — ${p.symbol} → ${p.status}, hours=${p.hourly.length}`),
  ].join('\n')

  const lessons: Lesson[] = []
  if (lessonsBlock) {
    const lines = lessonsBlock.split('\n').map((l) => l.trim()).filter(Boolean)
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/TAGS\s*=\s*([^|]+)\|\s*LESSON\s*=\s*(.+)/i)
      if (!m) continue
      const tags = m[1].split(',').map((t) => t.trim()).filter(Boolean)
      const lessonText = m[2].trim()
      const symbolUnion = picks.map((p) => p.symbol).join(',')
      lessons.push({
        id: `${endDate}-${i + 1}`,
        date: endDate,
        symbol: symbolUnion,
        lesson: lessonText,
        tags,
        context: `5-day period ${picks[0].date}→${endDate}`,
        createdAt: nowIso(),
      })
    }
  }

  return { markdown, lessons }
}
