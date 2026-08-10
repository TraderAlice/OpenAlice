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

Users need to configure AI access, model, and effort independently for Ask
Alice and Issue/automation launches, with one preference per Agent runtime.
Issue declarations and one-launch choices must continue to override Workspace
defaults.

## Design Alternatives

1. **Scenario-first runtime matrix (selected).** Choose Ask Alice or Issues,
   then inspect and edit every compatible Agent runtime. This matches the
   user's task-first mental model and keeps scenario fallback visible.
2. **Runtime-first scenario editor.** Choose Pi/Codex/etc. first, then edit
   both scenarios. This is compact for runtime authors but makes ordinary users
   understand adapter ownership before their task.
3. **Free-form rule list.** Render rules such as `Ask Alice + Pi -> model`.
   This scales to arbitrary future surfaces but creates an enterprise-policy UI
   and makes fallback precedence harder to scan.

The selected design adds separate **Agent runtimes** and **AI preferences**
navigation entries. Agent runtimes owns availability, launch diagnostics, and
the deprecated compatibility export. AI preferences owns scenario selection,
default runtime, and per-runtime access/model/effort editing.

## Decisions

1. Evolve `.alice/settings.json` to version 2. Each `askAlice` and `issues`
   scenario stores optional fixed defaults plus a separate automatically
   maintained recent layer.
2. Migrate version 1 files once: `interactive` becomes Ask Alice recent state
   and `headless` becomes Issues recent state. Normal runtime reads accept only
   version 2 and never carry a permanent legacy branch.
3. Resolve a fresh launch in this order: explicit one-launch fields, fixed
   scenario/runtime preference, matching recent preference, then native Agent
   state. Resolve the Agent runtime from explicit input, fixed scenario default,
   recent scenario Agent, legacy Workspace default, then installation fallback.
4. A fixed runtime preference is one complete access/model/effort tuple. "Use
   recent" removes that fixed tuple instead of mixing fields invisibly across
   recent and fixed credentials.
5. Ask Alice covers fresh interactive product Sessions. Issues covers fresh
   Issue and generic headless automation turns; explicit Issue fields and exact
   resume bindings remain immutable and take precedence.
6. Workspace creation choices seed fixed defaults. Successful fresh launches
   update only the recent layer.
7. Desktop uses scenario Tabs and a scan-first runtime list. Runtime editing
   uses the shared Dialog primitive; narrow layouts keep the same hierarchy and
   let the dialog use the available work area. Tabs, dialogs, menus, focus
   containment, dismissal, and keyboard navigation remain shared shadcn/Base UI
   responsibilities.
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
- [x] Apply scenario Agent/default resolution to Ask Alice, sidebar Session
      starts, Issues, generic headless dispatch, probes, and exact resume.
- [x] Add a secret-free Workspace scenario-preferences API and demo handler.
- [x] Rename Sessions to Agent runtimes and keep runtime diagnostics plus the
      deprecated export on that surface.
- [x] Add the AI preferences scenario/runtime matrix and shared editor dialog.
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

## Verification

- `npx tsc --noEmit`
- `cd ui && npx tsc -b`
- `pnpm test`
- Focused Workspace settings, Quick Chat, Issue dispatch, and UI render suites
- Real `/chat` Workspace Settings walkthrough through `pnpm dev`
- `pnpm electron:smoke:pty`
- `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron:smoke:workspace`

## Completion

Workspace Settings clearly separates runtime mechanics from AI policy. Ask
Alice and Issues can each pin a default Agent and one secret-free preference per
runtime, while recent successful launches remain available as the zero-config
fallback and never overwrite an explicit default. The follow-up replaced the
embedded Quick Chat toolbar with a responsive settings form, verified its
portaled credential menu on desktop and narrow layouts, and moved all legacy
settings conversion into idempotent migration 0037.
