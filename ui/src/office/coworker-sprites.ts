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
  | 'grok-navigator'
  | 'grok-synthesist'
  | 'grok-sentinel'

export interface OfficeCoworkerSpriteAsset {
  id: OfficeCoworkerIdentity
  portraitSrc: string
  deskSrc: string
  deskWorkSrc: string
  typingPhaseMs: number
  accent: string
}

export interface OfficeCoworkerCastMember {
  agent: string
  resumeId: string
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
  'grok-navigator': coworkerAsset('grok-navigator', 'var(--terminal-cyan)', -1_030),
  'grok-synthesist': coworkerAsset('grok-synthesist', 'var(--terminal-cyan)', -1_090),
  'grok-sentinel': coworkerAsset('grok-sentinel', 'var(--terminal-cyan)', -1_150),
}

export const OFFICE_COWORKER_EMOTES = {
  working: '/office/hud/talk-bubble-v2.png',
  sleeping: '/office/coworkers/sleep-emote-v1.png',
  waiting: '/office/coworkers/waiting-emote-v1.png',
  failed: '/office/coworkers/failed-emote-v1.png',
  review: '/office/coworkers/review-emote-v1.png',
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
  grok: [
    'grok-oracle',
    'grok-engineer',
    'grok-analyst',
    'grok-researcher',
    'grok-architect',
    'grok-navigator',
    'grok-synthesist',
    'grok-sentinel',
  ],
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

/**
 * Cast one Workspace as a party instead of hashing every member in isolation.
 * Each runtime family exhausts its authored pool before a silhouette repeats;
 * input order and live mood changes cannot reshuffle the cast.
 */
export function officeCoworkerCast(
  members: readonly OfficeCoworkerCastMember[],
  retainedCast: ReadonlyMap<string, OfficeCoworkerSpriteAsset> = new Map(),
): ReadonlyMap<string, OfficeCoworkerSpriteAsset> {
  const cast = new Map<string, OfficeCoworkerSpriteAsset>()
  const families = new Map<OfficeCoworkerArchetype, OfficeCoworkerCastMember[]>()
  for (const member of members) {
    const archetype = archetypeForAgent(member.agent)
    const family = families.get(archetype) ?? []
    family.push(member)
    families.set(archetype, family)
  }

  for (const [archetype, family] of families) {
    const pool = ARCHETYPE_POOL[archetype]
    const pending: OfficeCoworkerCastMember[] = []
    const claimed = new Set<number>()
    for (const retained of retainedCast.values()) {
      const retainedIndex = pool.indexOf(retained.id)
      if (retainedIndex >= 0) claimed.add(retainedIndex)
    }
    for (const member of family) {
      const retained = retainedCast.get(member.resumeId)
      const retainedIndex = retained ? pool.indexOf(retained.id) : -1
      if (!retained || retainedIndex < 0) {
        pending.push(member)
        continue
      }
      cast.set(member.resumeId, retained)
      claimed.add(retainedIndex)
    }
    const ordered = pending.sort((a, b) => {
      const aHash = stableCoworkerHash(`${archetype}:${a.resumeId}`)
      const bHash = stableCoworkerHash(`${archetype}:${b.resumeId}`)
      return aHash - bHash || a.resumeId.localeCompare(b.resumeId)
    })
    for (const member of ordered) {
      const preferredAsset = officeCoworkerSpriteForAgent(member.agent, member.resumeId)
      const preferredIndex = Math.max(0, pool.indexOf(preferredAsset.id))
      let selectedIndex = preferredIndex
      if (claimed.size < pool.length) {
        while (claimed.has(selectedIndex)) selectedIndex = (selectedIndex + 1) % pool.length
        claimed.add(selectedIndex)
      }
      const selected = pool[selectedIndex] ?? ARCHETYPE_DEFAULT[archetype]
      cast.set(member.resumeId, OFFICE_COWORKER_SPRITES[selected])
    }
  }
  return cast
}
