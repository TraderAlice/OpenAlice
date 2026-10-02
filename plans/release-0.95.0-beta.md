# 0.95.0 beta release and timing review

Status: active; maintainer authorized beta publication and a measured retrospective on 2026-10-02.

Current external blocker: Release 36994301678 attempt 1 failed only both Mac notarization jobs with Apple HTTP 403 (required agreement missing/expired). Account Holder action requested; tag/GitHub/CDN publication skipped. Preserve passed artifacts, rerun failures after user confirms the account is resolved, and continue this same report. Early detection follow-up: GitHub #1754. Do not synchronize the dev version or remove this plan before public acceptance.

Owner guides: [[docs/development-workflow.md]], [[docs/cli-installer.md]], [[docs/managed-workspace-runtime.md]].

Scope: promote accepted dev, prepare `0.95.0-beta`, dispatch the manual Release, verify public beta assets and unchanged stable surfaces, synchronize the root version back to dev, and deliver a timing report. No stable publication or pipeline optimization is included.

Decisions: preserve exact-source identity; reuse recorded clean local acceptance only when its source is unchanged. Capture local event times and GitHub run/job/step timestamps, distinguish dependency waiting from runner queue and execution, and analyze the critical path rather than summing parallel durations. Keep timing/report work out of the release-source diff.

- [x] Dev `61f3943d`: full suite 7,698 passed / 9 skipped, typechecks, critical-local, unsigned macOS arm64 credential/Pi, Workspace and startup acceptance.
- [x] Exact-head live dev installer CI passed: run 36982439405.
- [x] Repair promotion-only gate prerequisites and Quit/navigation semantics through #1737 and #1738; full suite now 7,701 passed / 9 skipped, native arm64 Workspace/N-1 and targeted Intel N-1 passed.
- [x] Promotion #1736 merged as `9dd46a06`; exact dev `4813c1b8` live channel run 36992082296 and all master gates green.
- [x] Focused root-only version-prep #1739 merged as `2cf59b6b` after beta fast-lane checks.
- [ ] Exact-master Release dispatch and final native candidate acceptance.
- [ ] GitHub/CDN beta verification, stable surface preservation, version synchronization.
- [ ] Timing evidence and retrospective, then remove this active plan and index entry.

Evidence under `/tmp/openalice-release-0.95.0-beta` is task-owned. The delivered report will retain non-sensitive timing data and links. Completion requires accepted publication, root-version synchronization, and the report; a tag or passing build alone is insufficient.
