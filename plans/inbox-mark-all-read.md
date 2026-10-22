# Inbox mark all as read

Status: local implementation and verification; feature branch hold (no push/PR/merge/deploy).
Related issues: none supplied.
Base: explicitly requested origin/master, 87bc415260aaac92a072d89a1c6440268a3efdf1.
Owner guides: docs/inbox-content.md, docs/ui-interaction-and-motion.md, docs/testing.md.

Scope: search-adjacent toolbar, global unread count, atomic server snapshot read operation,
localized feedback, preserved selection/scroll and Office review target exclusion.

- [x] Inspect independent cloud checkout and repository guidance.
- [x] Implement store/API/live state/toolbar and demo contract.
- [x] Verify >100 entries, arrivals, persistence/failures, Office exclusions and keyboard/navigation.
- [x] Root/UI/integration-test types and production UI build pass.
- [x] Browser demo acceptance in light/dark, keyboard, filter, selection and actual report scroll.
- [ ] Full hermetic acceptance: run completed with 896 files / 7692 assertions passing; five native suite collection failures remain (four missing pty.node, one incomplete Electron install), one file / six assertions skipped.

Decisions: existing read-state version 1 is unchanged; no migration. Snapshot IDs are
captured before waiting for read-state writes; later entries stay unread. Office's
same-tab review checkpoint supplies an excluded ID. Count is global, independent of
loaded rows or search. User scope overrides repository dev-base/default delivery rules.

Blockers: approved Library image download returned HTTP 403 on initial attempt and
one supported materialization retry. No pixels inspected; implementation follows the
explicit textual approval and current components. Initial native dependency install
failed in dugite with getaddrinfo EAI_AGAIN github.com; ignore-scripts installation
succeeded for pure JS tests. Native/runtime coverage must not be claimed from that.

Completion: focused regression coverage, owning types and applicable acceptance pass,
or exact remaining blockers are reported with local diff. No external delivery.

Verification evidence: 83 focused assertions across six files pass, including all
new store/API/live-state/component cases and InboxPage regressions. Final copy-only
sidebar check passes 18 assertions. System Git and a workspace npm cache resolve
the initial WorkspaceAbsorb/npm-pack failures (10 assertions pass). UI production
build passes with a chunk-size warning. Browser evidence uses real Chromium against
the repository demo/MSW surface, not production/native end-to-end acceptance.

Full `pnpm test` retry exited 1 after 332.99s; no feature assertion failures.
Native acceptance remains blocked by missing installed binaries, not waived.

Independent review found and resolved stale bulk count arithmetic: unseen arrivals
could zero the badge despite a protected unread target. The server now returns
its unread count; regression includes stale client history and failed refresh.
Final focused run: 84 assertions pass. Independent re-review: 38 assertions pass,
no further concrete defect found. Browser light/dark checks rerun successfully.
The full-suite result above is from before this review correction.
