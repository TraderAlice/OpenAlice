# Compact activity notifications

**Status:** implementation; approved visual, Draft PR to dev; no merge authority.
**Owner guides:** [[docs/ui-interaction-and-motion.md]], [[docs/product-activity-journal.md]], [[docs/testing.md]].

## PRD and design decision

Users opening a busy trading workspace should retain useful pop-out feedback
without per-article stacks or oversized generic cards. The maintainer accepted
the actual news preview (352px, 64×48 thumbnail, content-height card) with
“对味了。交给你了。” after reviewing the desktop render. This authorizes
implementation and a Draft PR, not merge/release.

Approved visual evidence: Library `libfile_f659784757c481919f1ccd1419f79302`
(desktop), `libfile_1310390f0c3c8191b06944734208185f` (mobile),
`libfile_d053b00f204081919f742bf537a4d4f7` (dark).

| ID | Requirement and acceptance |
|---|---|
| N1 | Shared Sonner-hosted cards use Instrument Sans/theme tokens, 352px desktop width, 12px padding, 10px corners, internal close, bounded two-line copy and action below. Below 600px preserve 16px side clearance. No new portal/notification center. |
| N2 | News optionally carries a validated HTTP(S), credential-free image URL from stored metadata through the journal and hook. 64×48 thumbnail belongs to displayed article ID/headline. Missing, invalid and failed images collapse to text; old records work unchanged. |
| N3 | News groups by normalized source; Inbox groups by publishing workspace/session (fallback workspace/agent). Fixed 4,000ms window from first arrival; pending groups coalesce until admitted. Count distinct event revisions, display the newest item's complete content tuple. No sliding window. |
| N4 | Three cards display fully expanded; overflow waits. Errors preempt the lowest-priority non-error card, which returns to the queue. FIFO within priority; error > warning > success > news > running. A finite lifetime starts on display, not enqueue; redisplay after preemption starts a full lifetime. Hover/focus pause through Sonner. Same-status/group updates do not reset lifetime; terminal transitions do. |
| N5 | Running eligible Agent requests use one task/session key and spinner. Success becomes a 4s completion card; interrupted/paused are neutral 4s states; launch/terminal failures are 10s; rejection is amber 8s. Correlated Inbox delivery replaces that operation's running/completion card, 6s, once. Failed operations must not become success because an Inbox error report was delivered. Tool text/progress and recoverable turn errors do not create global notifications or fabricated progress. |
| N6 | Preserve existing eligibility: non-human conversation lifecycle, agent-originated non-manual Inbox, News and explicit dev probes. Initial successful snapshot remains silent, including StrictMode replay and initial read failure. Process each new revision once. |
| N7 | Close/swipe hides a notification only, never cancels work/deletes content. Dismissed running state cannot reopen through progress; a later terminal result can appear once. Same group remains dismissed through its burst window. Exact local error message + optional caller scope shares a fixed 30s repeat window; count updates without timer restart, recovery/new error remains distinguishable. |
| N8 | News/Inbox retain existing whole-page actions. Agent inspection uses existing read-only background Session inspection when identity resolves, otherwise Office. User action feedback shares compact styling. No automatic retry or runtime takeover. |
| N9 | Demo/browser acceptance covers image/no-image/broken/grouped, running→completion/failure/Inbox, baseline silence, close/action, light/dark and narrow layout. Components/projector/queue tests cover burst boundary, ordering, dedup, dismissal and repeat errors; root/UI types and complete hermetic suite pass. |

News/Inbox lifetimes are 6s; local success 4s, local error 10s; running is
persistent until terminal, dismissal or disappearance from the activity projection.
No blanket category suppression. Exact severity is derived from event semantics,
not a new journal field. Snapshot/account-health/ordinary diagnostics stay outside
this pipeline. Browser/demo top offset clears its banner and context chrome;
native shell clearance and Office's existing offsets remain respected.

## Architecture and task package

- Journal keeps per-item durable facts and existing event/API names. Add only
  optional news `image`; producer validates URL. No migration/dual-read parser,
  no historical rewrite and no changes to runtime dispatch, UTA or broker state.
- Existing domain hook projects eligible lifecycle/Inbox/News facts. Extend
  terminal states while retaining running/failure summary semantics.
- A small UI queue owns display/group/dismissal state; Sonner continues to own
  placement, motion, interaction-paused lifetimes and swipe dismissal.
- A shared prop-driven card under `components/ui/` owns visual/thumbnail fallback;
  ActivityToasts maps facts to copy/actions, local feedback uses the same queue.
- Test fixtures are demo data. No live provider/broker work or production-state reads.

## Checklist

- [x] Inspect current dev, event taxonomy/producers and actual browser shell.
- [x] Review actual desktop/light/dark/mobile news preview; maintainer accepts.
- [x] Freeze requirements and architecture above before production edits.
- [x] Implement shared card/queue, activity mapping, optional image pipeline and demo.
- [ ] Complete contract tests, owner types, full hermetic tests and browser acceptance.
- [ ] Save implementation screenshots and open Draft PR to dev; verify remote head/checks.

## Explicit limits

This increment preserves current global eligibility rather than turning every
interactive process or Issue event into a popup. Tool-stage/elapsed-time display
and exact article/Inbox-item deep links are future design scope: current global
signal/navigation contracts do not carry everything required. No new progress
polling or per-toast News-list lookup. Final visual selection does not imply
approval of any future expansion.

Remove this plan/index entry after maintainer acceptance; retain durable behavior
in the UI interaction owner guide. Git history preserves the accepted PRD.

## Verification checkpoint

Shared notification contracts, root/UI typechecks and complete `pnpm build`
pass. Actual demo renders verify image/no-image/broken/grouped news,
lifecycle delivery/failure, historical silence, close and News navigation.
The complete hermetic suite is run, but this sandbox cannot supply node-pty
headers/native bindings and retains terminated process descendants; its
installer file-mode test also fails. These unrelated failures reproduce on
unchanged `dev` (`a640693d`). Do not mark the complete-suite gate passed.
Draft review must retain these limits until checks run in a supported environment.
