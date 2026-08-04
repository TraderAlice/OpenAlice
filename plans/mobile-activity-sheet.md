# Mobile Activity Sheet

- Status: `active`
- Updated: `2026-08-04`
- Delivery: serial PR targeting `dev` after Draft PR #970 is explicitly
  accepted and merged; the implementation branch is currently stacked on
  #970 and is not published as a second concurrent PR.
- Related issues: none.
- Owner guides: [[docs/ui-interaction-and-motion.md]] and
  [[docs/development-workflow.md]].

## Outcome

The phone ActivityBar uses the OpenAlice-owned Sheet primitive for its portal,
backdrop, scroll lock, focus containment, Escape handling, outside dismissal,
animation, and focus return. The static desktop rail keeps its existing
information hierarchy, density, collapse behavior, and lifetime.

## Scope

### In scope

- Replace the phone ActivityBar's document-level keyboard and focus loop with
  the shared Sheet behavior introduced by #970.
- Remove the duplicate App-level body scroll lock.
- Preserve the current destination as initial focus and return focus to the
  mobile rail trigger after dismissal.
- Keep the 280 px phone rail, current navigation grouping, touch targets,
  badges, footer controls, and desktop widths visually stable.
- Add reduced-motion coverage to the shared Sheet surface and overlay.

### Not in scope

- Restyling or regrouping top-level navigation.
- Migrating the ActivityBar section information disclosure to a Popover.
- Changing page-owned navigators, `WorkspaceAIConfigModal`, or the remaining
  Workspace/session chooser menus.
- Publishing a stacked PR before its foundation is present on `dev`.

## Decisions

1. The phone Sheet portal unmounts while closed; the desktop rail remains a
   normal mounted `aside`.
2. The App keeps its explicit background `inert` contract while the phone rail
   is open. Sheet owns generic modal behavior; App owns the shell hierarchy.
3. This is a serial follow-on, not extra scope added to autonomous Draft PR
   #970 and not a second simultaneously published contribution.

## Work

- [x] Audit the current ActivityBar and its responsive shell ownership.
- [x] Migrate the phone rail to Sheet and delete superseded backdrop, body
      scroll lock, document Escape listener, and manual focus loop.
- [x] Verify closed unmounting, overlay dismissal, current-item focus, Tab
      containment, Escape, focus return, desktop persistence, and touch sizes
      in focused tests.
- [x] Run root and UI type checks plus the full Vitest suite.
- [ ] Walk the real `pnpm dev` Inbox route at phone and desktop widths with
      keyboard and pointer input. The controlled in-app browser is currently
      on a Chromium connection-error page and its URL policy rejected agent
      navigation after the development server recovered.
- [x] Run the unsigned packaged Electron Workspace smoke.
- [ ] After #970 is explicitly accepted, update from `dev`, replay this atomic
      commit on a fresh serial branch, rerun affected checks, and open/merge a
      dev-targeted PR.

## Verification Evidence

- `npx tsc --noEmit`
- `pnpm -C ui exec tsc -b`
- `pnpm test` — 470 files and 3,900 tests passed; one file and nine tests keep
  their existing skips.
- `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron:smoke:workspace` — unsigned
  packaged Workspace acceptance passed and cleaned its temporary app.
- Browser/dev — not yet accepted; a running Vite server alone is not visual or
  interaction evidence.

## Completion Criteria

- No ActivityBar-owned generic modal focus loop, backdrop, body scroll lock, or
  document Escape handler remains.
- Phone and desktop routes preserve the existing hierarchy and usable width.
- Required type checks, full tests, real browser verification, and Electron
  smoke pass.
- The serial PR is merged to `dev`, its post-merge run is inspected, and the
  working checkout returns to updated `dev`.
