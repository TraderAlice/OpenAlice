# Remote Machine Fleet and AliceProject Transfer

**Status:** Active (Increments 1–6 and 8 shipped in `dev`; Increment 7 remains open)

## Shipped Baseline (Increments 1–6 & 8)

Machine registry (`machines.json`), aggregate SSH `machine inspect`, Supervisor TUI Fleet workbench, bounded SSH `project transfer` (re-sealing Alice-owned credentials under a new remote key while excluding native/OpenAlice Session continuation state), and remote readiness/browser recovery truth are implemented in `dev`.

## Active Work: Increment 7 — Controller-Driven Remote Release Convergence

- [x] Audit managed SSH release authority, dev-manifest selection,
  target-specific artifact identity, and stale-controller behavior; record the
  chosen relation model.
- [ ] Add one typed release-relation result shared by raw-target Remote, fleet
  inventory/detail, CLI plans, and Supervisor TUI presentation.
- [ ] Preserve the existing latest-dev-controller gate and add directional
  stable/beta comparison so an older controller cannot downgrade a newer
  remote. Cross-channel changes remain an explicit separate intent.
- [ ] Keep compatible read-only status/tunnel access available when the
  controller is behind, while blocking every remote lifecycle or release
  mutation with actionable local-upgrade guidance.
- [ ] When the remote is behind, show the exact install/restart/PTY impact,
  require consent, invoke the normal SSH installer, and wait for a bounded
  target-identity/readiness re-probe.
- [ ] Treat transport loss, owner replacement, install failure, and readiness
  timeout as non-convergence. Report the verified running release and never
  claim that the remote upgraded.
- [ ] Add focused managed-SSH, dev-manifest, stale-controller, cross-channel,
  consent/default-No, and post-install identity tests. Extend the disposable
  Docker SSH journey without exposing a public Web port.
- [ ] Update CLI help and Supervisor wording with the shipped apply authority and downgrade rules.
- [ ] Delete this plan and its `plans/index.md` bullet once Increment 7 is merged and verified.

## Verification

```bash
npx tsc --noEmit
cd ui && npx tsc -b
pnpm -F @traderalice/openalice-cli typecheck
pnpm -F @traderalice/openalice-cli test
pnpm test:system:remote
```
