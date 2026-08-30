export type OfficeCoworkerArchetype = 'codex' | 'claude' | 'pi' | 'opencode'

export interface OfficeCoworkerSpriteAsset {
  id: OfficeCoworkerArchetype
  src: string
  accent: string
}

export const OFFICE_COWORKER_SPRITES: Record<OfficeCoworkerArchetype, OfficeCoworkerSpriteAsset> = {
  codex: {
    id: 'codex',
    src: '/office/coworkers/codex-v1.webp',
    accent: 'var(--terminal-yellow)',
  },
  claude: {
    id: 'claude',
    src: '/office/coworkers/claude-v1.webp',
    accent: 'var(--terminal-red)',
  },
  pi: {
    id: 'pi',
    src: '/office/coworkers/pi-v1.webp',
    accent: 'var(--terminal-cyan)',
  },
  opencode: {
    id: 'opencode',
    src: '/office/coworkers/opencode-v1.webp',
    accent: 'var(--terminal-magenta)',
  },
}

const AGENT_ARCHETYPE: Record<string, OfficeCoworkerArchetype> = {
  codex: 'codex',
  cursor: 'codex',
  'cursor-agent': 'codex',
  agy: 'codex',
  grok: 'codex',
  claude: 'claude',
  pi: 'pi',
  opencode: 'opencode',
  omp: 'opencode',
}

export function officeCoworkerSpriteForAgent(agent: string): OfficeCoworkerSpriteAsset {
  const normalized = agent.trim().toLowerCase()
  const mapped = AGENT_ARCHETYPE[normalized]
  if (mapped) return OFFICE_COWORKER_SPRITES[mapped]

  const archetypes = Object.keys(OFFICE_COWORKER_SPRITES) as OfficeCoworkerArchetype[]
  const hash = Array.from(normalized).reduce((value, character) => (
    (value * 31 + character.charCodeAt(0)) >>> 0
  ), 0)
  return OFFICE_COWORKER_SPRITES[archetypes[hash % archetypes.length] ?? 'codex']
}
