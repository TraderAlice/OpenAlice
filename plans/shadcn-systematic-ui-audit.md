# shadcn Systematic UI Audit

- Status: `completed`
- Updated: `2026-08-04`
- Delivery: one serial PR targeting `dev` if the audit finds changes.
- Related PR: #973.
- Owner guides: [[docs/ui-interaction-and-motion.md]],
  [[docs/development-workflow.md]], and [[docs/project-structure.md]].

## Outcome

Every installed shadcn/Base UI primitive is exercised through a real OpenAlice
feature rather than inferred from typechecks or isolated primitive tests. Any
migration regression is repaired at the product call site or with the official
primitive API, without rebuilding a parallel overlay/focus system.

## Acceptance Matrix

| Primitive | Real product entry | Required evidence |
|---|---|---|
| Button | generated Dialog/Sheet close controls and ordinary form actions | pointer and keyboard activation, focus ring, disabled state, no layout drift |
| Dialog | AI credential, Create Workspace, Workspace offboarding, UTA forms | centered/fullscreen geometry, initial focus, focus containment/return, Escape/backdrop dismissal, scroll |
| AlertDialog | Inbox/Workspace/provider destructive confirmations | safe initial focus, cancel/Escape, pending lock, focus return, narrow viewport |
| Sheet | phone ActivityBar and page-owned secondary navigators | overlay dismissal, current-item focus, focus loop/return, content selection, nested overlay |
| DropdownMenu | Workspace and Session action menus | pointer and keyboard open/select, outside/Escape dismissal, edge positioning, nested Sheet use |
| Popover | Inbox sender identity and Issue Session provenance | pointer/keyboard open, non-modal focus, outside/Escape dismissal, focus return, mobile fit |
| Tooltip | shared primitive baseline (currently no product consumer) | source/registry parity and focused primitive smoke until a product consumer exists |

All interactive rows are checked at representative phone (390px), narrow
tablet (740px), wide tablet (900px), and desktop (1200px) widths. At least one
desktop and one constrained-width pass run in both Paper and Iris palettes.

## Work

- [x] Inventory every primitive consumer and map it to a reachable real-data
      route without using demo mode.
- [x] Exercise pointer, keyboard, focus, dismissal, and viewport behavior for
      every matrix row in `pnpm dev`.
- [x] Repair each confirmed regression and add the narrowest durable test that
      would have caught it.
- [x] Run root/UI typechecks, the full Vitest suite, production UI build, and
      unsigned packaged Electron Workspace smoke.
- [x] Prepare and merge one serial PR to `dev`, then inspect the post-merge
      smoke and archive this plan under Completed.

## Audit Record

- Exercised Chat and Workspace action menus at 390, 740, 900, and 1200 pixels,
  including a menu nested in the mobile Sheet and the menu-to-AlertDialog and
  menu-to-Dialog handoffs.
- Exercised AI credential, Create Workspace, Workspace offboarding, and UTA
  dialogs; provider and Session deletion confirmations; mobile ActivityBar and
  page navigator Sheets; and Inbox/Issue identity Popovers in real `pnpm dev`.
- Confirmed Paper and Iris rendering at desktop and constrained widths, body
  scroll locking, narrow-screen overlay bounds, safe initial focus, Escape and
  outside dismissal, and return focus.
- Repaired a confirmed focus regression: selecting a menu item that opens a
  follow-up dialog captured the disappearing menu item as its return target.
  Actions now run after the menu closes and focus returns to the durable trigger.
- Confirmed Tooltip has no product consumer yet and matches Base UI's visual-only
  tooltip semantics; added focused pointer and keyboard smoke coverage.
- Verification passed: root and UI TypeScript, 3,904 Vitest tests (plus 9
  skipped), the production UI build, and unsigned packaged Electron Workspace
  acceptance. One UTA registry test exceeded its 5-second timeout only while
  running concurrently with the first production build; its isolated rerun and
  the subsequent independent full suite passed.
- Serial PR #974 merged to `dev`; the updated integration checkout passed the
  focused six-test overlay suite and the real mobile
  Sheet-to-menu-to-AlertDialog Escape/focus-return flow.

## Completion Criteria

- Each installed primitive has authoritative real-surface or explicit
  no-consumer evidence.
- Every reachable overlay works with pointer and keyboard input across its
  responsive ownership boundary and returns focus predictably.
- No browser console errors, inert interactive overlays, clipped menus, or
  off-viewport dialogs remain in the audited routes.
- All required local and packaged checks pass, and any integration PR is merged
  with a successful post-merge `dev` smoke.
