# Plan: Auto Prediction Harness

**Status:** active — increment 2 implemented; increment 3 source lifecycle in progress
**Owner guides:** [[docs/project-structure.md]], [[docs/managed-workspace-runtime.md]], [[docs/harness-web-surfaces.md]], [[docs/workspace-lifecycle.md]], [[docs/conversation-provenance.md]]
**Delivery:** serial PRs to `dev` (`area:workspace`, `area:app-shell`, `review:deep`).

## Goal

Expose Auto Prediction as a Beta Harness backed by one durable, source-pinned
Workspace. Native Coding Agents work inside the cloned repository; the second
increment also launches the repository-owned Studio through a thin shared
manifest, supervision, and route contract without moving its business state or
API into OpenAlice.

## Product decision

Three approaches were considered:

1. **Desk-first (chosen):** clone a qualified Auto Prediction commit like
   AutoQuant, then reuse the Harness setup, roster, composer, Session,
   provenance, and Workspace lifecycle surfaces.
2. **Studio-first:** supervise the Auto Prediction control plane and embed or
   proxy Studio immediately. This prematurely standardizes ports, health,
   packaging, and Electron web-app hosting.
3. **One-off Studio launcher:** add an AP-specific start/open button. This is
   initially small but would turn a development command into an accidental
   public runtime contract.

After the desk-first increment established a real Workspace, three web-surface
routes were compared: a path-prefix proxy, a generic arbitrary-port proxy, and
an opaque host route. The host route was chosen because AP/AQ can keep serving
from `/`, Studio remains a separate origin from Alice auth, and the same Host
identity crosses the existing SSH tunnel. The generic port proxy was rejected
as an authority leak; path-prefixing would require Harness-specific base-path
work.

The chosen entry paths are:

```text
Beta → Prediction → initialize/select Workspace → ask a Coding Agent
Beta → Prediction → initialize/select Workspace → Studio
```

The setup page, conversation shell, and Studio toolbar remain responsive and
keyboard-accessible through shared Harness shell and Button primitives. The AP
repository owns its SQLite, campaigns, evidence, internal workers, and Studio.
OpenAlice owns the Workspace, Sessions, source receipt, default desk, web
process supervision, opaque routing, lifecycle, and product navigation.

## Decisions

1. Template id: `auto-prediction`; product Harness id: `prediction`;
   default Workspace tag: `prediction`.
2. Source is `https://github.com/TraderAlice/Auto-Prediction.git` at one exact
   launcher-approved commit. The Studio-capable default is Node-22-qualified
   release `v0.1.1` at `db49d9dde1386fe3f0f8e7b7c78aa3810b7438b9`.
3. Display an experimental snapshot/short commit only when no upstream release
   exists. `.alice/harness-source.json` remains the immutable receipt.
4. No dependency install in bootstrap. As with AutoQuant, the Coding Agent owns
   repository dependency preparation inside the Workspace.
5. Keep the web contract structural: OpenAlice owns supervision and routing;
   Auto Prediction owns Studio and every business API.
6. Prediction requires explicit initialization or default-desk selection and
   never creates a Workspace as a side effect of sending a prompt.
7. Prediction Sessions use the existing conversation and artifact provenance
   model. The CLI `conversation ask --harness prediction` resolves only the
   configured Prediction desk.
8. Office may name Prediction as its own Harness neighborhood, but no new floor
   interaction or visual redesign belongs to this plan.

## Ordered work

### Increment 1 — source-backed conversation Harness

- [x] Add `auto-prediction` template metadata, bootstrap, README, immutable
      source receipt, and focused clone/commit ancestry tests.
- [x] Add Prediction default-Workspace persistence and backend initialize,
      select, readiness, and conversation resolution routes.
- [x] Add the Beta Activity entry, URL/tab types, setup page, ready shell,
      composer copy, settings copy, and responsive/demo coverage.
- [x] Extend conversation targeting, Workspace return paths, provenance source,
      Session interactive surface, and Office Harness identity.
- [x] Update durable owner-guide truth without claiming Studio integration.
- [x] Pin the first upstream Node-22-qualified AP commit before delivery.

### Increment 2 — managed web application surfaces

- [x] Use Auto Prediction and AutoQuant Studio as two real specimens for a v1
      manifest and managed-launch contract.
- [x] Standardize only observed common needs: argv command, symbolic injected
      ports, readiness, foreground lifecycle, browser suppression,
      origin-neutral Studio behavior, and bounded logs.
- [x] Choose embedded Studio tabs with explicit readiness/failure chrome and an
      optional separate window; keep internal bind ports out of product UI.
- [x] Add an opaque host route table: browser/SSH reuse Alice HTTP, Electron
      keeps `app://` and owns a restricted loopback Surface Gateway.
- [ ] Complete real AP/AQ, browser, SSH, Electron, and packaged acceptance and
      move the stable contract into its owner guide before deleting this plan.

### Increment 3 — shared source release lifecycle

- [x] Treat the template source catalog as OpenAlice's verified release
      allowlist and derive verification from the exact version + commit tuple.
- [x] Add one installation-level, default-off preference that also discovers
      the latest stable upstream SemVer tag and labels it as unverified.
- [x] Give AutoQuant and Auto Prediction one source-upgrade plan/apply contract:
      exact target commit, Git merge preview, runtime/working-tree guards,
      reviewed apply, recovery, and immutable receipt update.
- [x] Keep prereleases and protocol-incompatible releases outside the normal
      upgrade path; never install dependencies or launch upgraded code as part
      of discovery or apply.
- [x] Surface verified and unverified upgrade state consistently in Workspace
      overview/settings, with an explicit warning before unverified apply.
- [x] Cover both Harness templates with the same domain, route, UI, demo, and
      real Git-fixture acceptance.

## Verification

- `npx tsc --noEmit`
- `cd ui && npx tsc -b`
- targeted template, preference, route, conversation, tab, shell, navigation,
  Office, and demo specs
- `pnpm test`
- real browser walk: Beta → Prediction setup → initialize/select → send prompt
- `npx tsc -p apps/desktop/tsconfig.json --noEmit`
- `pnpm electron:smoke:pty`
- `pnpm electron:smoke:packaged --temp-data`

No AP model call or live-market action is required for OpenAlice acceptance.
Source-clone acceptance uses the qualified immutable commit and isolated data.

Increment 1 verification on 2026-08-20:

- root and UI TypeScript checks passed;
- full Vitest run passed (567 files, 4,824 tests; one file and nine tests skipped);
- the isolated source-clone E2E passed all four template creation cases;
- Demo browser acceptance passed at desktop and 390×844: Prediction opened,
  had no horizontal overflow, dispatched a simulated Session, and adopted the
  `/prediction/workspaces/.../s/...` route under the Prediction shell;
- Electron PTY smoke passed, and the unsigned packaged app reached the renderer
  bridge with `auto-prediction` present in the packaged template catalog. The
  interactive packaged smoke was then stopped normally after readiness.

Upstream Harness acceptance on 2026-08-22:

- Auto Prediction `v0.1.1` (`db49d9dde1386fe3f0f8e7b7c78aa3810b7438b9`)
  passed its 27 generic Harness configuration, real subprocess, exact-port,
  current-origin HTTP/SSE/WebSocket, occupied-port, and cleanup checks. The
  OpenAlice supervisor independently reached ready, fetched the root document,
  and stopped both child listeners. It is the approved AP default.
- AutoQuant `v0.9.34` (`52d63148d826e6c35d48c3167d95a4cc7a4eb6c4`)
  resolves the `v0.9.33` bare-`aq` and managed-host findings. All 18 Studio
  tests passed; the real OpenAlice supervisor independently launched the
  frozen/no-sync manifest command from a prepared clone under an ordinary
  parent PATH, reached health 200, published the opaque route, redacted its
  internal listener from logs, and released the process and port on stop. It is
  the approved AutoQuant default.

Shared source lifecycle acceptance on 2026-08-22:

- the exact-commit Git fixture passed verified upgrade, default-off unverified
  discovery, manifest validation, committed-history preservation, dirty-tree
  blocking, receipt update, and route stale-plan coverage;
- the real existing AutoQuant `v0.8.31` Workspace previewed a clean merge to
  verified `v0.9.34`, validated manifest v1, reported 714 upstream changed
  paths and no conflicts, and preserved ordinary untracked research artifacts;
- browser acceptance showed the shared AQ source review and the default-off
  installation setting alongside Auto Prediction; no real Workspace upgrade
  was applied during acceptance;
- root/UI/Desktop TypeScript checks, the full 575-file Vitest run (4,851
  passing; one file and nine tests skipped), and the unsigned packaged
  Electron Workspace smoke passed.

## Completion

The initiative is complete when fresh browser, SSH-browser, and packaged
Electron users can create/select a Studio-capable Prediction Workspace, use
native Coding Agent Sessions, start/restart the embedded Studio without seeing
internal ports, and recover from a failed child with useful bounded logs.
Delete this plan and its [[PLANS.md]] bullet after those runtime paths pass and
the durable web-surface guide matches the accepted implementation.
