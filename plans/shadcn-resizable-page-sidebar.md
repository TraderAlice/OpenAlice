# shadcn Resizable Page Sidebar

- Status: `complete` (rapid-reversal repair included in Draft PR #1025; awaiting maintainer acceptance)
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
- The first migration increment combined the navigator's responsive maximum
  with an unconditional 500px content-panel minimum. Once the page-owned group
  became narrower than 700px after app-shell chrome, those constraints were
  impossible; a resize could leave the navigator at 100% and content at 0%.
- The repaired constraint pair exposed a second, independent state bug. In a
  real 941px Chat split group the primitive reported the navigator at its 44px
  collapsed minimum (`aria-valuenow` equalled `aria-valuemin`), while
  `PageSidebarLayout` still rendered `data-state="expanded"` and left the full
  navigator surface accessible. The expanded sidebar was therefore compressed
  into the collapsed rail instead of switching surfaces.
- Repeated narrow/wide responsive cycles exposed a delayed v4 registration
  race: the route first recovered to 200px, then a stale one-panel layout wrote
  `flex: 100` after the group's settled callback, leaving content at 0px while
  the separator still advertised the correct 33.936% maximum.
- The first overdrag implementation also started its 280ms visual cleanup while
  the pointer was still held. That timer could erase the active gesture, and a
  new press during the returning spring snapped the transformed handle away
  from the pointer before the next drag had captured it.
- A later manual stress pass found a deeper same-gesture race. `defaultSize`
  was derived from product collapse state, so every midpoint crossing changed
  a Panel registration prop. React-resizable-panels v4 unregisters and
  re-registers that Panel while the pointer is still active; rapid reversals
  could therefore strand a valid internal max beside stale `flex: 100` / `0`
  DOM styles. The collapse transition also remained armed after reversing back
  above the midpoint, allowing painted flex width to lag pointer-owned layout.
- Product pointer bookkeeping lived on the split-group element while the
  primitive finishes drags at `document`. Throwing the pointer outside the
  group could leave the product gesture ref active after the primitive had
  settled, suppressing later geometry recovery.
- `react-resizable-panels` deliberately expands the one-pixel separator into a
  10px fine-pointer and 28px coarse-pointer hit region. A pointer can begin in
  that virtual region without firing React's `pointerdown` handler on the
  separator element itself. The primitive still resizes and collapses the
  panel, but the current `userResizeRef` gate suppresses product-state sync and
  persistence. Previous browser acceptance clicked the visible one-pixel rule
  and did not cover this normal human acquisition path.

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
5. Preserve the former responsive contract as a feasible pair: keep the
   navigator at least 200px, reserve up to 500px for content, and let that
   content minimum shrink to the actual remainder when the page-owned group is
   narrower than 701px. The group must never receive contradictory minimums.
6. Do not reproduce upstream separator behavior in tests. Product tests cover
   composition, persisted state, focus-mode semantics, and the single-divider
   contract; real browser acceptance covers pointer and keyboard resizing.
7. Measure the page-owned group before applying responsive constraints. Window
   width includes app-shell chrome and is not a valid initial substitute.
8. Keep three state layers explicit and one-directional:
   - **applied geometry** is the primitive's current panel size and collapsed
     state;
   - **interactive surface** is derived from applied geometry and controls
     expanded/collapsed rendering, `aria-hidden`, and `inert`;
   - **user preference** is the last settled expanded width plus the deliberate
     focus-mode choice, persisted without being overwritten by responsive caps.
9. A pointer or keyboard interaction marker may decide whether a settled width
   becomes the next user preference, but it must never gate geometry-to-surface
   synchronization. Pointer acquisition is observed at the split-group capture
   boundary so the primitive's enlarged hit region and the visible separator
   behave identically; shadcn continues to own actual drag capture and motion.

## Responsive State Contract

| Input or transition | Applied geometry | Interactive surface | Persisted preference |
|---|---|---|---|
| Collapse button | 44px | collapsed rail only | store focus mode; retain prior expanded width |
| Expand button | responsive cap of saved width | expanded navigator only | clear focus mode; retain saved width |
| Pointer drag from visible 1px rule | primitive result | derive from result on every resize | commit settled expanded width; collapsed drag retains prior width |
| Pointer drag from 10px/28px virtual hit region | identical to visible-rule drag | identical to visible-rule drag | identical to visible-rule drag |
| Arrow/Home/End on separator | primitive result | derive from result | commit settled expanded width or focus mode |
| Container narrows while expanded | clamp to measured feasible maximum, never below 200px | remain expanded | do not overwrite the wider preference |
| Container widens again | restore saved width when feasible | remain expanded | unchanged |
| Reload in focus mode | 44px from first stable layout | collapsed rail only | unchanged |
| Reload expanded | saved width capped by current group | expanded navigator only | unchanged until user resizes |
| Viewport crosses below route breakpoint | desktop group unmounts; mobile Sheet owns navigation | no compressed desktop navigator | desktop width/focus preference unchanged |

At every settled desktop layout exactly one surface is interactive:

- `inPixels <= 45`: collapsed surface visible and interactive; expanded surface
  hidden and inert;
- `inPixels >= 200`: expanded surface visible and interactive; collapsed surface
  hidden and inert;
- no stable layout may render the expanded surface between 45px and 200px.

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
- [x] Reproduce the responsive failure in the real Chat route and identify the
      infeasible 200px navigator + 500px content minimum pair.
- [x] Make the responsive constraints feasible at every desktop group width and
      remove resize-settle state races.
- [x] Add focused constraint regression coverage for narrow, boundary, medium,
      and wide group widths.
- [x] Re-run narrow/wide drag, collapse/expand, reload, browser, full automated,
      build, and unsigned Electron acceptance on the repaired increment.

### Responsive state-consistency increment

- [x] Replace separator-element `pointerdown` authority with split-group input
      capture that covers the primitive's complete fine/coarse hit region.
- [x] Synchronize the product collapsed surface from applied panel geometry on
      every resize, independently of whether the change came from pointer,
      keyboard, button, restore, or responsive constraints.
- [x] Keep width persistence scoped to a settled user resize; prove that
      responsive caps and programmatic restore do not overwrite the user's
      wider expanded preference.
- [x] Add focused state-transition tests for geometry/surface agreement,
      collapsed-width retention, expanded-width persistence, and passive
      responsive non-persistence.
- [x] Reproduce pointer acquisition from both sides of the visible separator,
      including 2–4px offsets inside the 10px fine-pointer virtual hit region
      and wider coarse-pointer acquisition, then verify the same contract with
      keyboard Home/End/Arrow input.
- [x] Exercise desktop widths around the route breakpoint and the 701px
      feasibility boundary, then round-trip narrow -> wide -> narrow with both
      expanded and focus-mode preferences.
- [x] Re-walk Chat, Inbox, Tracked, Settings, AutoQuant, and one dense shell
      route in Default Day/Night plus Windows 98; verify reduced-motion,
      console health, focus order, and exactly one interactive surface.
- [x] Re-run root/UI typechecks, focused and full Vitest, UI production build,
      and unsigned Electron Workspace smoke before updating Draft PR #1025.

### Collapse-motion follow-up

- [x] Measure the real 200px-to-44px threshold transition in `pnpm dev` rather
      than inferring motion from classes; the pre-change route sampled 44px at
      every 20ms interval and therefore had no spatial transition.
- [x] Keep ordinary pointer resizing unanimated and arm width motion only while
      approaching the discrete collapse threshold, plus explicit button and
      keyboard collapse actions.
- [x] Use the shared 180ms motion token and the product-owned group seam rather
      than styling react-resizable-panels' nested content wrapper.
- [x] Add motion-arming regression coverage and verify reduced-motion fallback.
- [x] Re-run real browser sampling, focused/full tests, typechecks, and UI build
      before pushing the follow-up commit to Draft PR #1025.

### Resisted-overdrag follow-up

- [x] Keep direct resizing cursor-attached above 200px, then hold primitive
      layout at the expanded minimum while presenting a damped visual overdrag.
- [x] Keep the navigator's internal content at its 200px layout width so the
      transient gesture clips content rather than squeezing controls and text.
- [x] Require a deliberate raw pointer overdrag before collapse; release below
      that boundary must spring back to 200px without changing focus mode.
- [x] Preserve button and keyboard collapse behavior, pointer-cancel recovery,
      width persistence, and reduced-motion behavior.
- [x] Add focused state/motion regressions and measure both return and commit
      trajectories in the real `pnpm dev` Chat route.

### Repeat-cycle state-machine repair

- [x] Reproduce the delayed 100% navigator / 0px content layout in the real
      in-app browser and distinguish it from persisted width corruption.
- [x] Remove duplicate pointer fallback, button, and effect geometry calls so
      every collapse or restore has one owner and one primitive transaction.
- [x] Move overdrag cleanup to pointer release; cancel and visually freeze an
      interrupted spring before a new drag begins.
- [x] Reject impossible geometry in both the settled group callback and the
      later Panel resize callback, then restore the last valid pixel preference
      without persisting the 100% layout.
- [x] Add focused regressions for eight collapse/restore cycles, interrupted
      spring timers, and both immediate and delayed impossible layouts.
- [x] Verify ten repeated resisted drags, ten drag-collapse/drag-reopen cycles,
      and ten narrow/wide responsive cycles in the real Chat route.
- [x] Re-run complete typecheck, Vitest, UI build, and unsigned Electron smoke;
      update Draft PR #1025 with the repaired evidence.

### Rapid-reversal registration repair

- [x] Preserve the user's full-screen failure before reload and confirm a
      940px / 0px painted flex pair beside a still-valid 33.936% separator max.
- [x] Keep `defaultSize` stable for each mounted primitive group so midpoint
      crossings cannot unregister and rebuild Panels during a held gesture.
- [x] Remove collapse flex transition immediately when the held pointer
      reverses above the midpoint; start its cleanup timer only after release.
- [x] Capture the pointer on the product split group so movement and release
      outside its bounds cannot strand product gesture state.
- [x] Observe both painted flex items independently from the primitive store;
      rebuild the group from the last valid preference when DOM geometry is
      impossible instead of issuing an internal resize that may be a no-op.
- [x] Add focused coverage for stable registration defaults, held reversal,
      pointer capture/release, and store-valid / DOM-invalid recovery.
- [x] Re-run full automated, browser, build, and unsigned Electron verification
      and update Draft PR #1025.

## Verification Evidence

- Real `pnpm dev` data: Chat pointer and keyboard resizing both persisted over
  reload; focus mode stayed at 44px over reload and restored the prior expanded
  pixel width.
- Previous responsive acceptance missed the page-owned group width after app
  chrome. The reopened regression was reproduced with the navigator at 940px
  and content at 0px in a 941px group. After repair, the same group recovered
  to 319px / 621px, a real pointer drag persisted 268px over reload, and a
  collapsed-state reload restored 44px before expanding back to 268px.
- A temporary viewport acceptance shell loaded the real `pnpm dev` route (not
  demo data): 740px used the mobile Sheet; a 768px viewport produced a 708px
  split group with a feasible 207px navigator + 500px content pair; narrowing,
  collapsing to 44px, expanding to the responsive cap, and returning to a
  1200px viewport restored the untouched 260px preference.
- Route walk: Chat, AutoQuant, Inbox, Tracked, Market, Portfolio, Automation,
  Settings, Workspaces, and Dev Panel each rendered two panels with one shared
  separator. The full-width Issues and Trading-as-Git routes remained outside
  this shell as designed.
- Appearance and access: Default Day/Auto and Windows 98 Night kept one rule;
  the separator exposed a localized accessible name and keyboard behavior;
  reduced motion removed the sidebar surface transition; browser console had
  no warnings or errors.
- Automated/build: `npx tsc --noEmit`, `cd ui && npx tsc -b`, focused sidebar
  tests, `pnpm test` (487 files, 4008 passing tests), `cd ui && pnpm build`, and
  `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron:smoke:workspace` passed.
- State-consistency reproduction and repair used the live `pnpm dev` Chat
  route. Before the repair, a 941px group exposed a 44px navigator with
  `data-state="expanded"`; after the repair, Home produced 44px with only the
  collapsed surface interactive, reload retained 44px, and Expand restored
  the prior 294px preference. ArrowRight then settled at 319px and a second
  reload restored exactly 319px rather than the previous painted width.
- The same live-runtime geometry/ARIA/inert invariant passed on Chat (319px),
  Inbox (200px), Tracked (257px), Settings (200px), AutoQuant (218px), and
  Automation Runs (220px), each with exactly one separator. Focused state tests
  cover fine-pointer acquisition 3px beside the rule, a 12px coarse-pointer
  acquisition, passive responsive caps, collapsed-width retention, and the
  pre-paint keyboard-width race.
- Final hardening checks passed on 2026-08-08: root and UI typechecks; 12
  focused sidebar tests; the complete Vitest suite (487 files, 4014 passing
  tests); UI production build; and unsigned packaged Electron Workspace smoke
  including its managed Pi acceptance flow.
- Collapse-motion browser sampling first proved the existing snap had no
  intermediate frame: every 20ms sample went directly from 200px to 44px. The
  follow-up samples now read 200 -> 128 -> 94 -> 72 -> 59 -> 52 -> 48 -> 46 ->
  45 -> 44px over the shared 180ms token, while ordinary expanded resizing
  retains a zero-second transition. Reload after the animation stayed at 44px
  and the collapsed interactive surface remained authoritative.
- Final motion checks passed on 2026-08-08: root/UI typechecks, 14 focused
  sidebar tests, the complete Vitest suite (487 files, 4016 passing tests), and
  the UI production build. The regression also proves distant pointer movement
  does not arm motion, the 24px approach zone does, and reduced-motion button
  collapse bypasses both animation frames.
- Resisted-overdrag acceptance used CDP pointer events against the live Chat
  route so geometry could be measured while the pointer remained down. A raw
  40px pull beyond the 200px minimum produced 22.133px of visual displacement,
  while both the primitive panel and its internal content stayed exactly
  200px. Release returned the separator through 338.63 -> 344.77 -> 350.78 ->
  351.92px, made one sub-pixel overshoot, and settled back at 352px without
  entering focus mode.
- The collapse boundary is the primitive's native `(200 - 44) / 2 = 78px`
  midpoint rather than a second product threshold. Crossing it blended the
  damped preview into the existing spatial collapse, sampled 128.13 -> 58.97
  -> 47.61 -> 45.52 -> 44.13 -> 44px, and changed the interactive product
  surface only when applied geometry reached the collapsed width. Reload kept
  44px; Expand restored 200px; explicit button collapse still reached 44px.
- Final overdrag checks passed on 2026-08-08: 19 focused sidebar tests, root and
  UI typechecks, the complete Vitest suite (488 files, 4021 passing tests, 9
  skipped), UI production build, and unsigned packaged Electron Workspace
  smoke. Browser acceptance also covered pointer cancel and emulated
  `prefers-reduced-motion: reduce`, which clears the overdrag immediately.
- Repeat-cycle repair acceptance first reproduced the delayed failure as a
  940px navigator / 0px content layout with `flex: 100`, while persisted Chat
  width remained a valid 200px. The repaired route held 200px / 740px through
  ten drag-collapse/drag-reopen cycles and ten 800px/1093px responsive cycles,
  then remained stable through a further 1.5-second delayed-write window.
  Ten independent resisted drags each produced the same 23.596px displacement;
  a returning spring interrupted after 50ms remained resisted after a 350ms
  hold instead of being erased by the previous cleanup timer.
- Final repeat-cycle checks passed on 2026-08-08: 23 focused sidebar tests,
  root/UI typechecks, the complete Vitest suite (488 files, 4025 passing tests,
  9 skipped), UI production build, and unsigned packaged Electron Workspace
  smoke with managed Pi acceptance.
- Rapid-reversal acceptance preserved the user's second failure before reload:
  a 941px group painted the navigator/content at 940px/0px (`flex: 100`/`0`)
  while the separator still advertised a valid 33.936% maximum. After repair,
  one held gesture survived 80 alternating left/right crossings and returned to
  200px/740px. Twenty more gestures threw the pointer outside the split group
  twice per gesture and returned with clean gesture/motion state. Twelve settled
  reversal-collapse/restore cycles produced exactly 44px/896px then
  200px/740px every time.
- Final rapid-reversal checks passed on 2026-08-08: 26 focused sidebar tests;
  root/UI typechecks; the complete Vitest suite (488 files, 4028 passing tests,
  9 skipped); production build; and unsigned packaged Electron Workspace smoke
  with managed Pi acceptance.

## Verification Matrix

| Contract | Automated evidence | Real-surface evidence |
|---|---|---|
| One separator | shared layout DOM/class assertion | Inbox and Tracked visual inspection |
| Pointer resize | upstream primitive + product persistence callback | mouse/trackpad drag in Chat and Inbox |
| Enlarged hit target | group-capture and state-transition regression | start mouse drags 2–4px on either side of the one-pixel rule; cover the wider coarse target separately |
| Keyboard resize | separator role/focus composition | focus handle and use arrow keys |
| Responsive constraints | feasible-pair sweep from 201–1600px plus boundary cases | real 740px mobile, 708px split-group, 941px split-group, and 1200px viewport paths |
| Geometry/surface agreement | collapsed/expanded state-transition assertions | inspect applied panel pixels, `data-state`, `aria-hidden`, and `inert` together |
| Preference isolation | passive-cap and settled-user-resize assertions | narrow/wide/reload round trip without preference drift |
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
- Applied geometry and rendered interaction state cannot diverge: a 44px panel
  always exposes only the collapsed rail, and an expanded surface never renders
  below the 200px navigator minimum.
- Visible-rule, adjacent fine-pointer, coarse-pointer, and keyboard resize paths
  produce the same settled state and preference behavior.
- The working pane keeps its 500px minimum whenever geometry permits and gets
  the measured remainder beside the 200px navigator below that boundary;
  mobile routes keep their existing Sheet behavior and focus return.
- All current shell consumers compile and representative real routes remain
  usable across the responsive and style-profile matrix.
- Required browser, automated, build, and unsigned Electron checks pass, and a
  single Draft PR contains the complete topic for maintainer acceptance.
