# Plan: Auto Prediction Harness

**Status:** active — increment 1 implemented; web-surface increment deferred
**Owner guides:** [[docs/project-structure.md]], [[docs/managed-workspace-runtime.md]], [[docs/workspace-lifecycle.md]], [[docs/conversation-provenance.md]]
**Delivery:** serial PRs to `dev` (`area:workspace`, `area:app-shell`, `review:deep`).

## Goal

Expose Auto Prediction as a Beta Harness backed by one durable, source-pinned
Workspace. The first increment deliberately reuses the Ask Alice / AutoQuant
conversation model: a native Coding Agent works inside the cloned Auto
Prediction repository. Auto Prediction Studio remains repository-owned and is
not yet started, proxied, embedded, or supervised by OpenAlice.

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

The chosen entry path is:

```text
Beta → Prediction → initialize/select Workspace → ask a Coding Agent
```

The setup page and conversation shell remain responsive and keyboard-accessible
through the shared `HarnessSetupPage` and Harness shell primitives. The AP
repository owns its SQLite, campaigns, evidence, internal workers, and Studio.
OpenAlice owns only the Workspace, Sessions, source receipt, default desk,
lifecycle, and product navigation.

## Decisions

1. Template id: `auto-prediction`; product Harness id: `prediction`;
   default Workspace tag: `prediction`.
2. Source is `https://github.com/TraderAlice/Auto-Prediction.git` at one exact
   launcher-approved commit. The first pin is Node-22-qualified merge
   `26f3ae2d617e115850cff6fe047f6fb54c979d20`; do not invent a release tag.
3. Display an experimental snapshot/short commit when no upstream release
   exists. `.alice/harness-source.json` remains the immutable receipt.
4. No dependency install in bootstrap. As with AutoQuant, the Coding Agent owns
   repository dependency preparation inside the Workspace.
5. Add only the thin shared Harness identity needed by a third desk. Do not
   define a Studio/plugin/business API in this increment.
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

### Later increment — web application surfaces

- [ ] Use Auto Prediction Studio and the planned financial-dashboard Workspace
      as the two real specimens for a managed web-surface contract.
- [ ] Standardize only observed common needs: production command, dynamic port,
      health/readiness, lifecycle, same-origin proxy/app transport, and packaged
      resource ownership.
- [ ] Decide whether web surfaces are embedded tabs, external local pages, or
      both. Do not infer this contract from Vite development commands.

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

## Completion

Increment 1 is complete when a fresh browser and packaged Electron user can
create/select a pinned Prediction Workspace, start and resume native Coding
Agent Sessions from the Beta entry, and inspect source/provenance without
OpenAlice starting AP Studio. Delete this plan and its [[PLANS.md]] bullet only
after the accepted final increment records the durable web-surface contract.
