import type { InboxEntry, InboxOrigin } from '../../api/inbox'
import { DEMO_WORKSPACE_ID } from './workspaces'

export const DEMO_REPORT_PATH = 'research-AAPL-q1.md'

const FIVE_MIN_AGO = Date.now() - 5 * 60 * 1000
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const nowMs = Date.now()

export const demoInboxEntry: InboxEntry = {
  id: 'demo-inbox-aapl-q1',
  ts: FIVE_MIN_AGO,
  workspaceId: DEMO_WORKSPACE_ID,
  workspaceLabel: 'demo',
  docs: [{ path: DEMO_REPORT_PATH }],
  comments: [
    'I dug into Apple\'s Q1 earnings — see the report above.',
    '',
    '**Key finding:** services revenue growth has decelerated three quarters in a row, now at **+9.1%** YoY (was +14.2% last quarter). The headline EPS beat is masking the deceleration in what\'s historically been the margin defender.',
    '',
    'Want me to set up a watchlist alert on next quarter\'s services number?',
  ].join('\n'),
}

// ── Headless reports tied to scheduled issues ──
// These carry a server-stamped `origin` (kind:'headless' + runId + issueId +
// agent) — the agent-INVISIBLE provenance. It drives BOTH directions of the
// cross-link: each card renders an "originating issue/run" breadcrumb, and the
// matching issue detail lists them under "Inbox reports" (see fixtures/issues.ts
// `demoIssueDetail`, which filters by workspaceId + origin.issueId). The
// runId/issueId here MUST match real fixtures — runId ↔ a HeadlessTaskRecord
// taskId in demoIssueExtras, issueId ↔ a board issue id — so the link resolves
// on both surfaces.

/** Build the headless InboxOrigin the server would stamp for a scheduled-issue
 *  run. Agent-invisible: the agent never supplies any of this (it's injected at
 *  spawn, carried out-of-band, resolved server-side). */
function headlessOrigin(runId: string, issueId: string, agent: string): InboxOrigin {
  return { kind: 'headless', runId, issueId, agent }
}

// auto-quant › morning-scan, latest run (demo-run-morning-1, codex). Has a doc.
export const demoMoversReport: InboxEntry = {
  id: 'demo-inbox-morning-1',
  ts: nowMs - HOUR + 84_000,
  workspaceId: 'demo-ws-auto-quant',
  workspaceLabel: 'auto-quant',
  docs: [{ path: 'reports/movers-2026-06-27.md' }],
  comments: [
    'Morning scan is in — ranked digest above.',
    '',
    'Top of the list is **VST** (+7.4%, 3.1x RVOL) on the datacenter-power read; it touches the book. Full table in the report.',
  ].join('\n'),
  origin: headlessOrigin('demo-run-morning-1', 'morning-scan', 'codex'),
}

// macro-research › weekly-digest, latest run (demo-run-digest-1, codex). Has a doc.
export const demoDigestReport: InboxEntry = {
  id: 'demo-inbox-digest-1',
  ts: nowMs - 2 * DAY + 156_000,
  workspaceId: 'demo-ws-macro',
  workspaceLabel: 'macro-research',
  docs: [{ path: 'digests/macro-2026-06-25.md' }],
  comments:
    'Weekly macro digest is up — rates steepened, dollar soft, core PCE inline. Next week\'s calendar at the bottom.',
  origin: headlessOrigin('demo-run-digest-1', 'weekly-digest', 'codex'),
}

// auto-quant › morning-scan, an OLDER run (demo-run-morning-3, codex). Same issue
// as demoMoversReport → that issue's detail lists TWO inbox reports. Comments-only
// (no doc) to exercise the doc-less card.
export const demoMoversReportOlder: InboxEntry = {
  id: 'demo-inbox-morning-3',
  ts: nowMs - 2 * DAY + 79_000,
  workspaceId: 'demo-ws-auto-quant',
  workspaceLabel: 'auto-quant',
  comments: [
    'Earlier morning scan (two days ago) — quiet tape, nothing actionable touched the book.',
    '',
    'Logged for the record; no doc attached.',
  ].join('\n'),
  origin: headlessOrigin('demo-run-morning-3', 'morning-scan', 'codex'),
}

/** GET /api/inbox/history order — newest-first. `demoInboxEntry` (the AAPL
 *  research push) carries NO origin: the interactive/manual case, which renders
 *  without an originating-issue breadcrumb. */
export const demoInboxEntries: InboxEntry[] = [
  demoInboxEntry,
  demoMoversReport,
  demoDigestReport,
  demoMoversReportOlder,
]

// File contents served back to readWorkspaceFile() for demo workspace docs.
// Keyed by relative path.
export const demoWorkspaceFiles: Record<string, string> = {
  // Doc for demoMoversReport (auto-quant › morning-scan run).
  'reports/movers-2026-06-27.md': `# Pre-market movers — 2026-06-27

**Workspace:** auto-quant · **Run:** morning movers scan (scheduled)

Ranked by gap × relative volume. Bold = touches the book.

| # | Ticker | Gap | RVOL | Why | Book? |
|---|--------|------|------|-----|-------|
| 1 | **VST** | +7.4% | 3.1x | datacenter-power read-through; PPA headline | yes |
| 2 | NVDA | +3.2% | 1.8x | supplier guidance bump | no |
| 3 | VRT | +5.1% | 2.4x | cooling order flow | watch |

[[stock-vst]] is the cleanest [[ai-data-center-power]] expression in the list —
flagged for the [[Liquidity risk review]] sizing pass.
`,

  // Doc for demoDigestReport (macro-research › weekly-digest run).
  'digests/macro-2026-06-25.md': `# Weekly macro digest — week of 2026-06-23

**Workspace:** macro-research · **Run:** weekly digest (scheduled, Fri close)

1. **Rates** — UST 2s10s steepened 6bp; market nudged the first cut earlier.
2. **FX** — DXY -0.4%; JPY the standout on intervention chatter.
3. **Prints** — core PCE inline; jobless claims a touch soft.
4. **Next week** — ISM, payrolls, and the quarter-end refunding update.
`,

  [DEMO_REPORT_PATH]: `# AAPL Q1 — Hidden Deceleration Signal

**Workspace:** aapl-q1 · **Generated:** just now

## TL;DR

Headline Q1 EPS beat ($1.65 vs $1.50e), but the breakdown shows
**services revenue growth decelerating to +9.1% YoY** from +14.2% last
quarter. Third consecutive deceleration. **Recommendation:** trim long
exposure into the post-earnings pop; revisit after iPhone 17 launch
comps.

## What I looked at

- Q1 FY2026 10-Q (filed yesterday)
- Rolling services-segment breakdown across last four quarters
- iPhone unit run-rate vs analyst whisper numbers

## The number that doesn't line up

Headline EPS beat, but services growth — historically the margin
defender — has decelerated three quarters in a row:

| Quarter | Services Rev YoY | Operating Margin |
|---------|------------------|------------------|
| Q2 FY25 | +16.3% | 29.1% |
| Q3 FY25 | +14.2% | 29.7% |
| Q4 FY25 | +12.0% | 29.4% |
| **Q1 FY26** | **+9.1%** | **28.8%** |

If services growth keeps marching toward single digits, the multiple
re-rate that buy-side is pricing in (services as a SaaS-like recurring
moat) will need to recompute. Trim or hedge here.

## What I did NOT verify

- Forward iPhone 17 demand (need supply-chain data)
- App Store regulatory trajectory in EU / US
- China-channel inventory levels

## Next steps if you want them

1. Set a watch alert: services revenue YoY < **+8%** next quarter →
   reduce position by 50%.
2. Pair trade: long GOOGL / short AAPL on services-margin spread.
3. Wait for May 30 supply-chain reports before adding back.

---

*Generated by the agent in workspace \`demo\`. Reply in the workspace
to drill in or kick off the watchlist alert.*
`,

  // ── chat-jun3 power / AI-infra rotation notes ──
  // These back the Tracked entity backlinks (see fixtures/entities.ts) so
  // clicking a backlink opens a real file in the viewer, and the [[name]]
  // wikilinks jump back to the Tracked entities.
  'power_buy_points_2026-06-02.md': `# Power buy points — 2026-06-02

The whole basket trades off one thesis: [[ai-data-center-power]]. Sizing
notes below.

- **[[stock-vst]]** — add on pullback to the 50-DMA; it's the cleanest
  merchant-power read on datacenter load growth in ERCOT.
- Keep dry powder for [[stock-vrt]] if it retests the breakout shelf.

Right-side confirmation: relative volume > 1.5x on the up-days, OBV making
higher highs.
`,

  'rotation/2026-06-02.md': `# Rotation log — 2026-06-02

Money is rotating *into* [[ai-data-center-power]] names on the
electricity-demand narrative.

- [[stock-vst]] leading; utilities-with-a-growth-story bid.
- Watching whether the move broadens from generation into the electrical
  picks-and-shovels.
`,

  'rotation/ai-chain-2026-06-02.md': `# AI chain map — 2026-06-02

Tracing [[ai-data-center-power]] down the value chain:

1. **Generation** — [[stock-vst]] (merchant power, ERCOT exposure)
2. **Datacenter power & cooling** — [[stock-vrt]] (liquid cooling, PDUs)

The cleaner the "electricity" expression, the better it's held the
right side of this move.
`,

  'rotation/missed-rightside-2026-06-02.md': `# Missed right-side entries — 2026-06-02

Post-mortem on what we let run without us.

- [[stock-vrt]] — broke out 2026-05-21, never looked back. Waited for a
  pullback that didn't come. Lesson: on a [[ai-data-center-power]] leader,
  buy the first higher-low, not the deep retrace.
`,
}
