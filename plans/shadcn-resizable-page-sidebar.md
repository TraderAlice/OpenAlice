# shadcn Resizable Page Sidebar

- Status: `complete` (implemented in Draft PR #1025; awaiting maintainer acceptance)
- Updated: `2026-08-08`
- Delivery: one autonomous topic Draft PR targeting `dev`; merge only after
  maintainer acceptance.
- Related PRs: #1023 established the adjacent long-form reading surface but is
  not part of this migration; Draft PR #1025 contains this implementation.
- Owner guides: [[docs/ui-interaction-and-motion.md]] and
  [[docs/development-workflow.md]].
- Upstream reference: [shadcn Resizable](https://ui.shadcn.com/docs/components/base/resizable)
  on `react-resizable-panels` v4.

## Outcome

Every page-owned desktop navigator uses the checked-in shadcn Resizable
primitive instead of OpenAlice-owned pointer listeners and a separately drawn
resize rail. The page keeps one visible separator, native mouse/touch/keyboard
resizing, the existing pixel width preference and focus-mode state, and the
current mobile Sheet hierarchy.

## Current Evidence

- `PageSidebarLayout` gives its outer desktop container a right border, then
  allocates a second 10px `ResizeHandle` column whose center draws another
  one-pixel rule. That composition creates the visible double separator.
- The custom separator is focusable and exposes ARIA min/max/value metadata,
  but has no keyboard resize implementation.
- Dragging is implemented with document-level pointer listeners and manual
  cursor/user-select mutation.
- `react-resizable-panels@4.11.0` is already installed but has no consumer and
  `ui/src/components/ui/resizable.tsx` does not exist.
- The official current `base-nova` registry source wraps v4 `Group`, `Panel`,
  and `Separator` as stable shadcn components and supplies an enlarged invisible
  hit target around a single visible rule.

## Scope

### In scope

- Add the official `base-nova` shadcn Resizable source under
  `ui/src/components/ui/resizable.tsx` with the repository's existing `cn`
  alias and semantic tokens.
- Recompose the desktop branch of `PageSidebarLayout` with
  `ResizablePanelGroup`, `ResizablePanel`, and `ResizableHandle`.
- Preserve the existing 200–420px navigator constraints, the 500px minimum
  working pane, responsive maximum width, per-page pixel width persistence,
  44px focus mode, collapse/restore controls, and hidden-surface `inert`
  contract.
- Keep one separator exactly at the navigator/content boundary; its visual
  rule and resize hit target must not consume two distinct layout columns.
- Exercise every current shell consumer through representative Chat,
  AutoQuant, Inbox, Tracked, Market, Portfolio, Automation, Settings,
  Workspaces, and Dev Panel routes. Issues and Trading-as-Git remain full-width
  surfaces and do not consume `PageSidebarLayout`.
- Delete the superseded pointermove/pointerup plumbing, body cursor mutation,
  custom resize component, and constants that no longer own behavior.
- Record the stable primitive ownership boundary in the UI owner guide.

### Not in scope

- Replacing OpenAlice's product `Sidebar` navigation composition with the
  generic shadcn Sidebar block.
- Changing ActivityBar geometry, route hierarchy, row styling, palettes, or
  information architecture.
- Replacing the mobile `Sheet`; it remains the narrow-layout owner.
- Adding a third-party layout store or migrating unrelated split panes.
- Changing backend, Workspace, trading, credential, or persisted data formats.

## Decisions

1. Use the official checked-in shadcn wrapper rather than importing
   `react-resizable-panels` directly from product code. `data-slot` remains the
   styling seam for Default, Windows 98, and Broker Classic profiles.
2. Keep `PageSidebarLayout` as the product adapter. shadcn owns separator
   pointer/touch/keyboard behavior; the adapter owns responsive mode, content,
   collapse affordances, and OpenAlice preference keys.
3. Preserve the existing localStorage keys and pixel values. Configure the
   navigator panel with pixel sizes and `preserve-pixel-size`; persist the
   applied pixel width only from the settled layout callback, not every pointer
   move.
4. Use the panel imperative API for focus-mode collapse and restore. Derive
   visible/hidden content from the applied panel state so pointer collapse,
   button collapse, stored state, and assistive semantics cannot diverge.
5. Keep the main panel's 500px minimum as the authoritative protection for the
   working view. Retain the current responsive cap only where it is stricter
   than that invariant.
6. Do not reproduce upstream separator behavior in tests. Product tests cover
   composition, persisted state, focus-mode semantics, and the single-divider
   contract; real browser acceptance covers pointer and keyboard resizing.

## Work

- [x] Generate and review the official `base-nova` Resizable primitive without
      allowing the CLI to replace theme CSS or existing owned primitives.
- [x] Migrate the desktop `PageSidebarLayout` composition and remove the custom
      resize event plumbing and duplicate border.
- [x] Preserve width and collapsed-state preferences across remounts, container
      resize, and custom desktop breakpoints.
- [x] Update focused tests for panel composition, single separator, collapse /
      restore, inert hidden surfaces, persisted preferences, and mobile Sheet
      non-regression.
- [x] Walk representative real-data routes in `pnpm dev` with pointer and
      keyboard at narrow, medium, and wide desktop widths in Day and Night
      palettes; verify reduced-motion behavior and browser console health.
- [x] Run root/UI typechecks, the complete Vitest suite, production UI build,
      and unsigned packaged Electron Workspace smoke.
- [x] Open and maintain one labeled autonomous Draft PR to `dev`; present it
      for maintainer acceptance without merging it from the goal.

## Verification Evidence

- Real `pnpm dev` data: Chat pointer and keyboard resizing both persisted over
  reload; focus mode stayed at 44px over reload and restored the prior expanded
  pixel width.
- Responsive acceptance: 740px used the existing mobile Sheet, 768px kept a
  500px working pane while temporarily capping the navigator, and 900/1200px
  restored the saved wider preference without overwriting it.
- Route walk: Chat, AutoQuant, Inbox, Tracked, Market, Portfolio, Automation,
  Settings, Workspaces, and Dev Panel each rendered two panels with one shared
  separator. The full-width Issues and Trading-as-Git routes remained outside
  this shell as designed.
- Appearance and access: Default Day/Auto and Windows 98 Night kept one rule;
  the separator exposed a localized accessible name and keyboard behavior;
  reduced motion removed the sidebar surface transition; browser console had
  no warnings or errors.
- Automated/build: `npx tsc --noEmit`, `cd ui && npx tsc -b`, focused sidebar
  tests, `pnpm test` (487 files, 4007 passing tests), `cd ui && pnpm build`, and
  `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron:smoke:workspace` passed.

## Verification Matrix

| Contract | Automated evidence | Real-surface evidence |
|---|---|---|
| One separator | shared layout DOM/class assertion | Inbox and Tracked visual inspection |
| Pointer resize | upstream primitive + product persistence callback | mouse/trackpad drag in Chat and Inbox |
| Keyboard resize | separator role/focus composition | focus handle and use arrow keys |
| Responsive constraints | stored/default/max-size unit cases | 740px, 900px, and 1200px widths |
| Focus mode | collapse/restore and `inert` tests | collapse, navigate, reload, restore |
| Mobile ownership | existing Sheet focus/dismissal suite | phone drawer selection and Escape |
| Theme/style profiles | semantic `data-slot` source review | Day/Night plus Windows 98 spot check |
| Desktop shell | UI/build/full suite | unsigned `electron:smoke:workspace` |

## Completion Criteria

- Expanded page navigators expose exactly one visible boundary rule and no
  dedicated blank resize column.
- Mouse, touch, and keyboard resizing work through the shared primitive without
  OpenAlice document-level resize listeners.
- Page-specific widths and focus mode survive reloads without changing their
  existing storage contract.
- The working pane never drops below its current minimum; mobile routes keep
  their existing Sheet behavior and focus return.
- All current shell consumers compile and representative real routes remain
  usable across the responsive and style-profile matrix.
- Required browser, automated, build, and unsigned Electron checks pass, and a
  single Draft PR contains the complete topic for maintainer acceptance.
