import type {
  IssueComment,
  IssueDetail,
  IssuePatch,
  IssueRunRecord,
  IssueSnapshot,
} from '../../api/issues'
import { demoInboxEntries } from './inbox'

// GET /api/issues aggregates every workspace's declared issues by SCANNING
// each workspace's `.alice/issues/<id>.md` dir (one markdown file per issue) —
// it is not a central store. The board list omits the markdown body (Phase 2
// detail view loads it). Scheduled issues (those carrying `when`) also surface
// on /api/schedule; the two demo fixtures intentionally share ids
// (morning-scan / thesis-watch / weekly-digest) so the surfaces stay coherent.
//
// Coverage exercised by these fixtures: 2 workspaces; all five `status` values
// (backlog/todo/in_progress/done/canceled); all five `priority` values
// (urgent/high/medium/low/none); all four assignee shapes (workspace / session /
// human / unassigned); all three `when` kinds (cron/every/at) plus unscheduled work
// items (no `when`, no lastFired/nextDue).
//
// Also exercised: a CROSS-WORKSPACE NAME COLLISION. Both workspaces declare an
// issue titled "Liquidity risk review" (same title, distinct wsId) — so each row
// carries `nameCollision: true` and the snapshot's `duplicateNames` lists the
// clashing title. This drives the board's duplicate-name warning, and the
// `[[Liquidity risk review]]` token in an issue body resolves to BOTH issues via
// /api/wikilink/resolve (the disambiguation-picker case). Names are global team
// objects in the `[[]]` graph; collisions are surfaced, never linted away.

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const now = Date.now()

export const demoIssuesSnapshot: IssueSnapshot = {
  workspaces: [
    {
      wsId: 'demo-ws-auto-quant',
      tag: 'auto-quant',
      status: 'ok',
      issues: [
        // Scheduled (cron) + actively running.
        {
          id: 'morning-scan',
          title: 'Morning movers scan',
          status: 'in_progress',
          priority: 'high',
          assignee: '@workspace',
          agent: 'codex',
          when: { kind: 'cron', cron: '30 8 * * 1-5', timezone: 'America/New_York' },
          lastFiredAtMs: now - HOUR,
          nextDueAtMs: now + 16 * HOUR,
          automationHealth: { state: 'running', message: 'A scheduled run is in progress.', latestTaskId: 'demo-run-morning-1' },
        },
        // Scheduled (every) + urgent.
        {
          id: 'thesis-watch',
          title: 'Thesis invalidation watch',
          status: 'todo',
          priority: 'urgent',
          assignee: '@resume-demo-thesis-owner',
          when: { kind: 'every', every: '1h' },
          lastFiredAtMs: now - HOUR / 2,
          nextDueAtMs: now + HOUR / 2,
          automationHealth: {
            state: 'interrupted',
            message: 'The 30m watchdog ran 14m late. The computer likely slept or OpenAlice was paused; this run was not automatically retried.',
            latestTaskId: 'demo-run-thesis-1',
          },
        },
        // Pure work item — no `when`, scanner ignores it, board still shows it.
        {
          id: 'rebalance-sizing-review',
          title: 'Rebalance sizing logic needs a human review',
          status: 'todo',
          priority: 'medium',
          assignee: '@human',
        },
        // Backlog, unassigned, unscheduled.
        {
          id: 'prune-stale-signals',
          title: 'Prune stale signal cache entries',
          status: 'backlog',
          priority: 'low',
          assignee: '@unassigned',
        },
        // Cross-workspace name collision (also declared in demo-ws-macro under
        // the same title). nameCollision flags the board warning; the two share a
        // title but NOT a wsId, so access stays wsId-precise.
        {
          id: 'liquidity-risk-review',
          title: 'Liquidity risk review',
          status: 'todo',
          priority: 'high',
          assignee: '@workspace',
          nameCollision: true,
        },
      ],
    },
    {
      wsId: 'demo-ws-macro',
      tag: 'macro-research',
      status: 'ok',
      issues: [
        // Scheduled (cron) weekly digest.
        {
          id: 'weekly-digest',
          title: 'Weekly macro digest',
          status: 'in_progress',
          priority: 'medium',
          assignee: '@workspace',
          agent: 'codex',
          when: { kind: 'cron', cron: '0 16 * * 5', timezone: 'local' },
          lastFiredAtMs: now - 2 * DAY,
          nextDueAtMs: now + 5 * DAY,
          automationHealth: { state: 'healthy', message: 'Latest scheduled run completed.', latestTaskId: 'demo-run-weekly-1' },
        },
        // Scheduled (at) one-shot — never fired yet.
        {
          id: 'cpi-release-note',
          title: 'Write the CPI release reaction note',
          status: 'todo',
          priority: 'high',
          assignee: '@resume-demo-cpi-owner',
          when: { kind: 'at', at: new Date(now + 3 * DAY).toISOString() },
          lastFiredAtMs: null,
          nextDueAtMs: now + 3 * DAY,
          automationHealth: { state: 'blocked', message: 'Assigned Session does not exist. Choose an active Session or @workspace.' },
        },
        // Completed work item.
        {
          id: 'fed-speaker-calendar',
          title: 'Summarize the upcoming Fed speaker calendar',
          status: 'done',
          priority: 'none',
          assignee: '@human',
        },
        // Canceled work item.
        {
          id: 'cross-asset-correlation',
          title: 'Cross-asset correlation study',
          status: 'canceled',
          priority: 'low',
          assignee: '@unassigned',
        },
        // Cross-workspace name collision (the other half of the auto-quant
        // "Liquidity risk review"). Same title, different wsId / status / owner.
        {
          id: 'liquidity-risk-review',
          title: 'Liquidity risk review',
          status: 'backlog',
          priority: 'medium',
          assignee: '@human',
          nameCollision: true,
        },
      ],
    },
  ],
  // The titles claimed by more than one workspace (first-seen casing). Drives the
  // board's "also in N workspaces" warning; mirrors the server's annotateNameCollisions.
  duplicateNames: ['Liquidity risk review'],
}

// ==================== Detail (Phase 2a) ====================
// GET /api/issues/:wsId/:id returns the read-only IssueDetail: one issue's full
// fields INCLUDING the markdown body + scheduling frontmatter (what/agent), plus
// that issue's headless run history (its Activity feed). The board list omits
// both. The detail issue's display fields are derived from the board snapshot
// above (single source of truth), so the two surfaces never drift; the extras
// below supply only what the list doesn't carry.
//
// `runs` are HeadlessTaskRecord-shaped exactly as GET /api/headless returns —
// already filtered to this issue (wsId + issueId match) and newest-first, as the
// real endpoint does. Coverage: all four run statuses (done / running / failed /
// interrupted), a never-fired scheduled issue (empty feed), and unscheduled work
// items (no runs — issueId is only recorded on scheduled fires).

interface IssueDetailExtras {
  /** Markdown body the list view drops; rendered in the detail main column. */
  body: string
  /** Scheduling frontmatter `what` (fire-prompt override), if set. */
  what?: string
  /** Scheduling frontmatter `agent` (adapter id), if set. */
  agent?: string
  /** This issue's headless runs, newest-first (Activity feed). */
  runs: IssueRunRecord[]
}

// Keyed by `${wsId}/${id}`. Issues absent here fall back to a generic body + no
// runs (see demoIssueDetail) so every board row opens cleanly in the demo.
const demoIssueExtras: Record<string, IssueDetailExtras> = {
  'demo-ws-auto-quant/morning-scan': {
    body: [
      'Scan the pre-market movers and surface anything the book should react to before the open.',
      '',
      '## What to look for',
      '',
      '- Gap-ups / gap-downs **> 5%** on above-average volume',
      '- Names with overnight news (earnings, guidance, M&A)',
      '- Anything touching an open position or a watchlist thesis',
      '',
      '## Output',
      '',
      'Push a short ranked list to the Inbox — ticker, gap %, the one-line why, and whether it touches the book.',
      '',
      '## Related',
      '',
      // Wikilinks across BOTH namespaces — exercises the issue-detail resolver:
      //  • [[stock-vst]] / [[ai-data-center-power]] → tracked ENTITIES (unique).
      //  • [[Thesis invalidation watch]] → a sibling ISSUE by title (unique).
      //  • [[Liquidity risk review]] → COLLISION: matches an issue in two
      //    workspaces, so the resolver returns >1 candidate and the UI shows a
      //    workspace picker.
      '- Movers cluster under the [[ai-data-center-power]] theme; the primary expression is [[stock-vst]].',
      '- Coordinated with [[Thesis invalidation watch]].',
      '- Sizing for any new names feeds the [[Liquidity risk review]] (heads-up: that title is used in two workspaces — pick the right one).',
    ].join('\n'),
    what: 'Run the morning movers scan and push a ranked Inbox digest.',
    agent: 'codex',
    runs: [
      {
        taskId: 'demo-run-morning-1',
        resumeId: 'demo-resume-morning-1',
        resumable: true,
        wsId: 'demo-ws-auto-quant',
        agent: 'codex',
        prompt: 'Run the morning movers scan and push a ranked Inbox digest.',
        status: 'done',
        startedAt: now - HOUR,
        finishedAt: now - HOUR + 84_000,
        durationMs: 84_000,
        exitCode: 0,
        output: {
          hasAssistantReply: true,
          assistantPreview: 'Morning scan complete: three actionable gaps, led by the semiconductor cluster.',
          blockCount: 7,
          toolCalls: 3,
          toolFailures: 0,
        },
      },
      {
        taskId: 'demo-run-morning-2',
        resumeId: 'demo-resume-morning-2',
        resumable: false,
        wsId: 'demo-ws-auto-quant',
        agent: 'codex',
        prompt: 'Run the morning movers scan and push a ranked Inbox digest.',
        status: 'failed',
        startedAt: now - DAY,
        finishedAt: now - DAY + 12_000,
        durationMs: 12_000,
        exitCode: 1,
        error: 'market-data provider timed out (OpenBB upstream 504)',
        output: {
          hasAssistantReply: false,
          blockCount: 2,
          toolCalls: 1,
          toolFailures: 1,
        },
      },
      {
        taskId: 'demo-run-morning-3',
        resumeId: 'demo-resume-morning-3',
        resumable: true,
        wsId: 'demo-ws-auto-quant',
        agent: 'codex',
        prompt: 'Run the morning movers scan and push a ranked Inbox digest.',
        status: 'done',
        startedAt: now - 2 * DAY,
        finishedAt: now - 2 * DAY + 79_000,
        durationMs: 79_000,
        exitCode: 0,
      },
    ],
  },
  'demo-ws-auto-quant/thesis-watch': {
    body: [
      'Watch the active theses for invalidation and ping the desk the moment one breaks.',
      '',
      'Each thesis lives in `theses/*.md` with an explicit invalidation level. This run',
      're-checks every one against the latest quote and flags breaches.',
    ].join('\n'),
    agent: 'claude',
    runs: [
      {
        taskId: 'demo-run-thesis-1',
        resumeId: 'demo-resume-thesis-1',
        resumable: false,
        wsId: 'demo-ws-auto-quant',
        agent: 'claude',
        prompt: 'Re-check every active thesis against the latest quotes; flag invalidations.',
        startedAt: now - 44 * 60_000,
        finishedAt: now,
        durationMs: 44 * 60_000,
        killed: true,
        signal: 'SIGKILL',
        status: 'failed',
        failure: {
          kind: 'system_paused',
          title: 'Computer or launcher was paused',
          message: 'The 30m watchdog ran 14m late. The computer likely slept or OpenAlice was paused; this run was not automatically retried.',
          retryable: true,
        },
      },
      {
        taskId: 'demo-run-thesis-2',
        resumeId: 'demo-resume-thesis-2',
        resumable: false,
        wsId: 'demo-ws-auto-quant',
        agent: 'claude',
        prompt: 'Re-check every active thesis against the latest quotes; flag invalidations.',
        status: 'done',
        startedAt: now - HOUR / 2,
        finishedAt: now - HOUR / 2 + 31_000,
        durationMs: 31_000,
        exitCode: 0,
      },
      {
        taskId: 'demo-run-thesis-3',
        resumeId: 'demo-resume-thesis-3',
        resumable: false,
        wsId: 'demo-ws-auto-quant',
        agent: 'claude',
        prompt: 'Re-check every active thesis against the latest quotes; flag invalidations.',
        status: 'interrupted',
        startedAt: now - 2 * HOUR,
        finishedAt: now - 2 * HOUR + 4_000,
        killed: true,
        signal: 'SIGTERM',
      },
    ],
  },
  'demo-ws-macro/weekly-digest': {
    body: [
      '# Weekly macro digest',
      '',
      'Pull the week into one readable note: rates, FX, the data that printed, and the',
      'data on deck. Friday close.',
      '',
      '1. **Rates** — UST curve moves, any repricing of the cut path',
      '2. **FX** — DXY + the majors',
      '3. **Prints** — what surprised vs consensus',
      '4. **Next week** — the calendar that matters',
    ].join('\n'),
    what: 'Write the weekly macro digest and push it to the Inbox.',
    agent: 'codex',
    runs: [
      {
        taskId: 'demo-run-digest-1',
        resumeId: 'demo-resume-digest-1',
        resumable: true,
        wsId: 'demo-ws-macro',
        agent: 'codex',
        prompt: 'Write the weekly macro digest and push it to the Inbox.',
        status: 'done',
        startedAt: now - 2 * DAY,
        finishedAt: now - 2 * DAY + 156_000,
        durationMs: 156_000,
        exitCode: 0,
      },
      {
        taskId: 'demo-run-digest-2',
        resumeId: 'demo-resume-digest-2',
        resumable: false,
        wsId: 'demo-ws-macro',
        agent: 'codex',
        prompt: 'Write the weekly macro digest and push it to the Inbox.',
        status: 'done',
        startedAt: now - 9 * DAY,
        finishedAt: now - 9 * DAY + 141_000,
        durationMs: 141_000,
        exitCode: 0,
      },
    ],
  },
  // Scheduled one-shot that has never fired — exercises the empty Activity feed.
  'demo-ws-macro/cpi-release-note': {
    body: [
      'Draft the reaction note the moment CPI prints.',
      '',
      'Lead with the headline vs core surprise, then the rates/FX read-through in two',
      'sentences. Keep it under 150 words — this goes out fast.',
    ].join('\n'),
    what: 'Draft the CPI reaction note as soon as the print lands.',
    agent: 'claude',
    runs: [],
  },
  // Unscheduled work items — body only, no runs (issueId is recorded only on
  // scheduled fires, so these have no Activity feed).
  'demo-ws-auto-quant/rebalance-sizing-review': {
    body: [
      'The sizing logic in `rebalance.ts` rounds lot sizes in a way that drifts the',
      'target weights on small books. A human should sanity-check the rounding before',
      'we let the scheduler touch it.',
      '',
      '- [ ] Confirm the drift is real on the $25k paper book',
      '- [ ] Decide: round-to-lot vs allow fractional',
    ].join('\n'),
    runs: [],
  },
  'demo-ws-auto-quant/prune-stale-signals': {
    body: 'Old signal-cache entries are never evicted. Add a TTL sweep so the cache stops growing unbounded.',
    runs: [],
  },
  // Auto-quant half of the cross-workspace name collision. References an entity
  // and a sibling issue, and points at its macro-side namesake — clicking
  // [[Liquidity risk review]] surfaces both (the picker).
  'demo-ws-auto-quant/liquidity-risk-review': {
    body: [
      'Check we can actually exit the book under stress — venue depth, spread, and how fast we could flatten.',
      '',
      'The crowded [[ai-data-center-power]] names move together, so position-level liquidity understates the real risk. Cross-check against the [[Morning movers scan]] gap list.',
      '',
      '> Note: macro-research tracks a same-named [[Liquidity risk review]] from the system-wide angle — these are two different issues that happen to share a title.',
    ].join('\n'),
    runs: [],
  },
  'demo-ws-macro/fed-speaker-calendar': {
    body: 'Done — the upcoming Fed speaker calendar is summarized in `notes/fed-speakers.md` with hawk/dove leanings.',
    runs: [],
  },
  'demo-ws-macro/cross-asset-correlation': {
    body: 'Canceled — superseded by the dealer-positioning work; the correlation study was duplicating that lens.',
    runs: [],
  },
  // Macro half of the cross-workspace name collision — same title as the
  // auto-quant issue above, framed from the system-wide angle.
  'demo-ws-macro/liquidity-risk-review': {
    body: [
      'Where would funding/market liquidity bite first if conditions tighten? Map the channels, not any one book.',
      '',
      '- Repo / front-end stress vs the current [[ai-data-center-power]] funding of capex-heavy names',
      '- Dealer balance-sheet capacity into quarter-end',
      '',
      'See also the desk-level [[Liquidity risk review]] in auto-quant — narrower scope, same name.',
    ].join('\n'),
    runs: [],
  },
}

/** Locate a board issue (+ its workspace) by id, so the detail's display fields
 *  derive from the same source as the list. Returns null if no such row exists. */
function findBoardIssue(wsId: string, id: string) {
  const ws = demoIssuesSnapshot.workspaces.find((w) => w.wsId === wsId)
  return ws?.issues.find((i) => i.id === id) ?? null
}

/** Build the IssueDetail the GET /api/issues/:wsId/:id mock returns, or null if
 *  the (wsId, id) pair doesn't exist on the board (→ 404). Display fields come
 *  from the board snapshot; body / what / agent / runs come from the extras map
 *  (with a generic-body, no-runs fallback so any row opens). */
export function demoIssueDetail(wsId: string, id: string): IssueDetail | null {
  const boardIssue = findBoardIssue(wsId, id)
  if (!boardIssue) return null
  const extras = demoIssueExtras[`${wsId}/${id}`]
  const legacyBody = extras?.body?.trim() ?? ''
  const explicitWhat = extras?.what?.trim() ?? ''
  const what = explicitWhat && legacyBody && explicitWhat !== legacyBody
    ? `${explicitWhat}\n\n## Context\n\n${legacyBody}`
    : explicitWhat || legacyBody || boardIssue.title
  const runs = extras?.runs ?? []
  const comments = demoIssueComments[`${wsId}/${id}`] ?? []
  return {
    issue: {
      ...boardIssue,
      what,
      ...(extras?.agent ? { agent: extras.agent } : {}),
    },
    comments,
    runs,
    activity: comments
      .map((comment) => ({ kind: 'comment' as const, id: comment.id, at: Date.parse(comment.at), comment }))
      .sort((a, b) => a.at - b.at),
    // issue→inbox direction of the cross-link: every inbox report this issue
    // produced (server-stamped origin.issueId === id, this workspace), newest
    // first. Mirrors the real route's `inboxReportsFor` (webui/routes/issues.ts).
    // demoInboxEntries is already newest-first, so the filter preserves order.
    inboxReports: demoInboxEntries.filter(
      (e) => e.workspaceId === wsId && e.origin?.issueId === id,
    ),
  }
}

// ==================== Mutations (Phase 2b demo write path) ====================
// PATCH /api/issues/:wsId/:id and POST /api/issues/:wsId/:id/comments mutate the
// in-memory fixture above IN PLACE (per-session; resets on reload), so the demo
// UI reflects edits/comments just like the real working-tree-only writes do. The
// board snapshot is the single source of truth for status/priority/assignee
// (GET list + GET detail both read it live, so one mutation updates both); the
// What stays in the markdown fixture; comments mirror the server's independent
// per-Issue JSON sidecar so editing one cannot corrupt the other.
const demoIssueComments: Record<string, IssueComment[]> = {}

/** PATCH backing: mutate the board issue's status/priority/assignee in place,
 *  then return the fresh detail shape (same `{ issue, runs }` as GET). Returns
 *  null when the (wsId, id) pair doesn't exist (→ 404). */
export function demoIssueUpdate(
  wsId: string,
  id: string,
  patch: IssuePatch,
): IssueDetail | null {
  const boardIssue = findBoardIssue(wsId, id)
  if (!boardIssue) return null
  if (patch.status !== undefined) boardIssue.status = patch.status
  if (patch.priority !== undefined) boardIssue.priority = patch.priority
  if (patch.assignee !== undefined) {
    boardIssue.assignee = patch.assignee
    if (patch.assignee.startsWith('@resume-')) {
      delete boardIssue.agent
      delete boardIssue.model
      delete boardIssue.effort
    }
  }
  if (patch.what !== undefined) {
    const key = `${wsId}/${id}`
    const existing = demoIssueExtras[key]
    if (existing) {
      existing.what = patch.what
      existing.body = ''
    } else {
      demoIssueExtras[key] = { body: '', what: patch.what, runs: [] }
    }
  }
  if (patch.agent !== undefined) {
    if (patch.agent === null) delete boardIssue.agent
    else boardIssue.agent = patch.agent
    const key = `${wsId}/${id}`
    const existing = demoIssueExtras[key]
    if (existing) {
      if (patch.agent === null) delete existing.agent
      else existing.agent = patch.agent
    } else if (patch.agent !== null) {
      demoIssueExtras[key] = { body: `${boardIssue.title}\n\n(No description.)`, agent: patch.agent, runs: [] }
    }
  }
  if (patch.model !== undefined) {
    if (patch.model === null) delete boardIssue.model
    else boardIssue.model = patch.model
  }
  if (patch.effort !== undefined) {
    if (patch.effort === null) delete boardIssue.effort
    else boardIssue.effort = patch.effort
  }
  return demoIssueDetail(wsId, id)
}

/** POST-comment backing: append to the structured sidecar fixture. */
export function demoIssueAddComment(
  wsId: string,
  id: string,
  author: string,
  text: string,
): IssueDetail | null {
  const boardIssue = findBoardIssue(wsId, id)
  if (!boardIssue) return null
  const key = `${wsId}/${id}`
  const comments = demoIssueComments[key] ?? []
  const commentId = `demo-comment-${comments.length + 1}`
  const ownerResumeId = boardIssue.assignee.startsWith('@resume-') ? boardIssue.assignee.slice(1) : null
  const taskId = `demo-comment-run-${comments.length + 1}`
  comments.push({
    id: commentId,
    author,
    at: new Date().toISOString(),
    markdown: text,
    ...(ownerResumeId ? {
      delivery: { state: 'pending' as const, targetResumeId: ownerResumeId, taskId },
    } : {}),
  })
  demoIssueComments[key] = comments
  if (ownerResumeId) {
    window.setTimeout(() => {
      const source = comments.find((comment) => comment.id === commentId)
      if (!source || source.delivery?.state !== 'pending') return
      const replyCommentId = `demo-reply-${commentId}`
      source.delivery = {
        state: 'replied',
        targetResumeId: ownerResumeId,
        taskId,
        replyCommentId,
      }
      comments.push({
        id: replyCommentId,
        author: `@${ownerResumeId}`,
        at: new Date().toISOString(),
        markdown: 'I saw the comment and will carry this context into the next pass.',
        replyTo: commentId,
      })
    }, 900)
  }
  return demoIssueDetail(wsId, id)
}

/** POST-retry backing: add a fresh running execution without changing cadence. */
export function demoIssueRetry(wsId: string, id: string): IssueDetail | null {
  const boardIssue = findBoardIssue(wsId, id)
  const extras = demoIssueExtras[`${wsId}/${id}`]
  const latest = extras?.runs[0]
  if (!boardIssue?.when || !extras || !latest || (latest.status !== 'failed' && latest.status !== 'interrupted')) {
    return null
  }
  const run: IssueRunRecord = {
    taskId: `demo-retry-${Date.now()}`,
    resumeId: `demo-resume-retry-${Date.now()}`,
    resumable: false,
    wsId,
    issueId: id,
    agent: boardIssue.agent ?? extras.agent ?? latest.agent,
    prompt: latest.prompt,
    status: 'running',
    startedAt: Date.now(),
  }
  extras.runs.unshift(run)
  boardIssue.automationHealth = {
    state: 'running',
    message: 'A scheduled run is in progress.',
    latestTaskId: run.taskId,
  }
  return demoIssueDetail(wsId, id)
}
