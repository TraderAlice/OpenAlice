# Workspace AI Preferences

Status: Completed

Related issues: None.

Owner guides:

- [[../docs/model-semantics-and-runtime-injection.md]]
- [[../docs/managed-workspace-runtime.md]]
- [[../docs/workspace-issues-and-scheduling.md]]
- [[../docs/ui-interaction-and-motion.md]]

## Problem

Workspace Settings currently labels a mixed runtime-diagnostics surface as
"Sessions". That surface combines Agent runtime selection, process launch
preview, and a deprecated native-file compatibility export. The new
`.alice/settings.json` contract exposes only automatically remembered
interactive/headless choices, so it cannot distinguish an explicit user
default from a temporary launch that merely became recent.

The first preferences UI split durable policy by Ask Alice and Issues. Real use
showed that these are entry surfaces, not stable configuration semantics: CLI
and API launches can be interactive or headless too. Users normally need only
recent successful choices, but when they open this advanced surface they need
to see the complete interactive/headless state without switching tabs.

## Design Alternatives

1. **Two expanded launch-mode sections (selected with the maintainer).** Show
   Interactive sessions and Headless runs vertically, each with its default
   runtime and complete runtime matrix. This is longer, but nothing is hidden
   and the persisted concepts remain portable across entry surfaces.
2. **Launch-mode tabs.** Keeps the page compact, but prevents comparing the two
   modes and makes a rarely visited settings page hide half of its state.
3. **Runtime-first matrix.** Makes adapters the top-level grouping and places
   interactive/headless controls in each row. This helps runtime authors, but
   makes the human distinction between visible and background work harder to
   scan.

The selected design adds separate **Agent runtimes** and **AI preferences**
navigation entries. Agent runtimes owns availability, launch diagnostics, and
the deprecated compatibility export. AI preferences owns launch-mode defaults
and per-runtime access/model/effort editing.

## Decisions

1. Evolve `.alice/settings.json` to version 3. Each `interactive` and `headless`
   launch mode stores optional fixed defaults plus a separate automatically
   maintained recent layer.
2. Migration 0037 converted version 1 files into explicit fixed/recent layers;
   migration 0038 converts the version 2 `askAlice` and `issues` entry-surface
   keys to version 3 `interactive` and `headless` launch modes. Normal runtime
   reads accept only version 3 and carry no permanent legacy branch.
3. Resolve a fresh launch in this order: explicit one-launch fields, fixed
   mode/runtime preference, matching recent preference, then native Agent
   state. Resolve the Agent runtime from explicit input, fixed mode default,
   recent mode Agent, legacy Workspace default, then installation fallback.
4. A fixed runtime preference is one complete access/model/effort tuple. "Use
   recent" removes that fixed tuple instead of mixing fields invisibly across
   recent and fixed credentials.
5. Interactive covers fresh visible Sessions from Ask Alice, the Workspace
   sidebar, CLI, and API. Headless covers Issues, schedules, automation, CLI,
   and API; explicit Issue fields and exact resume bindings remain immutable
   and take precedence.
6. Workspace creation choices seed fixed defaults. Successful fresh launches
   update only the recent layer.
7. Desktop and narrow layouts show both mode sections in one vertical flow.
   Runtime editing uses the shared Dialog primitive and lets the dialog use the
   available work area. Dialogs, menus, focus containment, dismissal, and
   keyboard navigation remain shared shadcn/Base UI responsibilities.
8. Credential rows show human-readable AI access labels and keep native/global
   Agent authentication as an explicit valid option. No secret, endpoint, or
   resolved credential payload enters Workspace settings or UI responses.
9. The settings editor owns a form layout rather than reusing Quick Chat's
   compact toolbar layout. AI access is one full-width, portaled menu; model and
   effort form a balanced responsive pair below it. Selection state and model
   semantics remain owned by the shared launch-configuration hook.

## Work

- [x] Add the v2 settings schema, one-time v1 migration, atomic default updates,
      and focused precedence tests.
- [x] Apply launch-mode Agent/default resolution to Ask Alice, sidebar Session
      starts, Issues, generic headless dispatch, probes, and exact resume.
- [x] Add a secret-free Workspace launch-preferences API and demo handler.
- [x] Rename Sessions to Agent runtimes and keep runtime diagnostics plus the
      deprecated export on that surface.
- [x] Add the AI preferences launch-mode/runtime matrix and shared editor dialog.
- [x] Update Issue and Ask Alice inherited-default presentation, i18n, docs,
      demo fixtures, and tests.
- [x] Verify TypeScript, full tests, real browser behavior, PTY, and packaged
      Workspace acceptance; then deliver serially to `dev`.
- [x] Replace the compact launch toolbar embedded in the runtime-preference
      dialog with a responsive settings form and portaled access menu.
- [x] Register and exercise migration 0037 against active and departed
      Workspaces, then remove the runtime v1 compatibility reader.
- [x] Re-run real Workspace browser, focused migration/UI, typecheck, full test,
      and packaged Workspace acceptance for the follow-up.
- [x] Replace Ask Alice/Issues tabs with simultaneous Interactive sessions and
      Headless runs sections and one atomic page save.
- [x] Add version 3 mode keys plus migration 0038 for active and departed
      Workspaces; remove entry-surface keys from the current reader.
- [x] Re-run focused, full, browser, and packaged Workspace acceptance and
      deliver the mode-first follow-up serially.

## Verification

- `npx tsc --noEmit`
- `cd ui && npx tsc -b`
- `pnpm test`
- Focused Workspace settings, Quick Chat, Issue dispatch, and UI render suites
- Real `/chat` Workspace Settings walkthrough through `pnpm dev`
- `pnpm electron:smoke:pty`
- `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron:smoke:workspace`

## Completion

Workspace Settings clearly separates runtime mechanics from AI policy.
Interactive sessions and headless runs can each pin a default Agent and one
secret-free preference per runtime, while recent successful launches remain
the zero-config fallback and never overwrite an explicit default. Both modes
remain expanded so an advanced user can inspect the complete state at once.
The final increment made the page save atomic, introduced the version 3
launch-mode contract, moved legacy conversion into idempotent migrations 0037
and 0038, and passed real browser plus packaged Electron Workspace acceptance.
