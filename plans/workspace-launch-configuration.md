# Workspace Launch Configuration

Status: Completed

Related issues: None.

Owner guides:

- [[docs/managed-workspace-runtime.md]]
- [[docs/ui-interaction-and-motion.md]]
- [[docs/development-workflow.md]]

## Scope

Expose the next fresh Workspace Session's read-only launch plan from the
existing Workspace settings modal. The plan must come from the same command,
environment, cwd, adapter, and platform-resolution path used by the real PTY
spawn, while keeping credentials and other sensitive values out of the API.

This increment does not add editable hooks, custom runtimes, or a general
cross-platform shell preference.

## Decisions

- Add a dedicated **Launch** section beside General and AI Provider.
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
- [x] Add the Launch section, translations, demo handler, and component tests.
- [x] Verify the real browser route and Electron PTY/package paths.
- [x] Record completion and move this plan to the Completed index.

## Verification

- `npx tsc --noEmit`
- `cd ui && npx tsc -b`
- `pnpm test`
- Real Workspace settings route in browser/demo mode at desktop and 390 px
  widths, including runtime switching and browser-console review
- `pnpm electron:smoke:pty`
- `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron:smoke:workspace`

## Completion

The Workspace settings panel can explain the exact safe launch plan for every
enabled runtime and the always-available Shell utility. Browser and Electron
transports can read the same API shape, and all required checks pass without
exposing credentials or changing launch behavior.
