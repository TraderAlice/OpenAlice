# shadcn Overlay Foundation

- Status: `active`
- Updated: `2026-08-04`
- Delivery: one autonomous topic branch and community-facing Draft PR targeting
  `dev`; the PR remains unmerged until maintainer acceptance.
- Related issues: none yet.
- Owner guides: [[docs/ui-interaction-and-motion.md]],
  [[docs/project-structure.md]], and [[docs/development-workflow.md]].

## Outcome

OpenAlice owns one source-visible, accessible UI primitive layer for dialogs,
sheets, popovers, menus, and related controls. Product-level components keep
their current APIs and information hierarchy while delegating focus trapping,
portals, dismissal, scroll locking, and nested-overlay behavior to maintained
shadcn primitives. The first stage removes representative hand-written overlay
logic without changing the default visual language.

This foundation makes later runtime-selectable style profiles practical, but a
Win98 skin and broad component restyling are deliberately outside this stage.

## Current Evidence

- The UI already uses React 19, Tailwind CSS 4, `@theme inline`, and a complete
  shadcn-compatible semantic color vocabulary.
- The UI currently contains roughly 137 component files, 416 raw buttons, 72
  raw inputs, and 38 raw selects. A mechanical whole-app rewrite would be too
  broad to review or verify safely.
- Shared overlays still maintain their own focus trap, Escape listener,
  outside-click handling, inert state, and mobile dialog behavior. Recent
  nested-overlay fixes demonstrate that this behavior is a continuing source
  of regressions rather than settled product logic.

## Scope

### In scope

- Add a checked-in shadcn configuration for the existing Vite/Tailwind v4 app.
- Add the smallest shared utility and Radix-backed primitives needed for the
  first overlay migration.
- Preserve the existing semantic palette tokens and current default rendering.
- Migrate the shared Dialog and ConfirmDialog paths behind compatible product
  APIs, then remove their superseded manual interaction code.
- Migrate the page-sidebar mobile overlay and a bounded set of representative
  popover/menu paths where the new primitives materially remove custom event
  plumbing.
- Add focused interaction tests for focus entry/return, Escape, outside
  dismissal, nested overlays, and narrow-layout behavior.
- Verify real dev/browser routes and the Electron/package path required by the
  large-change workflow.

### Not in scope

- Replacing every raw button, input, select, card, or product composition.
- Rebuilding ActivityBar, Workspace trees, terminal, charts, reports, or
  trading tables around generic shadcn blocks.
- Changing OpenAlice's default appearance, typography, layout, or information
  architecture.
- Shipping Win98 or another runtime style profile in this first stage.
- Treating third-party registries as trusted dependencies without source
  review and local ownership.

## Decisions

1. **Primitives, not blocks.** OpenAlice retains product-level components such
   as `PageSidebarLayout`; shadcn supplies lower-level behavior and owned source.
2. **Radix first.** The first stage uses the mature Radix-backed shadcn output.
   Reconsidering Base UI or React Aria requires a separate evidence-backed
   migration rather than mixing primitive bases in one app.
3. **Visual parity first.** Existing semantic tokens and restrained warm visual
   language remain authoritative. Generated styles are adapted to OpenAlice;
   they do not overwrite the palette or owner guide.
4. **Runtime style is a separate axis.** Future `data-ui-style` state will own
   geometry, elevation, density, typography, and motion while `data-palette`
   continues to own color. This stage only creates compatible component seams.
5. **Delete superseded behavior.** A migration is complete only when the old
   focus/dismissal implementation and redundant CSS are removed or reduced to
   a documented compatibility boundary.
6. **One topic PR.** Related increments accumulate as atomic commits in one
   Draft PR labelled `workflow:parallel`, `theme:design-system`, and
   `area:app-shell`. It is not auto-merged by later interactive instructions.

## Work

### 1. Foundation

- [ ] Add `components.json`, UI-local import aliases, `cn`, and pinned primitive
      dependencies without replacing existing global CSS.
- [ ] Add OpenAlice-adapted Button, Dialog, AlertDialog, Sheet, Popover,
      DropdownMenu, Tooltip, and supporting primitives under `components/ui`.
- [ ] Add primitive-level tests for default rendering and keyboard behavior.

### 2. Shared dialog migration

- [ ] Replace the manual shared Dialog internals while preserving its current
      product-facing props and mobile-fullscreen contract.
- [ ] Move ConfirmDialog onto AlertDialog semantics and verify destructive,
      primary, initial-focus, and focus-return behavior.
- [ ] Exercise representative UTA, Workspace, credential, and update dialogs.

### 3. Sidebar and floating overlays

- [ ] Replace the mobile page-sidebar native dialog plumbing with Sheet while
      preserving the rail/sidebar mounted-state and responsive contract.
- [ ] Migrate SidebarActionMenu and selected user-identity/context popovers.
- [ ] Verify that nested Escape and outside dismissal unwind one layer at a
      time on both phone and desktop layouts.

### 4. Verification and delivery

- [ ] Run `npx tsc --noEmit`, `cd ui && npx tsc -b`, and `pnpm test` after each
      meaningful migration increment.
- [ ] Walk real `pnpm dev` routes at narrow, medium, and wide widths with
      keyboard and pointer input in day and night palettes.
- [ ] Run the applicable Electron/package smoke before calling the stage
      complete.
- [ ] Update the owner guide with the durable primitive ownership contract.
- [ ] Publish and maintain one labelled Draft PR against `dev`; do not merge it
      automatically.

## Completion Criteria

- Shared dialogs, confirmations, the mobile page sidebar, and the selected
  floating-overlay paths no longer implement their own generic focus trap,
  portal, scroll lock, or global dismissal loops.
- Existing call sites preserve their product behavior and default visual
  hierarchy across narrow and wide layouts.
- Nested overlays close one layer at a time and reliably restore focus.
- Required typechecks, the full test suite, real browser routes, and the chosen
  Electron/package smoke pass.
- The Draft PR documents remaining custom overlays and names the next bounded
  migration topic without hiding deferred defects in this plan.
