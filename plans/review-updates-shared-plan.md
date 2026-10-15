# Shared update review plans

Status: implemented; independent Draft PR #1693 awaits review.
Related issues: none linked. Owner guides: [[docs/update-lifecycle.md]],
[[docs/ui-interaction-and-motion.md]], [[docs/testing.md]],
[[docs/workspace-template-upgrade.md]], and [[docs/harness-web-surfaces.md]].

## Shared review plan increment (2026-10-01)

Maintainer approved reuse of the automatic check's plan in review, direct entry
for one update, and an explicit refresh to replace it. Initial base: dev `680dcff9` (#1690); integrated dev `dc59c5b1` (#1692).
Preserve coordinated operation review alongside exact owner review, and keep the
completed broad lifecycle plan deleted; this file tracks only the UI increment. Delivery is an independent Draft PR; no merge
or release authority for this increment.

Chosen interaction: keep the existing overview and Workspace review surfaces.
One actionable update opens its exact owner review; multiple updates keep exact
targets in the chooser. Closing/reopening has no extra plan request. Refresh
failure keeps the last preview, displays the error and prevents apply. Reuse the
existing Dialog/Workspace settings modal, focus containment/restoration, and
full-height mobile layout; introduce no new attention banner or indicator.

- [x] Bind overview, managed-template/source panels and scoped Harness/skill
      reviews to the same provider-owned resources; reuse core DiscoveryStore.
- [x] Fence backend generations and stale responses; isolate Workspace/layer/
      projection keys and invalidate baseline/receipt/candidate/removal/apply.
- [x] Reuse Machine review plans and preserve native expiry/single-use approval.
      Block approvals during refresh or after a failed fresh read.
- [x] Put the actual Workspace modal host beneath the shared lifecycle owner.
- [x] Verify concurrent reads, reopen, refresh failure, stale digest, content
      invalidation, source commit identity, backend A → B → A and StrictMode.
- [x] Walk Chromium demo Settings at 1280×960 and 390×844: sole Workspace
      entry, exact source review, reopen request counts, explicit refresh/error
      recovery, Escape/focus restoration, no overflow and no apply mutation.
- [x] Run final UI owner/typecheck and required critical/workflow gates.
- [ ] Collect terminal exact-head remote CI and record it in the Draft PR.

Initial-base local acceptance: UI owner 361 files /2091 passed (257.25s), focused reviews
59/59 passed, UI typecheck passed, whole critical gate 18 tests/all 15 required
references accepted, and workflow 12 files /108 passed. Receipts are local dirty
source validation; the Draft PR records the committed head and remote CI. The
change is shared within the UI owner; no backend/shared protocol, dependency or
runner implementation changes, so no automatic complete monorepo test rerun.

The browser uses recorded demo APIs; real Electron IPC, SSH installation,
native restart, and live source merges remain owner acceptance gaps. Backend
engines and API contracts are unchanged. Source demo previews explicitly retain
the runtime blocker and read-only apply response.

Parallel attention Draft #1691 (`d15ff415`) also changes App.tsx,
useUpdateLifecycle.tsx and VersionOverviewSection.tsx. Do not transplant it into
this branch. Whichever PR lands second must preserve both provider placement and
each feature's guidance/entry semantics, then rerun UI/type/browser gates on the
combined source. Neither PR's independent CI proves that combination.


Completion: accept this bounded UI increment after exact-head CI and combined
review; delete this active plan and its index entry when accepted. Native/SSH
acceptance remains with the owner guides.

Integration validation on #1692: UI owner 361 files /2093 passed (277.78s),
focused reviews 60/60 passed, UI typecheck passed, complete critical gate
18 tests/all 15 required references accepted, workflow 12 files /108 passed.
The fresh dependency installation initially lacked the already-cached
@noble/hashes 2.2.0 link required by #1692; restoring that ignored installed
link and rebuilding the shared package resolved collection without source or
lock changes. A new regression keeps pending coordinated recovery visible
when one owner target remains. Chromium also confirmed the two-target chooser
hands off the exact Workspace with one existing plan read and no second GET.
Screenshots use recorded demo data; the two-target diagnostic adds one
read-only backend candidate. No independent attention changes from #1691 are
included.
