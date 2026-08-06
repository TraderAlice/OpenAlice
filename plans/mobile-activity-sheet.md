# Mobile Activity Sheet

- Status: `complete`
- Updated: `2026-08-04`
- Delivery: serial PR #971 targeting `dev`, after the shared overlay foundation
  was explicitly accepted and merged in PR #970.
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
3. This shipped as serial follow-on PR #971 after autonomous foundation PR
   #970 was accepted and merged, rather than as extra foundation scope or a
   simultaneous contribution.

## Work

- [x] Audit the current ActivityBar and its responsive shell ownership.
- [x] Migrate the phone rail to Sheet and delete superseded backdrop, body
      scroll lock, document Escape listener, and manual focus loop.
- [x] Verify closed unmounting, overlay dismissal, current-item focus, Tab
      containment, Escape, focus return, desktop persistence, and touch sizes
      in focused tests.
- [x] Run root and UI type checks plus the full Vitest suite.
- [x] Walk the real `pnpm dev` Inbox and Settings routes at phone and desktop
      widths with keyboard and pointer input in Day and Night palettes.
- [x] Run the unsigned packaged Electron Workspace smoke.
- [x] After #970 is explicitly accepted, update from `dev`, replay this atomic
      commit on a fresh serial branch, rerun affected checks, and open/merge a
      dev-targeted PR.

## Verification Evidence

- `npx tsc --noEmit`
- `pnpm -C ui exec tsc -b`
- `pnpm test` — 470 files and 3,900 tests passed; one file and nine tests keep
  their existing skips.
- `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron:smoke:workspace` — unsigned
  packaged Workspace acceptance passed and cleaned its temporary app.
- Browser/dev — at 390 × 844, verified a 280 px Sheet, current-destination
  initial focus, body scroll lock, inert/hidden background, Escape, visible
  overlay dismissal, trigger focus return, and navigation-driven close. At
  1280 × 900, verified the normal 188 px `aside` with no Sheet/overlay portal.
  Day and Night palettes rendered cleanly and the console had no warnings or
  errors. This walk found and repaired a side-variant width conflict that had
  expanded the first render to 292.5 px; the theme preference was restored to
  Auto afterward.

## Completion Criteria

- No ActivityBar-owned generic modal focus loop, backdrop, body scroll lock, or
  document Escape handler remains.
- Phone and desktop routes preserve the existing hierarchy and usable width.
- Required type checks, full tests, real browser verification, and Electron
  smoke pass.
- The serial PR is merged to `dev`, its post-merge run is inspected, and the
  working checkout returns to updated `dev`.
