# shadcn Base UI Migration

- Status: `completed`
- Updated: `2026-08-04`
- Delivery: serial PR #973 targeting `dev`.
- Related issues: none.
- Owner guides: [[docs/ui-interaction-and-motion.md]],
  [[docs/development-workflow.md]], and [[docs/project-structure.md]].

## Outcome

OpenAlice uses the current shadcn Base UI + Nova component source as its shared
UI foundation instead of maintaining Radix-backed copies and OpenAlice-owned
generic overlay patches. Product components keep domain-specific composition,
copy, sizing, and semantic tokens; upstream shadcn components own generic
dialog, menu, popover, tooltip, portal, focus, and dismissal behavior.

## Scope

### In scope

- Change the checked-in shadcn base from `radix-nova` to `base-nova`.
- Replace Button, Dialog, AlertDialog, Sheet, DropdownMenu, Popover, and Tooltip
  with their current official Base UI implementations.
- Migrate every current call site across `asChild`/`render`, event, focus, and
  controlled-state API differences.
- Remove Radix packages and the custom nested-overlay portal boundary.
- Keep OpenAlice's semantic palette and product-level responsive hierarchy.
- Verify the real Chat, Inbox, Issue, Settings, and mobile navigation surfaces
  in dev/browser, then run unsigned packaged Electron acceptance.

### Not in scope

- Converting every remaining raw input, select, table, or product composition
  in the same PR.
- Shipping the Win98 or another selectable visual profile.
- Replacing OpenAlice's palette, typography, information architecture, or
  domain wrappers with a generic dashboard block.

## Decisions

1. Use `base-nova`, the Base UI counterpart of the existing compact Nova style,
   rather than mixing component bases indefinitely.
2. Treat official shadcn output as the primitive baseline. Product-specific
   sizing belongs at call sites or domain wrappers; generic focus, portal, and
   dismissal patches do not belong in `components/ui`.
3. Preserve semantic CSS variables so the migration changes component behavior
   and maintainability without discarding OpenAlice's Day/Night palettes.
4. Deliver all seven currently installed primitives together because their
   portals, triggers, and nested-overlay semantics form one compatibility
   boundary. Do not start the next raw-control migration in this PR.

## Work

- [x] Regenerate the seven installed primitives from the official Base UI Nova
      registry and update dependencies/configuration.
- [x] Migrate product call sites and delete the Radix-only compatibility layer.
- [x] Update focused tests for Base UI semantics and add nested-overlay
      regression coverage without reintroducing custom portal ownership.
- [x] Run root/UI typechecks and the full Vitest suite.
- [x] Walk the real dev routes at phone, tablet, and desktop widths in Day and
      Night palettes with keyboard and pointer input.
- [x] Run the unsigned packaged Electron Workspace smoke.
- [x] Prepare serial PR #973 for `dev` and archive this plan under Completed.

## Completion Criteria

- No `@radix-ui/react-*`, unified `radix-ui`, or OpenAlice-owned generic portal
  boundary remains in the installed shadcn primitive layer.
- All current overlay and button consumers compile and preserve their product
  behavior across responsive modes.
- Nested menus/popovers remain usable inside modal surfaces using upstream
  Base UI behavior.
- Required tests, real browser walks, and Electron smoke pass.
- Serial PR #973 contains the complete migration and verification record for
  integration into `dev`.
