# OpenAlice Supervisor TUI Experience

Status: Active

Related issues: None

Owner guides: [[docs/cli-supervisor.md]], [[docs/cli-installer.md]]

## Goal

Turn the Shell Supervisor from a keyboard-shortcut status report into a polished,
mouse-capable OpenAlice control surface. Oh My Pi is the interaction and finish
benchmark: use its proven terminal patterns and MIT-licensed implementation ideas
where they fit, while preserving OpenAlice's Runtime, Machine, and AliceProject
product boundary.

This initiative stays on `codex/tui-usability` until the maintainer reviews the
complete experience. It does not open or merge a `dev` PR before that acceptance.

## Scope

- `packages/cli/src/supervisor-tui*.ts`, `supervisor-fleet.ts`, and focused TUI
  tests own the product changes.
- Package metadata, distribution manifests, and third-party notices may change
  only when required to ship the TUI implementation safely.
- Runtime lifecycle operations remain presentation-neutral. Alice, UTA, Web UI,
  Workspace agent loops, persisted state, and trading behavior are out of scope.

## Design Alternatives

### 1. Reskin the existing string renderer

Add ANSI colors, borders, and glyphs without changing navigation or input. This
is the fastest route to a prettier screenshot, but leaves the shortcut wall,
weak focus model, and discontinuous action feedback intact. Rejected as the end
state; useful only as an incremental implementation technique.

### 2. Replace `@earendil-works/pi-tui` with current `@oh-my-pi/pi-tui`

This gives OpenAlice the closest upstream implementation, including current
mouse, overlay, tab, scroll, and differential-rendering work. The current OMP
package requires Bun and its utility layer pulls platform-native packages, while
the OpenAlice CLI remains a Node-compatible distributed entrypoint. Rejected for
this initiative because it expands runtime and packaging ownership beyond TUI.

### 3. Port OMP interaction primitives into a Node-compatible OpenAlice layer

Keep the existing renderer/runtime dependency, add focused semantic styling,
mouse parsing/routing, alternate-screen lifecycle, hit testing, scroll models,
and reusable Supervisor components based on OMP's proven patterns. Preserve MIT
attribution for adapted substantial code. Selected because it moves toward the
requested experience without changing the CLI runtime contract.

The selected route is an autonomous design choice made for this topic; it does
not imply maintainer approval of the finished interaction.

## Interaction Model

- Keyboard and mouse are equal inputs over one focus and action model.
- Pointer hover communicates the target; click selects or activates according
  to the same rule as keyboard focus plus Enter; wheel scrolls the pane under
  the pointer.
- Tabs, lists, primary actions, dialogs, and scrollable diagnostics expose clear
  hit areas. Shortcuts remain accelerators rather than the only discovery path.
- Every asynchronous action visibly progresses through started, working,
  succeeded, or recoverable-failure states without stealing selection.
- The Supervisor uses an alternate-screen application canvas and restores the
  terminal, cursor, and mouse modes on every normal and signal-driven exit.

### Overview composition decision

- Extending the existing stacked cards with more decoration would preserve a
  low-density status-report layout, so it is not the selected direction.
- A single-column command center would improve narrow terminals but continue to
  waste wide terminal space.
- The selected model is a responsive cockpit: at 100 columns and wider,
  AliceProject identity/guidance/action and Runtime telemetry occupy balanced
  side-by-side cards; below that threshold the same fields fold into the
  complete vertical flow. This is an autonomous topic decision, not recorded
  maintainer approval.

### Global command discovery decision

- Restyling the legacy detach hint would improve finish but not discoverability.
- Expanding Help would keep actions inside a passive keyboard manual.
- The first selected model was a persistent clickable command dock plus a
  contextual static Command Deck opened with `/`. It improved discovery but
  remained a shortcut reference rather than an interactive control.

### Command palette interaction decision

- Keeping the static Command Deck would preserve a readable reference but leave
  keyboard focus, row hover, wheel selection, and whole-row pointer activation
  absent.
- Embedding the installed `@earendil-works/pi-tui` SelectList directly would
  split layout and pointer ownership between the Supervisor screen and a
  dependency version that lacks OMP's current mouse-routing contract.
- The selected model is a focused OpenAlice Command Palette projection inspired
  by OMP SelectList: contextual commands, stable selection, full-row hit zones,
  keyboard wrapping, clamped wheel movement, hover feedback, and click-to-run.
  Every activation feeds the existing Supervisor key/action state machine, so
  confirmation, refusal, recovery, and detach semantics remain single-owned.
- Rendering that Palette in place of the active page still made command
  discovery a route replacement and discarded the user's visual context. The
  final selected model therefore follows OMP's menu-controller pattern: a
  centered compositor overlay owns focus while the current page, action bar,
  activity slot, and context ribbon retain their exact geometry underneath.
  Closing restores the same page; activation closes the Palette before opening
  a child overlay or confirmation modal, so overlay ownership never forks.

### Runtime log presentation decision

- Coloring raw JSON would leave the event message behind long metadata and
  terminal clipping.
- Requiring every line to parse as OpenAlice JSON would hide valid third-party
  and legacy plain-text output.
- The selected model is best-effort semantic projection: recognized JSON puts
  severity, time, message, and compact context first; all other lines retain a
  sanitized plain-text fallback. The bounded snapshot edge is named `LATEST`,
  not the misleading `LIVE TAIL`.

### Runtime log filtering decision

- Leaving the semantic log panel unfiltered keeps the implementation small but
  still makes operators scan routine events for the few lines that need action.
- Adding a backend severity query would widen the Logs contract and risk
  different keyboard/mouse views reading different data.
- The selected model filters the already loaded bounded, redacted snapshot in
  memory. `f` and its clickable keycap cycle All, Attention, and Errors while
  preserving original source line numbers; the navigation badge continues to
  report the complete loaded snapshot.

### Operational navigation decision

- Static route labels are simple but require opening every page to discover
  inventory, loaded logs, or diagnostic attention.
- Color-only dots would be ambiguous and violate the no-color contract.
- The selected model adds compact textual/glyph badges to the existing tabs:
  Machine and loaded-log counts plus Doctor pass/warn/fail state. Badges extend
  the original pointer target and do not introduce separate controls.

### Segmented navigation-rail decision

- Recoloring the existing flat labels would preserve geometry but leave the
  most persistent line of the application looking like a legacy CLI menu.
- An icon-only rail would be compact and visually louder, but it would make
  first-use navigation and no-color output depend on memorized symbols.
- The selected model is a single-height, full-width segmented surface: stable
  glyph plus label on ordinary terminals, progressively shorter labels on
  narrow terminals, and brackets retained as the semantic selected state.
  Rendered segments and pointer targets come from one layout primitive, so
  asynchronous Machine, Logs, and Doctor badges cannot desynchronize clicks.

### Doctor inspector decision

- Keeping Doctor as a flat list of summary/detail text preserves the old output
  order but makes evidence compete with check identity and turns navigation into
  anonymous line scrolling.
- Toggling detail under each check would reduce initial density but make row
  heights unstable and mouse hit testing dependent on every expanded neighbor.
- The selected model follows OMP's list-detail inspector: checks are stable
  selectable rows, the first failure (then warning) receives initial focus, and
  the selected check owns a separate evidence pane. Wide terminals use parallel
  checklist/Inspector cards; 80-column and narrow terminals stack the same two
  regions. All evidence remains the existing read-only Doctor snapshot.

### Help Control Atlas decision

- Restyling the grouped keyboard map would make the shortcut wall prettier but
  leave every command equally prominent and give mouse users nothing to
  explore.
- Reusing the Command Palette would make Help executable, but duplicate a
  surface optimized for speed rather than understanding and context.
- The selected model follows OMP's selectable list/detail language: Navigation,
  Runtime, and AliceProject are stable focus groups, while the selected group
  owns a purpose statement and unambiguous clickable keycaps. Wide terminals
  split the atlas and inspector; 80-column and narrow terminals stack the same
  state. Recovery projects only safe update and detach groups. Arrow/Home/End,
  wheel, hover, and whole-row click all update one shared selection.

### Overlay pointer parity decision

- Leaving overlays keyboard-only would make pointer support disappear exactly
  when a user enters Setup, project selection, update, source, or transfer work.
- Patching each overlay with fixed terminal coordinates would couple interaction
  to today’s copy, wrapping, and responsive height.
- Replacing the locked `pi-tui` dependency for its newer mouse-aware components
  would cross the Node distribution boundary rejected above. The selected model
  is therefore a shared Supervisor compatibility router: it mirrors the
  compositor’s resolved overlay origin, captures final rendered rows/keycaps,
  and adapts hover, wheel, and click into each existing component’s keyboard
  state machine. No lifecycle or configuration action gains a second path.

### Persistent context-ribbon decision

- Expanding the animated brand header would make version/update presentation
  compete with operational identity.
- Adding a separate status row would preserve those concerns but consume one of
  the 80x24 baseline's scarce content rows.
- The selected model upgrades the existing bottom dock into an OMP-inspired
  full-width context ribbon. Commands and Detach stay left; the selected
  AliceProject, compact Runtime signal, and current view stay right according
  to available width. The project segment exposes its existing `i` action as a
  visible clickable keycap. This keeps identity present in Logs, Doctor, Fleet,
  Help, and the Command Palette without adding a route or backend read.

### Fixed activity-slot decision

- Keeping the existing append-only feedback stack makes Working, Notice, and
  Error insert one or more rows between content and controls, so action targets
  move while the user is operating them.
- A transient overlay toast would preserve layout but cover content, introduce
  dismissal/timer ownership, and split feedback from keyboard users.
- The selected model reserves the existing separator row as one fixed activity
  slot. Working wins while an operation is active, otherwise Error wins over
  Notice; idle renders the same-width blank separator. Feedback content and
  tone still come from the existing snapshot, but action bar and context ribbon
  never change rows merely because feedback appears.

### Confirmation-modal decision

- Keeping confirmation cards inline preserves the original implementation but
  changes the main frame height, moves controls, and makes impact copy compete
  with the operational page it is protecting.
- Replacing confirmation with a transient toast would keep layout stable but
  weaken explicit consent and make keyboard focus ambiguous for destructive
  Runtime actions.
- The selected model follows OMP's stable dialog composition: lifecycle,
  managed-source, and update confirmation is a centered compositor overlay over
  an unchanged application frame. The modal owns a bounded width, explicit
  Impact section, primary Enter action, secondary Esc action, pointer hover and
  click, while forwarding acceptance into the existing confirmation state
  machine. Acceptance closes the modal before the fixed activity slot reports
  work; cancellation changes no Runtime or configuration state.

## Responsive and Accessibility Contract

- `80x24` remains the minimum full experience. Wide terminals show the
  Machine/AliceProject split view; narrow terminals drill into one pane without
  losing selection or the primary action.
- Render width uses Unicode display width and ANSI-aware truncation. Resize must
  not move focus or reset scroll windows.
- `NO_COLOR` and `TERM=dumb` disable decorative color without hiding meaning.
  State always has text or glyph semantics in addition to color.
- `OPENALICE_TUI_MOUSE=0` disables terminal mouse reporting. Every pointer action
  has a keyboard equivalent, and exit always restores native terminal selection.
- Motion is limited to purposeful progress/status frames and can be disabled;
  no information depends on animation.

## Shared Primitive Ownership

Reusable terminal styling, layout, hit-region, pointer, badge, panel, toast,
progress, and command-bar behavior belongs in focused
`packages/cli/src/supervisor-tui-*.ts` modules. Feature panels consume those
primitives instead of embedding more raw ANSI or mouse-coordinate logic in the
already large `supervisor-tui.ts` application controller.

## Ordered Work

- [x] Audit the current Supervisor, current OMP TUI package, license, runtime,
  distribution dependencies, and select the implementation route.
- [x] Add the semantic theme, application frame, panels, status badges, command
  bar, notice treatment, and ANSI-safe width utilities.
- [x] Add alternate-screen lifecycle, SGR pointer parsing, hover/click/wheel
  routing, and terminal restoration tests.
- [x] Rebuild Fleet with pointer-aware responsive panes, clear primary actions,
  and stable selection/scroll behavior.
- [x] Rebuild Overview as the selected AliceProject's operational home rather
  than a flat field dump.
- [x] Upgrade Logs and Doctor with scroll/follow/filter or actionable diagnostic
  presentation inside the existing read-only contracts.
- [x] Upgrade Help, Setup, Project selection, Update, source, and transfer flows
  to consistent overlays and dialogs.
- [x] Dogfood the real `pnpm cli` surface across wide, 80x24, and narrow sizes;
  inspect mouse, resize, copy/selection, signal exit, and failure recovery.
- [x] Run the owning package typecheck and tests, affected tests, full hermetic
  tests at dependency/shared-renderer boundaries, and installer/package smoke
  when the distributed payload changes.
- [x] Replace the plain Working/Notice/Diagnostic tail with a semantic,
  full-width activity rail and purposeful OMP-inspired busy animation.
- [x] Add a bounded one-shot entrance treatment and subtle Runtime heartbeat;
  preserve the static reduced-motion frame as the complete experience.
- [x] Turn Overview into a responsive AliceProject/Runtime cockpit without
  changing lifecycle action semantics or sacrificing the 80x24 baseline.
- [x] Replace the legacy global shortcut hint with a clickable command dock and
  contextual `/` Command Deck.
- [x] Project structured Runtime logs into semantic event rows while preserving
  bounded, redacted plain-text fallback behavior.
- [x] Turn the global tabs into an operational navigation rail with inventory,
  log, and diagnostic status visible before opening each page.
- [x] Promote the operational tabs into a full-width segmented surface with
  responsive labels and render-derived hover/click geometry.
- [x] Add local severity views to Runtime Logs without widening the bounded
  reader or changing the snapshot contract.
- [x] Replace the static Command Deck with a contextual, selectable, whole-row
  mouse-capable Command Palette.
- [x] Replace Doctor's flat line scroller with a responsive, selectable
  checklist and detail Inspector.
- [x] Replace Help's static shortcut wall with a responsive, pointer-aware
  Control Atlas while keeping the Command Palette as the fast execution path.
- [x] Give every Supervisor overlay list, input, and visible command keycap the
  same pointer semantics as the application frame.
- [x] Turn the bottom command dock into a persistent, pointer-aware
  AliceProject/Runtime/view context ribbon.
- [x] Replace expanding feedback rows with a stable single-line activity slot.
- [x] Replace inline confirmation cards with stable, focused compositor modals.
- [x] Promote the Command Palette from page replacement to a focused overlay.

## Progress

- The first implementation increment added the Node-compatible semantic theme,
  alternate-screen and SGR mouse lifecycle, pointer parser, hoverable/clickable
  top navigation, Fleet wheel routing, and exit restoration coverage.
- The ordinary launch now enters Overview and renders a selected-AliceProject
  status card plus a compact Runtime card. Fleet remains available as a
  management page instead of defining the first-run information architecture.
- Fleet now uses responsive bordered Machine and AliceProject panes, compact
  textual status glyphs, a persistent Selection inspector, hoverable rows, and
  click-to-select/focus followed by click-to-activate semantics. Its command bar
  shows only the primary and adjacent actions instead of the historical full
  shortcut wall. Pane titles expose the visible selection position, and
  externally owned Runtimes use human-facing labels without advertising refused
  Stop or Restart actions.
- The rebuilt Fleet was exercised against the real Default AliceProject at
  80x24 with two Machines and six local AliceProjects. Raw SGR hover and click
  selected the Railway Machine, and detach restored cursor, mouse, bracketed
  paste, and alternate-screen modes.
- Focused screen/pointer specs, all 18 real-PTY workflows, CLI build/typecheck,
  and the repository suite pass through the completed Fleet increment.
- Runtime Logs now render as a numbered bounded snapshot with range position,
  live-tail state, keyboard paging, End-to-latest, mouse-wheel navigation, and a
  contextual reload bar. Doctor renders its summary and checks as semantic
  pass/warn/fail rows with the same keyboard and pointer scroll model.
- Help is now a grouped keyboard map with its own contextual footer. Update,
  Setup, AliceProject selection, and Remote Transfer share the bordered panel
  primitive plus OMP-style selected rows, muted descriptions, and warning
  states. Runtime Source and lifecycle/update confirmations now use the same
  framed cards and contextual keycaps. Their existing PTY-driven input,
  validation, and recovery state machines remain intact.
- Visible keycaps now derive responsive, Unicode-display-width hit regions from
  the final rendered frame. Pointer hover gives direct affordance feedback and
  clicks feed the existing keyboard state machine, including confirmation and
  detach behavior. A real 80x24 Default AliceProject run clicked Overview Help
  and then Help Detach; teardown restored cursor, mouse, bracketed-paste, and
  alternate-screen modes.
- Final real-surface dogfood covered 120x36, 80x24, 52x20, and 46x24 frames.
  Live resize from narrow Fleet drill-down to a 100-column dual pane and back
  preserved focus and the selected AliceProject. The exercise caught and fixed
  a stale 80-column divider cap plus an update notice that had been appended
  beyond the clipped header. Ctrl+C restored every terminal mode; the
  `TERM=dumb`, `NO_COLOR=1`, `OPENALICE_TUI_MOUSE=0` path retained the complete
  keyboard surface without alternate-screen or mouse reporting. Host-terminal
  drag selection is outside PTY automation; keyboard-only mode is the verified
  selection escape hatch.
- Final verification passes with the CLI build/typecheck, root TypeScript
  check, all 50 focused Supervisor screen and real-PTY cases, and the 684-file
  repository suite (683 passed, 1 skipped; 6058 tests passed, 10 skipped).
  Installer/package smoke is not applicable because this branch does not change
  the distributed payload topology.
- Continuous polish now gives asynchronous operations a shared activity rail:
  Braille spinner frames for work, stable STATUS/READY/NOTICE/ERROR roles for
  results, and dark semantic backgrounds in color-capable terminals. A real
  Default AliceProject Doctor run displayed multiple busy frames before the
  result panel; `OPENALICE_TUI_MOTION=0` displayed the same state as a static
  `◆ WORKING` rail. The new module is part of the CLI package payload, so this
  continuation requires the installer smoke before its own acceptance.
- Activity-rail acceptance passes: 54 focused feedback/screen/real-PTY tests,
  CLI build/typecheck, root TypeScript check, and the 685-file repository suite
  (684 passed, 1 skipped; 6062 tests passed, 10 skipped). The Docker installer
  smoke passed, and `pnpm pack --dry-run --json` confirms the new feedback module
  is present in the published CLI file set. The 80 ms motion timer now exists
  only while `busy` is true and is torn down on completion, reduced motion,
  detach, signal exit, and TUI startup failure.
- A nine-frame brand-color entrance now settles in under a second, after which
  no intro timer remains. Successful Runtime probes drive a low-frequency
  `●`/`◉` heartbeat without changing status text. Real Fleet acceptance against
  Railway Beta / Main Cloud exposed and fixed a pre-existing selection bug:
  the local Runtime poll no longer snaps a remote Machine/Project inspection
  back to the selected local AliceProject. Repeated live probes preserved the
  remote pane focus while repainting only Main Cloud's running glyph; a focused
  runSupervisorTui regression covers the same boundary.
- Entrance/heartbeat acceptance passes with 56 focused feedback, screen, and
  real-PTY tests, CLI build/typecheck, root TypeScript check, and the 685-file
  repository suite (684 passed, 1 skipped; 6064 tests passed, 10 skipped). The
  Docker installer smoke also passes for the updated distributed CLI payload.
- Overview now uses a 52:48 AliceProject/Runtime telemetry cockpit at 100
  columns and wider, plus a full-width Home context rail. The project card keeps
  both guidance lines and the complete Enter action; the telemetry card keeps
  provider identity width-aware without exposing the managed Runtime path.
  Real 100x30 and 80x24 runs confirmed the responsive transition, complete
  baseline content, and terminal restoration after detach.
- Cockpit acceptance passes with 58 focused screen, Fleet, and real-PTY tests,
  CLI build/typecheck, root TypeScript check, and the 685-file repository suite
  (684 passed, 1 skipped; 6064 tests passed, 10 skipped). The Docker installer
  smoke also passes for the changed distributed TUI payload.
- The legacy detach sentence is now a persistent command dock with clickable
  Commands and Detach keycaps plus page context. `/` opens a compact Command
  Deck that groups the existing primary, observe, manage, and navigation
  actions; visible keycaps route into the original keyboard state machine.
  Real 80x24 acceptance opened and closed the deck by keyboard and raw SGR
  clicks, then detached by clicking `[ q ]` with complete terminal restoration.
- Command Deck acceptance passes with 59 focused screen, Fleet, and real-PTY
  tests, CLI build/typecheck, root TypeScript check, and the 685-file repository
  suite (684 passed, 1 skipped; 6065 tests passed, 10 skipped). The Docker
  installer smoke also passes for the changed distributed TUI payload.
- Runtime Logs now recognize OpenAlice JSON events and lead with a semantic
  glyph, line number, UTC clock time, message, and compact context; unrecognized
  plugin and Guardian output stays sanitized plain text. The snapshot edge is
  truthfully labeled `LATEST`. A real 100x30 log snapshot confirmed that event
  messages survive clipping, Up leaves the edge, End returns to it, and detach
  restores the terminal.
- Semantic-log acceptance passes with 59 focused screen, Fleet, and real-PTY
  tests, CLI build/typecheck, root TypeScript check, and the 685-file repository
  suite (684 passed, 1 skipped; 6065 tests passed, 10 skipped). The Docker
  installer smoke also passes for the changed distributed TUI payload.
- The navigation rail now surfaces Machine and loaded-log counts plus Doctor
  pass/warn/fail state using compact glyph badges that remain meaningful without
  color. Real 100x30 acceptance observed `Machines·2`, then `Logs·42`, then
  `Doctor!4` as each background result arrived; raw SGR clicks continued to hit
  tabs after each width change, including the Machine badge edge.
- Operational-navigation acceptance passes with 59 focused screen, Fleet, and
  real-PTY tests, CLI build/typecheck, root TypeScript check, and the 685-file
  repository suite (684 passed, 1 skipped; 6065 tests passed, 10 skipped). The
  Docker installer smoke also passes for the changed distributed TUI payload.
- Runtime Logs now own their semantic projection in a focused frontend module.
  The `f` key and clickable footer keycap cycle All, Attention, and Errors over
  the loaded snapshot, retain original line numbers, reset to the latest edge,
  and render an explicit healthy empty state. Parsed projection is cached per
  snapshot so repeated redraws do not reparse up to 5,000 JSON lines. Real
  80-column acceptance caught and corrected a wrapping footer label; raw SGR
  clicks then cycled through both empty severity views and keyboard input
  returned to All before detach restored the terminal.
- Log-filter acceptance passes with 62 focused screen, Fleet, log-module, and
  real-PTY tests, CLI build/typecheck, root TypeScript check, and the 686-file
  repository suite (685 passed, 1 skipped; 6068 tests passed, 10 skipped). The
  Docker installer smoke passes, and `pnpm pack --dry-run --json` confirms the
  new log presentation module is present in the published CLI file set.
- The `/` surface is now a true Command Palette rather than a shortcut card.
  Commands are contextual to Runtime/recovery state and use an OMP-inspired
  primary/description/group/shortcut layout. Up/Down wraps selection, the wheel
  clamps it, pointer motion highlights the full row, a click selects and runs,
  and direct shortcuts remain available. The dock changes to `Close palette`
  while open. Real 80-column acceptance hovered Setup, moved selection with a
  raw SGR wheel event, clicked Setup into the existing overlay, then used `l`
  inside the reopened Palette to enter Logs; detach restored terminal modes.
- Command-Palette acceptance passes with 65 focused screen, Fleet, Palette,
  log-module, and real-PTY tests, CLI build/typecheck, root TypeScript check, and
  the 687-file repository suite (686 passed, 1 skipped; 6071 tests passed, 10
  skipped). The Docker installer smoke passes, and
  `pnpm pack --dry-run --json` confirms the new Palette module is included in
  the published CLI file set.
- Doctor is now a list-detail inspector rather than a flat text report. It
  selects the first failure, otherwise the first warning; Up/Down wraps, page
  keys and wheel clamp, Home/End jump to boundaries, pointer motion highlights
  the full check row, and click selects it. The Inspector separates summary,
  existing evidence, and conservative status guidance without adding commands
  or reads. Real 80-column acceptance navigated a seven-check report through
  keyboard, End, hover, click, and wheel; real 120x30 acceptance rendered all
  seven checks beside the selected evidence and switched to the actual stopped-
  Runtime start guidance by raw SGR click. Both sessions restored terminal modes.
- Doctor-inspector acceptance passes with 68 focused screen, Fleet, Doctor,
  Palette, log-module, and real-PTY tests, CLI build/typecheck, root TypeScript
  check, and the 688-file repository suite (687 passed, 1 skipped; 6074 tests
  passed, 10 skipped). The Docker installer smoke passes, and
  `pnpm pack --dry-run --json` confirms the new Doctor view module is included
  in the published CLI file set.
- Overlay pointer input no longer disappears behind the application frame.
  One shared compatibility router mirrors `pi-tui` center/margin/max-height
  placement, captures final list rows and rendered keycaps, and translates
  hover, wheel, and click into the existing component input path. Update
  Channel, Setup (including input submenus), AliceProjects creation, Runtime
  Source, and every Remote Transfer phase use it; the workflows retain their
  original validation, confirmation, and failure ownership.
- Overlay-pointer acceptance passes with 80 focused screen, overlay, Fleet,
  Doctor, Palette, transfer, and real-PTY tests. A real 80x24 session sent raw
  SGR motion/click events into centered Setup, changed Editing from the current
  AliceProject to Machine defaults, closed the overlay, detached, and restored
  terminal modes. CLI build/typecheck, root TypeScript, and the 689-file suite
  pass (688 passed, 1 skipped; 6079 tests passed, 10 skipped). Docker installer
  smoke passes, and the package dry-run contains
  `src/supervisor-overlay-pointer.ts`.
- The bottom command dock is now an OMP-inspired full-width context ribbon.
  It keeps Commands and Detach stable, adds a clickable `[ i ]` AliceProject
  identity plus compact Runtime signal from 60 columns upward, and adds the
  active view when space permits. Long Unicode project names shrink before the
  signal; sub-60 terminals retain both essential controls. Color-capable
  terminals paint the complete ribbon on a dark brand surface and preserve that
  surface around a hovered keycap.
- Context-ribbon acceptance passes with 82 focused screen, overlay, Fleet,
  Doctor, Palette, transfer, and real-PTY tests. A real 80x24 color session
  verified the full background escape, sent raw SGR motion/click events to the
  ribbon's project keycap, opened the existing AliceProjects overlay, and
  restored terminal modes after close/detach. CLI build/typecheck, root
  TypeScript, and the 689-file suite pass (688 passed, 1 skipped; 6081 tests
  passed, 10 skipped). Docker installer smoke also passes.
- Feedback now occupies one fixed activity slot instead of an append-only row
  stack. Idle keeps the separator blank; active work has priority, then Error,
  then Notice. The action bar and context ribbon therefore retain both their
  row numbers and total frame height while feedback changes, including when
  stale lower-priority fields coexist in a snapshot.
- Fixed-activity acceptance passes with 83 focused screen, feedback, overlay,
  Fleet, Doctor, Palette, transfer, and real-PTY tests. A real 80x24 color
  session closed AliceProjects to produce a Notice, then clicked Commands at
  the ribbon's unchanged row and opened the Command Palette. CLI
  build/typecheck, root TypeScript, and the 689-file suite pass (688 passed, 1
  skipped; 6082 tests passed, 10 skipped). Docker installer smoke also passes.
- Lifecycle, managed-source, and update consent no longer appends content to
  the operational page. A focused centered modal now separates the question
  from its impact, exposes distinct Enter/Esc keycaps, traps keyboard input,
  and uses the shared overlay pointer router for hover/click. Acceptance first
  removes the modal, then lets the existing lifecycle action surface progress
  in the fixed activity slot; refusal remains state-only and non-mutating.
- Confirmation-modal acceptance passes with 106 focused Supervisor screen,
  modal, pointer, Fleet, Doctor, Palette, transfer, and real-PTY tests. A real
  80x24 color session opened Managed Source over the unchanged application
  frame, clicked `[ Esc ]` with raw SGR pointer input, rendered the fixed
  `STATUS Action cancelled.` slot, detached, and restored terminal modes. The
  46-column render keeps both actions visible. CLI build/typecheck, root
  TypeScript, and the 690-file suite pass (689 passed, 1 skipped; 6087 tests
  passed, 10 skipped). Docker installer smoke passes, and the package dry-run
  includes `src/supervisor-confirmation.ts`.
- The Command Palette is no longer a substitute page inside the Supervisor
  frame. It is now a focused centered overlay over the current Overview, Fleet,
  Logs, Doctor, Help, or recovery page; the page's activity slot, action bar,
  and context ribbon remain geometrically unchanged. Keyboard selection still
  wraps, pointer-wheel movement clamps, and pointer motion/click uses whole-row
  targets. Running a command closes the Palette before handing focus to Setup,
  Update, AliceProjects, or a confirmation modal.
- Command-Palette-overlay acceptance passes with 108 focused Supervisor screen,
  Palette, pointer, modal, Fleet, Doctor, transfer, and real-PTY tests. A real
  80x24 color session opened the Palette over the visible AliceProject card,
  clicked the Setup row with raw SGR pointer input, transferred focus to the
  Setup overlay, then restored terminal modes after close/detach. CLI
  build/typecheck, root TypeScript, and the 690-file suite pass (689 passed, 1
  skipped; 6089 tests passed, 10 skipped). Docker installer smoke passes, and
  the package dry-run retains both Palette and Supervisor modules.
- The operational navigation is now a continuous segmented rail rather than a
  loose string of tabs. At ordinary widths its five destinations carry stable
  glyphs, labels, and inline Machine/Logs/Doctor evidence; at 46 columns it
  retains every destination using minimal labels. Active and hover states use
  separate surfaces in color terminals while bracketed labels preserve the
  no-color contract. One layout result owns both the line and its pointer hit
  regions, including dynamically changing badge edges.
- Segmented-navigation acceptance passes with 113 focused Supervisor screen,
  navigation, pointer, modal, Palette, Fleet, Doctor, transfer, and real-PTY
  tests. A real 80x24 color session sent raw SGR motion and click reports to
  the Help chip, opened the keyboard map, detached, and restored cursor, mouse,
  and bracketed-paste modes. CLI build/typecheck, root TypeScript, and the
  691-file suite pass (690 passed, 1 skipped; 6094 tests passed, 10 skipped).
  Docker installer smoke passes, and the package dry-run includes
  `src/supervisor-navigation.ts`.
- Help is now a Control Atlas instead of a static shortcut wall. Wide terminals
  use a stable group/Inspector split; 80-column and 46-column terminals stack
  the same Navigation, Runtime, and AliceProject focus model. Each selected
  group explains its ownership and exposes only single-meaning clickable
  keycaps. Recovery substitutes safe Recovery and Exit groups. Arrow/Home/End,
  pointer wheel, whole-row hover, and click all update one selection without
  creating another action state machine.
- Control-Atlas acceptance passes with 117 focused Supervisor screen, Help,
  navigation, pointer, modal, Palette, Fleet, Doctor, transfer, and real-PTY
  tests. A real 80x24 color session clicked the top Help chip, then used raw SGR
  motion/click reports to select Runtime inside the Atlas before detaching with
  cursor, mouse, and bracketed-paste modes restored. CLI build/typecheck, root
  TypeScript, and the 692-file suite pass (691 passed, 1 skipped; 6098 tests
  passed, 10 skipped). Docker installer smoke passes, and the package dry-run
  includes `src/supervisor-help-view.ts`.

## Completion Criteria

- A first-time user can identify the selected AliceProject, Runtime health, and
  primary action without opening Help.
- Tabs, Fleet rows, scrollable content, and visible actions work with mouse and
  keyboard; keyboard-only use remains complete.
- The TUI has a coherent OpenAlice visual identity with stable rendering and no
  raw-mode, cursor, alternate-screen, or mouse-mode leakage after exit or error.
- All existing lifecycle/refusal safety contracts remain intact.
- Real terminal acceptance and applicable automated gates pass, and the
  maintainer has reviewed the retained feature branch before any `dev` PR.
