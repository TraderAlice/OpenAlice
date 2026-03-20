/**
 * News Sentiment Analysis Tools
 *
 * Lightweight keyword-based sentiment scoring on the news archive.
 * Not NLP — just pattern matching that gives the AI a quick pulse
 * on whether recent coverage skews bullish/bearish for a symbol or topic.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { INewsProvider } from '@/domain/news/types.js'

// ==================== Sentiment Lexicon ====================

const BULLISH_PATTERNS = [
  /\bbeat(?:s|ing)?\s+(?:expectations?|estimates?|consensus)\b/i,
  /\bupgrad(?:e[ds]?|ing)\b/i,
  /\bstrong(?:er)?\s+(?:earnings?|results?|revenue|growth|demand)\b/i,
  /\brecord\s+(?:high|revenue|profit|earnings)\b/i,
  /\brais(?:e[ds]?|ing)\s+(?:guidance|outlook|forecast|dividend|target)\b/i,
  /\bsurpass(?:ed|es|ing)?\b/i,
  /\bsurg(?:e[ds]?|ing)\b/i,
  /\brall(?:y|ied|ying|ies)\b/i,
  /\bbreakout\b/i,
  /\bbullish\b/i,
  /\boptimis(?:m|tic)\b/i,
  /\bacceler(?:at(?:e[ds]?|ing)|ation)\b/i,
  /\boutperform(?:s|ed|ing)?\b/i,
  /\bbuy(?:back|ing)?\b/i,
  /\binsider\s+buy(?:s|ing)?\b/i,
  /\bexpansion\b/i,
  /\brecovery\b/i,
  /\bsoar(?:s|ed|ing)?\b/i,
]

const BEARISH_PATTERNS = [
  /\bmiss(?:ed|es|ing)?\s+(?:expectations?|estimates?|consensus)\b/i,
  /\bdowngrad(?:e[ds]?|ing)\b/i,
  /\bweak(?:er|ness)?\s+(?:earnings?|results?|revenue|growth|demand)\b/i,
  /\blower(?:ed|ing|s)?\s+(?:guidance|outlook|forecast|target)\b/i,
  /\bcut(?:s|ting)?\s+(?:guidance|outlook|forecast|dividend|jobs)\b/i,
  /\bplunge[ds]?\b/i,
  /\bcrash(?:ed|es|ing)?\b/i,
  /\bselloff\b|\bsell[\s-]off\b/i,
  /\bbearish\b/i,
  /\bpessimis(?:m|tic)\b/i,
  /\brecession\b/i,
  /\bslump(?:s|ed|ing)?\b/i,
  /\bdecline[ds]?\b/i,
  /\binsider\s+sell(?:s|ing)?\b/i,
  /\bdefault(?:s|ed)?\b/i,
  /\blayoff(?:s)?\b|\bjob\s+cuts?\b/i,
  /\binvestigat(?:e[ds]?|ion|ing)\b/i,
  /\bfraud\b/i,
  /\bwarning\b/i,
  /\btumble[ds]?\b/i,
]

const MACRO_PATTERNS = {
  fedHawkish: [
    /\brate\s+hike\b/i,
    /\btighten(?:s|ed|ing)?\b/i,
    /\bhawkish\b/i,
    /\binflation\s+(?:high|ris(?:e|ing)|persist|sticky)\b/i,
    /\breducing?\s+(?:balance\s+sheet|QE)\b/i,
  ],
  fedDovish: [
    /\brate\s+cut\b/i,
    /\beas(?:e[ds]?|ing)\b/i,
    /\bdovish\b/i,
    /\binflation\s+(?:cool|fall|declin|eas|slow)\b/i,
    /\bpause\b/i,
    /\bpivot\b/i,
  ],
  geopolitical: [
    /\bwar\b/i,
    /\bsanction(?:s|ed)?\b/i,
    /\btariff(?:s)?\b/i,
    /\btrade\s+war\b/i,
    /\btension(?:s)?\b/i,
    /\bconflict\b/i,
    /\bescalat(?:e[ds]?|ion|ing)\b/i,
  ],
}

interface SentimentScore {
  score: number          // -1 to +1
  bullishHits: number
  bearishHits: number
  label: 'bullish' | 'bearish' | 'neutral'
}

function scoreSentiment(text: string): SentimentScore {
  let bullishHits = 0
  let bearishHits = 0

  for (const pattern of BULLISH_PATTERNS) {
    const matches = text.match(pattern)
    if (matches) bullishHits++
  }

  for (const pattern of BEARISH_PATTERNS) {
    const matches = text.match(pattern)
    if (matches) bearishHits++
  }

  const total = bullishHits + bearishHits
  if (total === 0) return { score: 0, bullishHits: 0, bearishHits: 0, label: 'neutral' }

  const score = (bullishHits - bearishHits) / total
  const label = score > 0.15 ? 'bullish' : score < -0.15 ? 'bearish' : 'neutral'

  return { score: parseFloat(score.toFixed(3)), bullishHits, bearishHits, label }
}

export function createNewsSentimentTools(provider: INewsProvider) {
  return {
    newsSentiment: tool({
      description: `Analyze sentiment of recent news for a symbol or topic.

Scans the news archive for articles matching the query and scores them using
keyword-based sentiment analysis. Returns aggregate sentiment (bullish/bearish/neutral),
individual article scores, and macro signal detection (Fed hawkish/dovish, geopolitical).

This is pattern-matching, not NLP — use it as a quick directional signal, not gospel.

Examples:
  newsSentiment({ query: "AAPL", lookback: "1d" })
  newsSentiment({ query: "Federal Reserve|interest rate", lookback: "2d" })
  newsSentiment({ query: "NVDA|Nvidia", lookback: "12h" })`,
      inputSchema: z.object({
        query: z.string().describe('Regex pattern to match in titles and content (e.g. "AAPL|Apple")'),
        lookback: z.string().optional().describe('Time range: "1h", "12h", "1d", "7d" (default: "1d")'),
        limit: z.number().int().positive().optional().describe('Max articles to analyze (default: 50)'),
      }),
      execute: async ({ query, lookback, limit }) => {
        const articles = await provider.getNewsV2({
          endTime: new Date(),
          lookback: lookback ?? '1d',
          limit: 500,
        })

        const regex = new RegExp(query, 'i')
        const matched = articles.filter(a => regex.test(a.title) || regex.test(a.content))

        if (matched.length === 0) {
          return { query, articlesFound: 0, message: 'No matching articles found.' }
        }

        const toAnalyze = matched.slice(-(limit ?? 50))

        // Score each article
        const scored = toAnalyze.map(a => {
          const fullText = `${a.title}\n${a.content}`
          const sentiment = scoreSentiment(fullText)
          return {
            title: a.title.slice(0, 120),
            time: a.time.toISOString(),
            source: a.metadata.source ?? 'unknown',
            ...sentiment,
          }
        })

        // Aggregate
        const totalScore = scored.reduce((sum, s) => sum + s.score, 0) / scored.length
        const bullishCount = scored.filter(s => s.label === 'bullish').length
        const bearishCount = scored.filter(s => s.label === 'bearish').length
        const neutralCount = scored.filter(s => s.label === 'neutral').length

        // Macro signals
        const allText = toAnalyze.map(a => `${a.title}\n${a.content}`).join('\n')
        const macroSignals: Record<string, number> = {}

        for (const [signal, patterns] of Object.entries(MACRO_PATTERNS)) {
          let hits = 0
          for (const pattern of patterns) {
            if (pattern.test(allText)) hits++
          }
          if (hits > 0) macroSignals[signal] = hits
        }

        // Top movers (strongest sentiment articles)
        const topBullish = scored
          .filter(s => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map(s => ({ title: s.title, source: s.source, score: s.score }))

        const topBearish = scored
          .filter(s => s.score < 0)
          .sort((a, b) => a.score - b.score)
          .slice(0, 3)
          .map(s => ({ title: s.title, source: s.source, score: s.score }))

        return {
          query,
          articlesAnalyzed: scored.length,
          aggregate: {
            score: parseFloat(totalScore.toFixed(3)),
            label: totalScore > 0.15 ? 'bullish' : totalScore < -0.15 ? 'bearish' : 'neutral',
            bullishCount,
            bearishCount,
            neutralCount,
          },
          ...(Object.keys(macroSignals).length > 0 ? { macroSignals } : {}),
          ...(topBullish.length > 0 ? { topBullish } : {}),
          ...(topBearish.length > 0 ? { topBearish } : {}),
        }
      },
    }),

    marketMood: tool({
      description: `Get a quick overall market sentiment snapshot from all recent news.

Unlike newsSentiment (which filters by query), this analyzes ALL recent articles
to give a broad market mood reading. Includes macro signal detection.

Use this at the start of a heartbeat to quickly gauge the market environment.`,
      inputSchema: z.object({
        lookback: z.string().optional().describe('Time range (default: "2h")'),
      }),
      execute: async ({ lookback }) => {
        const articles = await provider.getNewsV2({
          endTime: new Date(),
          lookback: lookback ?? '2h',
          limit: 200,
        })

        if (articles.length === 0) {
          return { articlesFound: 0, message: 'No recent articles in archive.' }
        }

        // Score all articles
        const scores = articles.map(a => {
          const fullText = `${a.title}\n${a.content}`
          return scoreSentiment(fullText)
        })

        const avgScore = scores.reduce((sum, s) => sum + s.score, 0) / scores.length
        const bullish = scores.filter(s => s.label === 'bullish').length
        const bearish = scores.filter(s => s.label === 'bearish').length
        const neutral = scores.filter(s => s.label === 'neutral').length

        // Macro signals
        const allText = articles.map(a => `${a.title}\n${a.content}`).join('\n')
        const macroSignals: Record<string, number> = {}

        for (const [signal, patterns] of Object.entries(MACRO_PATTERNS)) {
          let hits = 0
          for (const pattern of patterns) {
            if (pattern.test(allText)) hits++
          }
          if (hits > 0) macroSignals[signal] = hits
        }

        // Determine mood
        let mood: string
        if (avgScore > 0.3) mood = 'STRONGLY_BULLISH'
        else if (avgScore > 0.1) mood = 'BULLISH'
        else if (avgScore < -0.3) mood = 'STRONGLY_BEARISH'
        else if (avgScore < -0.1) mood = 'BEARISH'
        else mood = 'NEUTRAL'

        return {
          mood,
          score: parseFloat(avgScore.toFixed(3)),
          articlesAnalyzed: articles.length,
          breakdown: { bullish, bearish, neutral },
          ...(Object.keys(macroSignals).length > 0 ? { macroSignals } : {}),
        }
      },
    }),
  }
}
