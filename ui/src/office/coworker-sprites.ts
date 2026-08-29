export type OfficeCoworkerArchetype = 'codex' | 'claude' | 'pi' | 'opencode' | 'grok'
export type OfficeCoworkerIdentity =
  | Exclude<OfficeCoworkerArchetype, 'grok'>
  | 'codex-mechanic'
  | 'codex-scout'
  | 'claude-botanist'
  | 'pi-mathematician'
  | 'opencode-hacker'
  | 'opencode-analyst'
  | 'grok-oracle'
  | 'grok-engineer'
  | 'grok-analyst'
  | 'grok-researcher'
  | 'grok-architect'

export interface OfficeCoworkerSpriteAsset {
  id: OfficeCoworkerIdentity
  portraitSrc: string
  deskSrc: string
  deskWorkSrc: string
  typingPhaseMs: number
  accent: string
}

function coworkerAsset(
  id: OfficeCoworkerIdentity,
  accent: string,
  typingPhaseMs: number,
): OfficeCoworkerSpriteAsset {
  return {
    id,
    portraitSrc: `/office/coworkers/${id}-portrait-v2.png`,
    deskSrc: `/office/coworkers/${id}-desk-v1.png`,
    deskWorkSrc: `/office/coworkers/${id}-desk-work-v1.png`,
    typingPhaseMs,
    accent,
  }
}

export const OFFICE_COWORKER_SPRITES: Record<OfficeCoworkerIdentity, OfficeCoworkerSpriteAsset> = {
  codex: coworkerAsset('codex', 'var(--terminal-yellow)', 0),
  'codex-mechanic': coworkerAsset('codex-mechanic', 'var(--terminal-yellow)', -110),
  'codex-scout': coworkerAsset('codex-scout', 'var(--terminal-yellow)', -230),
  claude: coworkerAsset('claude', 'var(--terminal-red)', -170),
  'claude-botanist': coworkerAsset('claude-botanist', 'var(--terminal-red)', -290),
  pi: coworkerAsset('pi', 'var(--terminal-cyan)', -310),
  'pi-mathematician': coworkerAsset('pi-mathematician', 'var(--terminal-cyan)', -410),
  opencode: coworkerAsset('opencode', 'var(--terminal-magenta)', -470),
  'opencode-hacker': coworkerAsset('opencode-hacker', 'var(--terminal-magenta)', -570),
  'opencode-analyst': coworkerAsset('opencode-analyst', 'var(--terminal-magenta)', -670),
  'grok-oracle': coworkerAsset('grok-oracle', 'var(--terminal-cyan)', -730),
  'grok-engineer': coworkerAsset('grok-engineer', 'var(--terminal-cyan)', -790),
  'grok-analyst': coworkerAsset('grok-analyst', 'var(--terminal-cyan)', -850),
  'grok-researcher': coworkerAsset('grok-researcher', 'var(--terminal-cyan)', -910),
  'grok-architect': coworkerAsset('grok-architect', 'var(--terminal-cyan)', -970),
}

export const OFFICE_COWORKER_EMOTES = {
  waiting: '/office/coworkers/waiting-emote-v1.png',
  failed: '/office/coworkers/failed-emote-v1.png',
} as const

const AGENT_ARCHETYPE: Record<string, OfficeCoworkerArchetype> = {
  codex: 'codex',
  cursor: 'codex',
  'cursor-agent': 'codex',
  agy: 'codex',
  grok: 'grok',
  claude: 'claude',
  pi: 'pi',
  opencode: 'opencode',
  omp: 'opencode',
}

const ARCHETYPE_POOL: Record<OfficeCoworkerArchetype, readonly OfficeCoworkerIdentity[]> = {
  codex: ['codex-mechanic', 'codex-scout', 'codex'],
  claude: ['claude-botanist', 'claude'],
  pi: ['pi-mathematician', 'pi'],
  opencode: ['opencode-hacker', 'opencode-analyst', 'opencode'],
  grok: ['grok-oracle', 'grok-engineer', 'grok-analyst', 'grok-researcher', 'grok-architect'],
}

const ARCHETYPE_DEFAULT: Record<OfficeCoworkerArchetype, OfficeCoworkerIdentity> = {
  codex: 'codex',
  claude: 'claude',
  pi: 'pi',
  opencode: 'opencode',
  grok: 'grok-oracle',
}

function stableCoworkerHash(value: string): number {
  return Array.from(value).reduce((hash, character) => (
    (hash * 31 + character.charCodeAt(0)) >>> 0
  ), 0)
}

function stableGrokCoworkerHash(value: string): number {
  return Array.from(value).reduce((hash, character) => {
    const mixed = hash ^ character.charCodeAt(0)
    return Math.imul(mixed, 16_777_619) >>> 0
  }, 2_166_136_261)
}

function archetypeForAgent(agent: string): OfficeCoworkerArchetype {
  const normalized = agent.trim().toLowerCase()
  const mapped = AGENT_ARCHETYPE[normalized]
  if (mapped) return mapped
  const archetypes = Object.keys(ARCHETYPE_POOL) as OfficeCoworkerArchetype[]
  return archetypes[stableCoworkerHash(normalized) % archetypes.length] ?? 'codex'
}

export function officeCoworkerSpriteForAgent(
  agent: string,
  identity = '',
): OfficeCoworkerSpriteAsset {
  const archetype = archetypeForAgent(agent)
  if (!identity) return OFFICE_COWORKER_SPRITES[ARCHETYPE_DEFAULT[archetype]]
  const pool = ARCHETYPE_POOL[archetype]
  const hashInput = `${agent.trim().toLowerCase()}:${identity}`
  const hash = archetype === 'grok'
    ? stableGrokCoworkerHash(hashInput)
    : stableCoworkerHash(hashInput)
  const selected = pool[hash % pool.length]
  return OFFICE_COWORKER_SPRITES[selected ?? ARCHETYPE_DEFAULT[archetype]]
}
