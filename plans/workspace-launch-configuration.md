# Workspace Launch Configuration

Status: Completed

Related issues: None.

Owner guides:

- [[docs/managed-workspace-runtime.md]]
- [[docs/ui-interaction-and-motion.md]]
- [[docs/development-workflow.md]]

## Scope

Make the existing Workspace settings modal the explicit home for both the
default Agent runtime used by fresh Sessions and the read-only resolved launch
plan. The plan must come from the same command, environment, cwd, adapter, and
platform-resolution path used by the real PTY spawn, while keeping credentials
and other sensitive values out of the API.

This increment does not add custom runtimes or a general cross-platform shell
preference.

## Decisions

- Add a dedicated **Sessions** section beside General and AI Provider.
- Persist an optional Workspace-local `defaultAgent` in
  `.alice/workspace.json`; the optional field is backwards compatible and does
  not require a persisted-state migration.
- Resolve a fresh Session runtime in this order: an explicit one-run choice,
  the target Workspace default, the legacy installation-wide default, then the
  first registered runtime.
- Treat Quick Chat, sidebar, CLI, and API runtime choices as one-Session
  overrides. They must not silently rewrite either Workspace or installation
  defaults.
- Preview one enabled Workspace runtime at a time, with the Shell utility
  always available because it shares the common launcher environment.
- Show both adapter-composed argv and the platform-resolved process argv when
  they differ.
- Describe only launcher-controlled environment contributions. Secret-like
  values are redacted; inherited host environment values are not returned.
- Treat the preview as a fresh interactive Session and never run lifecycle
  hooks, mutate native config, or spawn a process while reading it.
- Keep existing structured-log policy unchanged: complete argv and environment
  values remain outside launcher logs.

## Work

- [x] Extend the canonical spawn plan with platform resolution and safe
  environment contribution metadata.
- [x] Add and test a read-only Workspace launch-plan endpoint.
- [x] Add the original launch-preview section, translations, demo handler, and
  component tests, then evolve it into the Sessions section.
- [x] Add a Workspace-local default runtime editor shared by Chat and AutoQuant.
- [x] Apply the Workspace default to normal, Quick Chat, sidebar, CLI, API, and
  Issue fallback paths without changing explicit launch overrides.
- [x] Verify the real browser route and Electron PTY/package paths.
- [x] Record completion and move this plan to the Completed index.

## Verification

- `npx tsc --noEmit`
- `cd ui && npx tsc -b`
- `pnpm test`
- Real AutoQuant Workspace settings route in the browser, including the
  Sessions editor and resolved launch preview
- Demo AutoQuant route, including saving a default and observing inheritance
  in the launch surface
- `pnpm electron:smoke:pty`
- `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron:smoke:workspace`

## Completion

The Workspace settings panel can explicitly configure the default Agent
runtime used by new Chat or AutoQuant Sessions and explain the exact safe
launch plan for every enabled runtime plus the always-available Shell utility.
Explicit launch choices remain one-run overrides. Browser and Electron
transports use the same API shape, and all required checks pass without
exposing credentials.
