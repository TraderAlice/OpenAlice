import type { EntityListItem, EntityDetail } from '../../api/entities'

/**
 * Demo tracked-entities — mirrors the real chat-jun3 power / AI-infra graph
 * so the marketing demo shows the actual shape: a few assets + the theme that
 * ties them together, each referenced across the dated rotation notes.
 *
 * Backlinks now also include ISSUE NOTES. Since `.alice/issues/<id>.md` bodies
 * feed the same `[[name]]` reverse index, an entity's backlinks can point at an
 * issue note (path prefixed `.alice/issues/`). The Tracked UI detects that
 * prefix and routes the backlink to the issue detail (`/issues/:wsId/:id`)
 * instead of a raw file path — so `backlinkCount` here counts note files AND
 * issue notes. The demo issue bodies in ./issues.ts author the matching
 * `[[stock-vst]]` / `[[ai-data-center-power]]` tokens.
 */
export const demoEntities: EntityListItem[] = [
  {
    name: 'stock-vst',
    type: 'asset',
    description: 'Vistra — Texas independent power producer, a primary play on AI datacenter electricity demand.',
    createdAt: 1_717_300_000_000,
    backlinkCount: 4,
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
    backlinkCount: 6,
  },
]

const ws = { workspaceId: 'demo-ws-1', workspaceTag: 'chat-jun3' }
// Workspaces that own the demo issues (see ./issues.ts). Issue-note backlinks
// carry the issue's wsId + a `.alice/issues/<id>.md` path so the Tracked UI can
// route them to the issue detail rather than rendering a raw file path.
const autoQuantWs = { workspaceId: 'demo-ws-auto-quant', workspaceTag: 'auto-quant' }
const macroWs = { workspaceId: 'demo-ws-macro', workspaceTag: 'macro-research' }

export const demoEntityDetail: Record<string, EntityDetail> = {
  'stock-vst': {
    entity: demoEntities[0]!,
    backlinks: [
      { ...ws, path: 'power_buy_points_2026-06-02.md' },
      { ...ws, path: 'rotation/2026-06-02.md' },
      { ...ws, path: 'rotation/ai-chain-2026-06-02.md' },
      // Issue note — [[stock-vst]] authored in the Morning movers scan body.
      { ...autoQuantWs, path: '.alice/issues/morning-scan.md' },
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
      // Issue notes — [[ai-data-center-power]] authored in two issue bodies, one
      // per workspace (both route to their own /issues/:wsId/:id detail).
      { ...autoQuantWs, path: '.alice/issues/morning-scan.md' },
      { ...macroWs, path: '.alice/issues/liquidity-risk-review.md' },
    ],
  },
}
