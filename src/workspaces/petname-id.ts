import { randomInt as cryptoRandomInt } from 'node:crypto'

/**
 * Human-readable random ids for launcher-owned objects.
 *
 * These ids are meant to appear in URLs, logs, Inbox origins, CLI headers, and
 * agent-visible environment without making humans or agents repeat UUID noise.
 * The word lists are intentionally neutral: no finance, direction, risk, mood,
 * or execution words that could bleed into trading context.
 */

const MAX_ATTEMPTS = 128
const PREFIX_MAX = 24
const DEFAULT_FALLBACK_PREFIX = 'item'

const ADJECTIVES = [
  'calm',
  'clear',
  'quiet',
  'gentle',
  'steady',
  'bright',
  'soft',
  'fresh',
  'plain',
  'warm',
  'cool',
  'mild',
  'light',
  'smooth',
  'open',
  'still',
  'even',
  'tidy',
  'simple',
  'brisk',
  'lucid',
  'patient',
  'modest',
  'neat',
  'solid',
  'crisp',
  'sunny',
  'level',
  'polished',
  'rounded',
  'nimble',
  'stable',
] as const

const MATERIALS = [
  'amber',
  'copper',
  'silver',
  'pearl',
  'marble',
  'quartz',
  'cedar',
  'maple',
  'willow',
  'linen',
  'cotton',
  'paper',
  'glass',
  'stone',
  'granite',
  'slate',
  'violet',
  'indigo',
  'olive',
  'ivory',
  'coral',
  'saffron',
  'mint',
  'juniper',
  'laurel',
  'bamboo',
  'canvas',
  'clay',
  'walnut',
  'birch',
  'brass',
  'opal',
] as const

const PLACES = [
  'river',
  'harbor',
  'meadow',
  'lantern',
  'compass',
  'bridge',
  'garden',
  'valley',
  'field',
  'cloud',
  'rain',
  'orbit',
  'notebook',
  'pencil',
  'window',
  'studio',
  'courtyard',
  'terrace',
  'path',
  'grove',
  'spring',
  'brook',
  'summit',
  'cove',
  'ridge',
  'plaza',
  'porch',
  'tide',
  'dawn',
  'horizon',
  'arch',
  'marker',
] as const

export type RandomInt = (exclusiveMax: number) => number

export interface PetnameOptions {
  readonly fallbackPrefix?: string
  readonly isTaken?: (id: string) => boolean
  readonly maxAttempts?: number
  readonly randomInt?: RandomInt
}

export function normalizeIdPrefix(input: string, fallback = DEFAULT_FALLBACK_PREFIX): string {
  const normalized = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PREFIX_MAX)
    .replace(/-+$/g, '')
  return normalized || fallback
}

export function generatePetnameId(prefix: string, opts: PetnameOptions = {}): string {
  const randomInt = opts.randomInt ?? cryptoRandomInt
  const isTaken = opts.isTaken ?? (() => false)
  const attempts = opts.maxAttempts ?? MAX_ATTEMPTS
  const safePrefix = normalizeIdPrefix(prefix, opts.fallbackPrefix)

  for (let i = 0; i < attempts; i += 1) {
    const id = [
      safePrefix,
      pick(ADJECTIVES, randomInt),
      pick(MATERIALS, randomInt),
      pick(PLACES, randomInt),
    ].join('-')
    if (!isTaken(id)) return id
  }

  // Extremely unlikely unless the candidate space is exhausted or tests force
  // collisions. Keep the fallback readable enough while guaranteeing progress.
  for (let i = 0; i < attempts; i += 1) {
    const id = [
      safePrefix,
      pick(ADJECTIVES, randomInt),
      pick(MATERIALS, randomInt),
      pick(PLACES, randomInt),
      randomInt(10_000).toString().padStart(4, '0'),
    ].join('-')
    if (!isTaken(id)) return id
  }

  throw new Error(`could not allocate a petname id for prefix "${safePrefix}"`)
}

function pick<T>(items: readonly T[], randomInt: RandomInt): T {
  return items[randomInt(items.length)]!
}
