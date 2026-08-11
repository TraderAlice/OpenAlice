# Static Markdown Content Stability

Status: Completed

Related issue: [#712](https://github.com/TraderAlice/OpenAlice/issues/712)

Owner guides: [[docs/project-structure.md]],
[[docs/ui-interaction-and-motion.md]], and [[docs/development-workflow.md]].

## Outcome

Keep long-form Markdown reports stable while unrelated live Workspace and Inbox
state refreshes. Selecting text, using browser translation, and interacting
with rendered report content must not be interrupted by an unchanged polling
response.

## Acceptance Boundary

- An identical Workspace Manager or Inbox history response preserves the
  existing state and row identities.
- An unrelated parent/context update does not replace the rendered Markdown
  child DOM when the generated HTML is unchanged.
- A real Markdown content change still updates the document immediately.
- Session signatures, wikilinks, and code-copy actions retain their current
  behavior.
- Inbox and Tracked/file-viewer routes keep text selection and injected
  browser/translation nodes intact across at least two polling intervals.

## Non-goals

- Replacing the complete Workspaces context with another state library.
- Changing polling intervals or transport protocols.
- Preserving a selection by recording and restoring DOM ranges after a rewrite.
- Redesigning Markdown typography, report chrome, or Inbox information
  hierarchy.
- Proving third-party HTML report iframe stability beyond guarding the shared
  Markdown paths covered by issue #712.

## Decisions

1. Treat identical server snapshots as no state change. Reuse one generic
   JSON-only reconciliation helper for single snapshots and keyed collections;
   do not maintain fragile per-field equality lists.
2. Keep Inbox on the existing Zustand-backed `createLiveStore`. Reconcile its
   history response before publishing so selectors receive stable identities.
3. Keep Workspace Manager ownership in `WorkspacesProvider` for this topic,
   but reconcile its three-second response before setting state. A full store
   migration is independent architecture work.
4. Split Markdown into an interaction owner and a memoized static HTML leaf.
   Context/action changes may update event handlers, but unchanged generated
   HTML must not be committed to `innerHTML` again.
5. Test DOM node identity directly. Selection loss and browser translation
   breakage are consequences of node replacement, so stable node identity is
   the deterministic regression contract.

## Work

- [x] Add and test generic JSON snapshot/collection reconciliation.
- [x] Reconcile Workspace Manager polling and Inbox history publication.
- [x] Introduce a stable Markdown DOM leaf without forking parsing or styles.
- [x] Add regression coverage for unchanged parent updates, injected DOM nodes,
      and actual Markdown updates.
- [x] Run required TypeScript and test gates.
- [x] Reproduce the real Inbox and Tracked routes and verify DOM identity over
      repeated polling intervals.
- [x] Publish one labeled Draft PR to `dev` and keep it open for topic review.

## Verification

```bash
npx tsc --noEmit
pnpm test
cd ui && npx tsc -b
```

Focused checks additionally exercise the reconciliation helpers and Markdown
render identity. Browser acceptance uses realistic Inbox and Tracked reports,
not an empty/demo-only surface.

Observed on 2026-08-09:

- Tracked report DOM retained its root, first heading, and an injected
  translation marker through seven Workspace/Manager polling responses with
  zero child-list mutations.
- Inbox message and expanded attachment DOM retained both injected markers
  through two Inbox history polls and repeated Manager polls, again with zero
  child-list mutations.
- `npx tsc --noEmit`, `cd ui && npx tsc -b`, and the complete `pnpm test`
  suite passed (492 files / 4057 tests passed; repository-declared skips
  remained unchanged).

## Completion

The plan is complete when the acceptance boundary is covered by tests, real
route observation shows no Markdown subtree replacement for unchanged polls,
the required checks pass, and the Draft PR records exact verification and any
residual HTML-iframe risk.

Completed in Draft PR
[#1030](https://github.com/TraderAlice/OpenAlice/pull/1030). Arbitrary HTML
report iframe stability remains an explicit non-goal of this topic.
