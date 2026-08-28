export type OfficeCoworkerArchetype = 'codex' | 'claude' | 'pi' | 'opencode'

export interface OfficeCoworkerSpriteAsset {
  id: OfficeCoworkerArchetype
  portraitSrc: string
  deskSrc: string
  accent: string
}

export const OFFICE_COWORKER_SPRITES: Record<OfficeCoworkerArchetype, OfficeCoworkerSpriteAsset> = {
  codex: {
    id: 'codex',
    portraitSrc: '/office/coworkers/codex-v1.webp',
    deskSrc: '/office/coworkers/codex-desk-v1.png',
    accent: 'var(--terminal-yellow)',
  },
  claude: {
    id: 'claude',
    portraitSrc: '/office/coworkers/claude-v1.webp',
    deskSrc: '/office/coworkers/claude-desk-v1.png',
    accent: 'var(--terminal-red)',
  },
  pi: {
    id: 'pi',
    portraitSrc: '/office/coworkers/pi-v1.webp',
    deskSrc: '/office/coworkers/pi-desk-v1.png',
    accent: 'var(--terminal-cyan)',
  },
  opencode: {
    id: 'opencode',
    portraitSrc: '/office/coworkers/opencode-v1.webp',
    deskSrc: '/office/coworkers/opencode-desk-v1.png',
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
