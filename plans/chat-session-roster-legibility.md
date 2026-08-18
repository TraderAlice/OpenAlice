# Chat Session Roster Legibility

**Status:** Active

**Owner guides:** [[docs/ui-interaction-and-motion.md]],
[[docs/workspace-lifecycle.md]], [[docs/conversation-provenance.md]]

## Problem

Ask Alice now treats interactive- and headless-born Sessions as one durable
roster. That lifecycle model is correct, but the sidebar still presents many
Issue-born Sessions with their launch prompt as the primary title. Long
Markdown instructions and raw automation copy obscure the conversation's
identity, make the roster difficult to scan, and leave its provenance unclear.

This topic improves roster presentation only. It must not change `resumeId`,
Session membership, presence/archive behavior, ordering, occupancy, or resume
semantics.

## Design alternatives

### A. Truncate or sanitize every title in the row

- Smallest implementation and no contract changes.
- Still guesses from arbitrary prompt text and hides rather than represents the
  Session's known origin.
- Rejected: another presentation patch would be needed for every new source.

### B. Resolve a semantic row identity from existing Session provenance

- Issue-born Sessions use their Issue identity instead of the launch prompt;
  interactive Sessions retain their runtime/user-facing title.
- A restrained subtitle explains source or Workspace context without adding a
  second navigation hierarchy.
- Uses the existing Session Directory domain hook and its immutable
  `createdBy` metadata, so no extra Issue-board polling is required.
- Selected: it fixes the information model at the current domain boundary and
  preserves the unified first-class Session roster.

### C. Split the sidebar into Interactive, Issues, and Background groups

- Makes every source explicit and may help very large rosters.
- Adds vertical chrome, competes with the existing Running section, and risks
  teaching users that headless Sessions are a different class of coworker.
- Deferred unless browser acceptance shows that semantic rows alone are still
  insufficient.

## Chosen interaction model

- The row remains one compact, clickable Session row with the current
  pause/resume/menu actions and reorder motion.
- A coworker display name remains the strongest explicit user-owned label.
- Issue provenance wins over launch-prompt fallback text and is rendered as a
  readable Issue title derived from the stable Issue id.
- Conversation reconstruction uses its stable Issue subject when present.
  Legacy headless rows that predate immutable birth metadata may use their
  Directory execution Issue id; this compatibility projection never renames a
  normal interactive chat.
- Other Session origins keep the best available runtime/user title. Source
  context may appear as a quiet, single-line subtitle; technical ids stay in
  the existing tooltip rather than the visual hierarchy.
- Long English/CJK text must ellipsize without moving action targets. The
  existing full-title tooltip and accessible labels remain available.
- No new motion is introduced. Existing reorder motion and reduced-motion
  behavior remain unchanged.

## Work

- [x] Add a tested, provenance-aware presentation projection beside the
      existing Session Directory join.
- [x] Render semantic titles/subtitles in focused, recent-across-Workspace,
      multi-Workspace, and conversation-browser roster surfaces.
- [x] Cover Issue, interactive, headless/conversation, explicit coworker name,
      missing metadata, and long-title cases.
- [x] Verify the real `/chat` route with a large roster at desktop and tablet
      widths, including long rows, action menus, and the conversation browser.
      No live headless-occupied row was available; its unchanged occupancy
      behavior remains covered by the focused component specs.
- [x] Run root and UI typechecks, the full test suite, and targeted roster
      specs; record the results in the PR.

## Notes

- Derivation prefers immutable Directory `createdBy`. Historical headless
  Sessions without birth metadata may use `latestExecution.issueId`; ordinary
  interactive chats never receive that compatibility projection.
- Live `/chat` on this machine exercised current and historical Issue rows,
  an Issue-linked conversation, ordinary chats, a long unknown-provenance row,
  the row action menu, and the conversation browser at desktop and 900x800.
  There was no headless-occupied running row during acceptance.

## Completion

- Issue-born Session rows no longer expose full launch prompts as their primary
  identity.
- Normal chat titles, ordering, occupancy, actions, accessibility, and Session
  identity remain unchanged.
- The result is browser-accepted on the real data set with no known responsive
  or motion regression.
