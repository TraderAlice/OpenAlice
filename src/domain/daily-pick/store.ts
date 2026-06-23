/**
 * File-backed persistence for daily-pick state.
 *
 * Layout:
 *   data/picks/watchlist.json          — user-curated candidate symbols
 *   data/picks/daily/YYYY-MM-DD.json   — one file per trading day
 *   data/picks/wraps/YYYY-MM-DD_5d.md  — 5-day wrap-up markdown
 *   data/picks/lessons.jsonl           — append-only lesson store (RAG)
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import type { DailyPick, Lesson } from './types.js'

const ROOT = resolve('data/picks')
const DAILY_DIR = join(ROOT, 'daily')
const WRAPS_DIR = join(ROOT, 'wraps')
const WATCHLIST_FILE = join(ROOT, 'watchlist.json')
const LESSONS_FILE = join(ROOT, 'lessons.jsonl')

async function ensureDirs(): Promise<void> {
  await mkdir(DAILY_DIR, { recursive: true })
  await mkdir(WRAPS_DIR, { recursive: true })
}

// ==================== Watchlist ====================

export interface WatchlistEntry {
  symbol: string
  name?: string
  /** Optional note explaining why this stock is on the list. */
  note?: string
}

/** Returns the user-curated watchlist; empty array if file missing. */
export async function readWatchlist(): Promise<WatchlistEntry[]> {
  try {
    const raw = await readFile(WATCHLIST_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function writeWatchlist(entries: WatchlistEntry[]): Promise<void> {
  await ensureDirs()
  await writeFile(WATCHLIST_FILE, JSON.stringify(entries, null, 2) + '\n')
}

// ==================== Daily picks ====================

function dailyPath(date: string): string {
  return join(DAILY_DIR, `${date}.json`)
}

export async function readDailyPick(date: string): Promise<DailyPick | null> {
  try {
    return JSON.parse(await readFile(dailyPath(date), 'utf-8')) as DailyPick
  } catch {
    return null
  }
}

export async function writeDailyPick(pick: DailyPick): Promise<void> {
  await ensureDirs()
  await writeFile(dailyPath(pick.date), JSON.stringify(pick, null, 2) + '\n')
}

/** List the most recent N daily picks, newest first. */
export async function listRecentPicks(limit = 30): Promise<DailyPick[]> {
  await ensureDirs()
  let files: string[] = []
  try {
    files = await readdir(DAILY_DIR)
  } catch {
    return []
  }
  const dated = files
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse()
    .slice(0, limit)
  const out: DailyPick[] = []
  for (const f of dated) {
    try {
      out.push(JSON.parse(await readFile(join(DAILY_DIR, f), 'utf-8')) as DailyPick)
    } catch {
      // skip corrupt file
    }
  }
  return out
}

// ==================== Wraps ====================

function wrapPath(endDate: string): string {
  return join(WRAPS_DIR, `${endDate}_5d.md`)
}

export async function writeWrap(endDate: string, markdown: string): Promise<void> {
  await ensureDirs()
  await writeFile(wrapPath(endDate), markdown)
}

export async function readWrap(endDate: string): Promise<string | null> {
  try {
    return await readFile(wrapPath(endDate), 'utf-8')
  } catch {
    return null
  }
}

export async function listWraps(): Promise<string[]> {
  await ensureDirs()
  try {
    const files = await readdir(WRAPS_DIR)
    return files.filter((f) => f.endsWith('_5d.md')).sort().reverse()
  } catch {
    return []
  }
}

// ==================== Lessons (RAG store) ====================

export async function appendLessons(lessons: Lesson[]): Promise<void> {
  if (lessons.length === 0) return
  await ensureDirs()
  const lines = lessons.map((l) => JSON.stringify(l)).join('\n') + '\n'
  await writeFile(LESSONS_FILE, lines, { flag: 'a' })
}

export async function readAllLessons(): Promise<Lesson[]> {
  try {
    const raw = await readFile(LESSONS_FILE, 'utf-8')
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as Lesson
        } catch {
          return null
        }
      })
      .filter((l): l is Lesson => l !== null)
  } catch {
    return []
  }
}

/**
 * Lexical RAG: rank lessons by token-overlap with the query.
 * Returns up to `limit` matches, highest score first.
 */
export async function searchLessons(query: string, limit = 5): Promise<Lesson[]> {
  const lessons = await readAllLessons()
  if (lessons.length === 0) return []

  const tokens = tokenize(query)
  if (tokens.length === 0) return lessons.slice(-limit).reverse()

  const scored = lessons.map((l) => {
    const haystack = tokenize(`${l.lesson} ${l.tags.join(' ')} ${l.context} ${l.symbol}`)
    let score = 0
    for (const t of tokens) {
      if (haystack.includes(t)) score += 1
    }
    return { lesson: l, score }
  })

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.lesson)
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,，。、:：;；()（）\[\]【】\-_/]+/)
    .filter((t) => t.length > 1)
}
