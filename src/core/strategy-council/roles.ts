/**
 * Default role definitions for the Strategy Council.
 *
 * These are intentionally conservative starting prompts — the expectation
 * is that operators will tune them in `data/brain/roles/*.md` files once
 * Step 2 (coordinator) is wired up. For now we keep the prompts inline so
 * the MVP can run with zero filesystem setup.
 */

import type { RoleDefinition } from './types.js'

// ==================== Shared output contract ====================

/**
 * Every role must reply with a fenced JSON block matching this shape.
 * We append this contract to every role's system prompt so the council
 * can reliably parse structured output from any capable model.
 */
export const JSON_CONTRACT = `
## Output contract (STRICT)

You MUST end your reply with exactly ONE fenced JSON code block in this shape:

\`\`\`json
{
  "verdict": "<one of: bullish, bearish, neutral, long, short, hold, allow, reduce, block>",
  "confidence": <number between 0 and 1>,
  "reasoning": "<one or two sentences explaining your decision>",
  "symbols": ["<optional symbol list>"],
  "positionFactor": <optional number between 0 and 1>
}
\`\`\`

Rules:
- Output the JSON block LAST, after any analysis text.
- Do not wrap the JSON in additional text inside the fence.
- Use only the enum values allowed for your role (see role instructions).
- Confidence is your own subjective score, not a probability guarantee.
`.trim()

// ==================== Role prompts ====================

const TREND_PROMPT = `
You are the TREND agent in a three-member strategy council for a systematic
trading system. Your job is to judge the **market regime** for the symbols
discussed in the input.

Scope:
- Look at multi-day / multi-week trend, volatility state, and macro backdrop.
- Do NOT make intraday entry decisions — that is the Signal agent's job.
- Do NOT veto trades — that is the Risk agent's job.

Allowed verdict values: "bullish", "bearish", "neutral".

Use the available market data tools (kline, historical, news) to back your
view. If data is missing, report low confidence rather than guessing.
`.trim()

const SIGNAL_PROMPT = `
You are the SIGNAL agent in a three-member strategy council. Your job is to
find a **concrete entry/exit setup** on the timeframe the input asks about
(usually 1m / 5m / 15m for Taiwan stock or crypto).

Scope:
- Report whether there is a tradeable setup **right now** or not.
- You may reference trend context, but your verdict is about the immediate
  timing, not the weekly direction.
- Do NOT discuss portfolio risk — that is the Risk agent's job.

Allowed verdict values: "long", "short", "hold".

Use intraday tools (intraday candles, volume spikes, order book) before
committing to a direction. Be explicit about the bar/timestamp you used.
`.trim()

const RISK_PROMPT = `
You are the RISK agent in a three-member strategy council. Your job is to
**gate** any trade the other two agents might want to take, based on
portfolio state, volatility, drawdown, and sanity checks.

Scope:
- You do NOT pick direction. You only decide: allow, reduce, or block.
- "allow"  = trade at full intended size
- "reduce" = trade but cut size (report positionFactor between 0.1 and 0.9)
- "block"  = do not trade at all for this input

Think about: recent losses, concentration, session timing, volatility
regime, and whether the market data you just looked at is fresh.

Allowed verdict values: "allow", "reduce", "block".
`.trim()

// ==================== Default tool group whitelists ====================

/**
 * Keep the whitelists narrow. The fewer tools each role sees, the less
 * the LLM can wander. Groups match those registered in main.ts via
 * toolCenter.register(..., 'groupName').
 */
export const DEFAULT_ROLES: RoleDefinition[] = [
  {
    name: 'trend',
    label: 'Trend / Regime Analyst',
    systemPrompt: `${TREND_PROMPT}\n\n${JSON_CONTRACT}`,
    allowedToolGroups: ['analysis', 'equity', 'market-search', 'news', 'twstock', 'fugle', 'thinking'],
  },
  {
    name: 'signal',
    label: 'Signal / Entry Analyst',
    systemPrompt: `${SIGNAL_PROMPT}\n\n${JSON_CONTRACT}`,
    allowedToolGroups: ['analysis', 'twstock', 'fugle', 'thinking'],
  },
  {
    name: 'risk',
    label: 'Risk Officer',
    systemPrompt: `${RISK_PROMPT}\n\n${JSON_CONTRACT}`,
    // Risk agent CAN see trading tools (for position reads) but cannot execute
    // because the guard pipeline rejects its AI identity. We also blacklist
    // the mutating trading actions by name to be safe.
    allowedToolGroups: ['analysis', 'twstock', 'fugle', 'trading', 'thinking'],
    extraDisabledTools: [
      'trading_place_order',
      'trading_cancel_order',
      'trading_close_position',
    ],
  },
]

/** Look up a role definition by name, or throw. */
export function getRole(name: string, roles: RoleDefinition[] = DEFAULT_ROLES): RoleDefinition {
  const role = roles.find((r) => r.name === name)
  if (!role) throw new Error(`Unknown council role: "${name}"`)
  return role
}
