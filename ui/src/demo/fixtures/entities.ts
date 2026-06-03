import type { EntityListItem, EntityDetail } from '../../api/entities'

/**
 * Demo tracked-entities — mirrors the real chat-jun3 power / AI-infra graph
 * so the marketing demo shows the actual shape: a few assets + the theme that
 * ties them together, each referenced across the dated rotation notes.
 */
export const demoEntities: EntityListItem[] = [
  {
    name: 'stock-vst',
    type: 'asset',
    description: 'Vistra — Texas independent power producer, a primary play on AI datacenter electricity demand.',
    createdAt: 1_717_300_000_000,
    backlinkCount: 3,
  },
  {
    name: 'stock-vrt',
    type: 'asset',
    description: 'Vertiv — datacenter power & liquid cooling; the cleanest "AI-infra electricity" expression.',
    createdAt: 1_717_250_000_000,
    backlinkCount: 2,
  },
  {
    name: 'ai-data-center-power',
    type: 'topic',
    description:
      'The through-line: AI datacenter electricity demand connecting power utilities, AI-infra, and electrical picks-and-shovels.',
    createdAt: 1_717_100_000_000,
    backlinkCount: 4,
  },
]

const ws = { workspaceId: 'demo-ws-1', workspaceTag: 'chat-jun3' }

export const demoEntityDetail: Record<string, EntityDetail> = {
  'stock-vst': {
    entity: demoEntities[0]!,
    backlinks: [
      { ...ws, path: 'power_buy_points_2026-06-02.md' },
      { ...ws, path: 'rotation/2026-06-02.md' },
      { ...ws, path: 'rotation/ai-chain-2026-06-02.md' },
    ],
  },
  'stock-vrt': {
    entity: demoEntities[1]!,
    backlinks: [
      { ...ws, path: 'rotation/ai-chain-2026-06-02.md' },
      { ...ws, path: 'rotation/missed-rightside-2026-06-02.md' },
    ],
  },
  'ai-data-center-power': {
    entity: demoEntities[2]!,
    backlinks: [
      { ...ws, path: 'power_buy_points_2026-06-02.md' },
      { ...ws, path: 'rotation/2026-06-02.md' },
      { ...ws, path: 'rotation/ai-chain-2026-06-02.md' },
      { ...ws, path: 'rotation/missed-rightside-2026-06-02.md' },
    ],
  },
}
