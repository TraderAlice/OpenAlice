# Wallet execution recovery

Status: implementation and isolated acceptance; Draft PR only. Issues #1680
and the pending-approval portion of #1313. Owner guides:
[[docs/project-structure.md]], [[docs/uta-live-testing.md]], [[docs/testing.md]].

The existing TradingGit owner will preserve prepared approvals and dispatch
progress in a new pending.json beside its existing commit.json. There is no
second execution engine, broker-specific matcher, migration of old commits,
or hedge-position model. Uncommitted staging remains transient; preparation
stamps the existing sub-account audit message before persistence.

- [x] Read current issues and exact candidate diffs. #1644 at e693949c2 owns
  bounded calls and outcome classification; #1364 at 4e812c2e owns IBKR probes.
  Neither records dispatch progress before the final commit callback.
- [x] Save prepared approvals, pre-dispatch markers and each returned outcome.
- [x] Prevent replay on restart; expose known order IDs to the existing sync.
- [x] Present execution recovery in the existing review panel and agent status.
- [x] Add isolated regression coverage for persistence and restart windows.
- [x] Owner types, 1,062 UTA tests, 291 integration tests, and desktop/mobile browser recovery checks passed.
- [ ] Full monorepo run still in progress; Electron install and npm-cache environment failures independently reproduced.
- [ ] Verify published Draft head and its CI; no merge authority.

Recovery UI choice: reuse the existing review detail, warning color, status
semantics and shared Button. A known outcome can be recorded without sending
again. A call with no saved outcome has no approve/reject action. IDs wrap on
small screens; the existing queue/detail navigation and keyboard controls stay
in place. This conservative interaction was selected autonomously for review.

Known boundary: an interrupted broker call cannot be declared rejected or
safely replayed from local evidence. It remains blocked until a separate,
reviewed broker-evidence or explicit operator-acknowledgement contract can
resolve it. Do not add a discard/force-retry control to disguise this limit.
