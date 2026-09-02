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

### Launchpad action-surface decision

- Keeping the current cockpit and merely recoloring its cards would improve a
  screenshot while leaving the first screen organized like a field report.
- Making the whole AliceProject card clickable would maximize target size but
  blur identity, guidance, and mutation into one accidental activation zone.
- The selected model promotes only the primary action row into an OMP-inspired
  focus surface. A semantic intent strip distinguishes launch-ready, live,
  attention, and settling states; the full action row owns hover and click,
  while its visible `[ Enter ]` preserves keyboard/no-color meaning. Both input
  paths feed the existing primary-action state machine. The 52:48 wide cockpit
  and folded 80x24 layout retain every truthful Runtime field.

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

### Runtime Event Lens decision

- Keeping the filtered log page as a passive tail would preserve simple paging,
  but it would still make every event compete in one text plane and leave mouse
  input useful only for scrolling.
- Porting OMP's complete debug-log viewer would add selection ranges, clipboard,
  text search, older-file loading, and process filtering that OpenAlice's
  bounded/redacted Logs contract does not currently own.
- The selected model ports only OMP's cursor-as-context pattern. The latest
  matching event starts focused; keyboard, wheel, hover, and whole-row click
  move one selection; a responsive Event Lens exposes that event's source line,
  severity, JSON/text format, semantic projection, and sanitized raw content.
  Wide terminals use a stream/Inspector split and 80-column terminals stack the
  same model without another read or lifecycle path.

### Visible scroll rail decision

- Keeping only numeric ranges in pane titles is compact, but position remains
  indirect and disappears from peripheral vision while the user scans rows.
- Importing OMP's complete `ScrollView` would duplicate OpenAlice's existing
  selection, wheel, pointer-target, and responsive-window state.
- The selected model adapts OMP's proportional thumb geometry into a shared,
  render-only primitive. It reserves the final content column for an explicit
  `│` track and `█` thumb whenever a collection overflows, while Event Lens,
  Doctor, and each Fleet pane retain their current state and full-row targets.
  The glyph contract remains complete under `NO_COLOR` and adds no input path.

### Contextual Action Shelf decision

- Keeping the footer as spaced keycap prose preserves compact implementation,
  but hierarchy exists only in reading order and mouse targets remain much
  smaller than their visible labels.
- Turning every action into a heavy bordered button would consume scarce rows,
  especially when the 80-column baseline wraps, and compete with the persistent
  context ribbon directly beneath it.
- The selected model follows OMP's status-line composition: one full-width
  shelf with a high-contrast `◆` primary segment, quieter secondary segments,
  stable dividers, and complete-segment hit regions. Segments wrap atomically.
  Pointer hover replaces `◆`/`·` with `›` for the first segment or changes the
  preceding divider to `│ ›`, so focus remains visible under `NO_COLOR`; click
  still feeds the existing key state machine.

### Overlay Action Shelf parity decision

- Leaving cards and modals on keycap-only hit regions would make the same shelf
  change interaction rules when an overlay takes focus, particularly around
  consequential Enter/Esc confirmations.
- Maintaining overlay-specific coordinates would duplicate responsive geometry
  and regress whenever prompt or impact copy changes modal height.
- The selected model teaches the shared shelf parser to recognize both bare
  application rows and framed `│ … │` rows. The overlay router consumes those
  render-derived complete-segment targets, and confirmation decoration reuses
  the same color/`NO_COLOR` focus marker. Activation still emits only the
  existing Enter/Esc input.

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

### Setup Studio decision

- Recoloring the existing single-column `SettingsList` would retain its proven
  mutation semantics, but selected value, precedence explanation, and next
  action would continue competing in one dense text stack.
- Copying OMP's four-step onboarding literally would look polished but falsely
  imply that OpenAlice's independent setup fields must be completed in order.
- The selected model keeps the existing non-linear settings state machine and
  replaces only its presentation with an OMP-inspired Setup Studio. Wide
  overlays pair a compact setting map with a selected-item Inspector; the
  80-column baseline stacks the same regions. Current value, layer, Runtime
  state, impact copy, and the one valid action stay visible together. Split-pane
  pointer columns prevent Inspector actions from activating the adjacent list,
  and complete action labels still emit only Enter/Esc.

### AliceProject Switchboard decision

- Recoloring the existing `SelectList` would preserve its compactness, but Home,
  Web port, current/default identity, and the consequence of Enter would remain
  compressed into two hard-to-scan lines.
- Turning the picker into a complete project-management dashboard would offer
  more visible actions, but would duplicate Fleet lifecycle ownership and widen
  this increment beyond selection and creation.
- The selected model is an OMP-inspired AliceProject Switchboard. A bounded map
  keeps up to eight project rows plus the create affordance visible; an
  Inspector gives the selected row a stable identity, Home, Web mode, role, and
  one explicit Enter action. Wide overlays pair both regions and the 80-column
  baseline stacks them. Arrow keys, wheel, row hover, and click continue to
  drive the existing `SelectList`; the existing select/create callbacks remain
  the only mutation path. CLI-selected contexts expose a read-only action shelf,
  and pointer columns keep Inspector clicks out of the adjacent map.

### Release Observatory decision

- Recoloring the three-row update `SelectList` would preserve its small size,
  but users would still choose Stable, Beta, or Dev without seeing cadence,
  audience, installed-lane relationship, or the consequence of Enter together.
- Probing all three channels when the overlay opens could show live versions,
  but would triple advisory network work, alter the current single-channel
  contract, and make a presentation surface own update orchestration.
- The selected model is an OMP-model-picker-inspired Release Observatory. A
  stable lane map identifies CURRENT, PRODUCTION, PREVIEW, and EDGE semantics;
  the selected Channel Brief keeps cadence, audience, installed version,
  tradeoff, and one explicit Check action together. Wide overlays pair the
  regions and the 80-column baseline stacks them. Arrow keys, wheel, row hover,
  and click continue to drive the existing `SelectList`; only Enter closes the
  overlay and invokes the existing one-channel `checkUpdate` path. The selected
  lane remains session-local until an already-confirmed installer succeeds.

### Transfer Flight Deck decision

- Merely recoloring the existing `Remote Transfer` card would leave destination,
  identity, secrets, review, and streaming phases looking unrelated, so users
  would still have to remember where they are in a safety-sensitive workflow.
- Replacing the wizard with a new full-screen transfer application could expose
  every field at once, but would duplicate its validation, re-probe, retry,
  cancellation, and atomic-publish state machine inside presentation code.
- The selected model is a phase-aware Transfer Flight Deck. Wide terminals pair
  an eight-stage flight path with the current Mission Brief; narrower terminals
  compress the same completed/current/next state into a one-line route above
  the Brief. A persistent Safety Rail carries the phase message without moving
  the content. Existing inputs, `SelectList` instances, plan review, retries,
  sender, and success actions remain authoritative. Pointer row origins derive
  from the rendered Flight Deck so both responsive forms keep the existing
  keyboard and mutation paths.

### Transfer Mission Console decision

- Keeping raw `Input` and `SelectList` output inside Mission Brief would retain
  the Flight Deck route, but field purpose, validation failure, and the full
  action target would still fall back to dependency-default presentation.
- Replacing the transfer wizard state machine with a new form controller would
  unify rendering, but duplicate its safety, retry, and recovery ownership.
- The selected model keeps the existing wizard and projects its entry stages as
  a Mission Console: semantic field/choice headers, explicit fix state, and
  whole-segment Continue/Choose/Back shelves. The Flight Deck remains the outer
  route and Safety Rail; existing `SelectList`, validators, and phase callbacks
  remain the only navigation and mutation paths.

### AliceProject Foundry decision

- Keeping the creator as a bordered raw `Input` would preserve its compactness,
  but entering it from the Switchboard would continue to erase project context,
  progress, field purpose, and the difference between identity and storage.
- Adding both fields directly to the Switchboard Inspector would look faster,
  but would turn selection into a form, weaken the existing validation order,
  and make accidental creation easier from a frequently used navigation view.
- The selected model is a two-stage AliceProject Foundry. A Build Path keeps
  Identity and Complete Home visible while a Field Inspector owns the existing
  focused `Input`, validation detail, and contextual action. Wide terminals pair
  them; the 80-column baseline stacks a compact completed/current/next route.
  The Switchboard remains the entry/back surface, and the existing
  `createProject` call is still the only mutation boundary.

### Runtime Source Launch Bay decision

- Restyling the existing source-path input would keep the overlay small, but it
  would continue to hide that one Enter action performs four ordered steps:
  checkout selection, validation, persistence, and Runtime launch.
- Moving source editing into Setup would consolidate configuration, but startup
  without a usable checkout needs an immediate recovery surface and `c` is an
  intentional advanced shortcut for this exact boundary.
- The selected model is a Source Launch Bay. A Route panel keeps Select,
  Validate, Save, and Launch visible while a Field Inspector owns the existing
  focused input, failure guidance, and explicit action. Wide terminals pair the
  regions; the 80-column baseline stacks the complete route. The existing
  `findSource` -> `configureProject` -> `performAction('start')` chain remains
  the only validation, persistence, and launch path.

### Setup Workbench decision

- Keeping the raw Setup Editor inside a generic panel would preserve its small
  footprint, but entering it from Setup Studio would continue to erase the
  selected field's position, active configuration layer, inheritance contract,
  and validation boundary.
- Editing values inline in the Studio map would retain context, but long paths
  and validation failures would collide with navigation rows and make pointer
  selection ambiguous.
- The selected model is a Setup Workbench. A Layer Context panel keeps the
  AliceProject or Machine layer, selected field, and Edit/Validate/Save route
  visible while a Field Inspector owns the existing focused input and validator.
  Wide terminals pair the regions; the 80-column baseline stacks the complete
  route. Existing `SettingsList` callbacks and `applySetting` remain the only
  persistence path.

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
- [x] Promote Overview into an action-first Launchpad with a semantic intent
  strip and whole-row primary-action pointer target.
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
- [x] Replace the passive Runtime Logs tail with a selectable Event Lens and
  responsive Inspector while preserving the same bounded snapshot.
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
- [x] Replace spaced footer keycap prose with a responsive, whole-segment
  contextual Action Shelf whose hover semantics survive `NO_COLOR`.
- [x] Carry whole-segment Action Shelf geometry and focus semantics through
  overlay cards and confirmation modals without new action paths.
- [x] Add a shared proportional scroll rail to overflowing Event Lens, Doctor,
  Machine, and AliceProject windows without changing selection or pointer state.
- [x] Replace the legacy Setup settings stack with a responsive Setup Studio
  map/Inspector while preserving the existing configuration mutation path.
- [x] Replace the legacy AliceProject picker with a responsive Switchboard
  map/Inspector while preserving its selection and creation state machine.
- [x] Replace the legacy update-channel picker with a responsive Release
  Observatory while preserving one-channel, explicit-Enter network behavior.
- [x] Replace the legacy Remote Transfer shell with a responsive Transfer
  Flight Deck while preserving its planner, sender, and recovery state machine.
- [x] Replace the legacy AliceProject Creator card with a responsive Foundry
  while preserving its ordered key/Home validation and creation boundary.
- [x] Replace the legacy Runtime Source input card with a responsive Launch Bay
  while preserving its validate-save-start execution boundary.
- [x] Replace the legacy Setup Editor fallback with a responsive Workbench
  while preserving the SettingsList validation and applySetting boundary.
- [x] Replace raw transfer entry controls with Mission Console fields, choices,
  validation state, and whole-action pointer targets.

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
- Overview is now an action-first Launchpad instead of a decorated field
  report. The AliceProject hero carries a semantic launch/live/attention/
  settling intent strip and a full-row primary focus surface; hover changes the
  whole action row, and clicks outside the visible keycap still feed the one
  existing Enter action. Runtime Signal preserves Home, Web, Owner, Provider,
  Services, and Uptime. Wide 52:48 and folded layouts keep the activity slot,
  command bar, and context ribbon within the 80x24 baseline.
- Launchpad acceptance passes with 118 focused Supervisor screen, Overview,
  Help, navigation, pointer, modal, Palette, Fleet, Doctor, transfer, and
  real-PTY tests. An isolated real 80x24 color fixture sent raw SGR motion and
  click reports at column 60 of the hero row—outside `[ Enter ]`—observed the
  focused surface, dispatched exactly one start plus open through test doubles,
  and restored cursor, mouse, and bracketed-paste modes. CLI build/typecheck,
  root TypeScript, and the 692-file suite pass (691 passed, 1 skipped; 6099
  tests passed, 10 skipped). Docker installer smoke and package dry-run pass.
- Runtime Logs is now an OMP-inspired selectable Event Lens instead of a
  passive tail. The latest matching event owns focus; keyboard movement,
  pointer wheel, whole-row hover, and click update one selection. Wide layouts
  pair Event stream and Inspector columns, while 80-column layouts stack them.
  The Lens identifies original source line, semantic severity, JSON/text
  format, projected content, and sanitized raw content without widening the
  bounded/redacted reader.
- Event-Lens acceptance passes with 121 focused Supervisor screen, Logs,
  pointer, modal, Palette, Fleet, Doctor, transfer, and real-PTY tests. An
  isolated real 80x24 color fixture loaded ten mixed events, hovered and clicked
  warning line 9 with raw SGR reports, changed the Lens from line 10 to
  `LINE 9 · WARNING · JSON`, and restored cursor, mouse, and bracketed-paste
  modes. CLI build/typecheck, root TypeScript, and the 692-file suite pass (691
  passed, 1 skipped; 6102 tests passed, 10 skipped). Docker installer smoke
  passes, and package dry-run retains `src/supervisor-tui-logs.ts` while
  excluding the PTY fixture.
- Operational footers are now contextual Action Shelves rather than spaced
  shortcut prose. The primary segment uses a high-contrast `◆` surface,
  secondary actions share quieter divided chips, and the complete label—not
  only its keycap—is hoverable and clickable. Narrow layouts wrap only between
  complete segments. Hover uses a stable-width `›` marker in both color and
  `NO_COLOR` sessions while all clicks continue through the keyboard action
  map.
- Action-Shelf acceptance passes with 123 focused Supervisor screen, shared
  view, pointer, modal, Palette, Fleet, Logs, Doctor, transfer, and real-PTY
  tests. A real 80x24 session hovered the `Setup` label outside `[ p ]`, observed
  `│ › [ p ] Setup` without relying on color, clicked into the real Setup
  overlay, closed it, and restored cursor, mouse, and bracketed-paste modes. A
  46-column render preserved all four actions across three atomic rows. CLI
  build/typecheck, root TypeScript, and the 692-file suite pass (691 passed, 1
  skipped; 6104 tests passed, 10 skipped). Docker installer smoke and package
  dry-run pass with the shared theme/view modules retained.
- Framed Action Shelves inside overlays and confirmation modals now use the same
  complete-segment geometry and semantic focus marker as the application
  footer. The shared parser accounts for card rails without fixed coordinates;
  the overlay router still emits only the rendered key's existing input, and
  modal width remains stable in both color and `NO_COLOR` modes.
- Overlay-Shelf parity acceptance passes with the 123 focused Supervisor suite.
  A real 80x24 managed-source confirmation hovered the `Not now` label outside
  `[ Esc ]`, rendered `│ › [ Esc ] Not now`, clicked it into the existing
  cancellation state, and restored cursor, mouse, and bracketed-paste modes.
  The 692-file suite passes (691 passed, 1 skipped; 6104 tests passed, 10
  skipped), together with CLI/root typechecks, CLI build, Docker installer smoke,
  and package dry-run.
- Overflowing Event Lens, Doctor, Machine, and AliceProject windows now expose
  an OMP-derived proportional `│`/`█` rail in their final content column. The
  shared primitive owns only rendering; existing selection, wheel, pointer,
  filter, responsive window, and full-row activation state remain authoritative.
  Unicode-aware truncation moved into a neutral display primitive so Fleet is
  no longer the dependency root for shared layout math.
- Scroll-rail acceptance passes with 42 focused primitive, Fleet, Logs, Doctor,
  and real-PTY tests. The 80×24 Event Lens fixture rendered the bottom-positioned
  rail and still selected warning line 9 through raw SGR hover/click. Root
  TypeScript, CLI build/typecheck, and the 693-file suite pass (692 passed, 1
  skipped; 6108 tests passed, 10 skipped). Docker installer smoke passes, and
  package dry-run includes both `src/supervisor-display.ts` and
  `src/supervisor-scroll-rail.ts`.
- Setup is now a responsive Setup Studio rather than a legacy settings stack.
  An actual isolated OMP 17.3.4 session informed the map/Inspector hierarchy,
  explicit step identity, selected-row treatment, action shelf, and scroll
  affordance without copying its sequential onboarding model. Wide layouts keep
  the six-field map beside current value, Runtime state, guidance, and action;
  the 80-column baseline stacks the same complete model. Split-pane pointer
  bounds prevent Inspector actions from selecting adjacent rows, while the
  existing `SettingsList` remains the sole keyboard and mutation authority.
- Setup-Studio acceptance passes with 75 focused view, pointer, screen, and
  real-PTY tests. A real 110×30 session hovered and clicked `Cycle value`
  outside its keycap, changed the editing layer, and restored cursor, mouse,
  and bracketed-paste modes. The narrow render also exposed and fixed a shared
  panel-title overflow. Root TypeScript, CLI build/typecheck, and the 694-file
  suite pass (693 passed, 1 skipped; 6113 tests passed, 10 skipped). Docker
  installer smoke passes, and package dry-run includes
  `src/supervisor-setup-view.ts`.
- AliceProject selection is now a responsive Switchboard rather than a legacy
  `SelectList` projection. Wide layouts pair an eight-row project map with a
  Home/Web/role/action Inspector; the 80-column baseline uses a five-row window
  so its map, Inspector, two-line status, and borders remain within 24 rows,
  while shorter terminals reduce only the map window instead of clipping the
  Inspector or status.
  Current, bare-start default, available, and create roles stay meaningful
  without color, and an OMP-derived proportional rail exposes overflow. The
  existing `SelectList`, select callback, and two-step creator remain the only
  navigation and mutation path.
- Switchboard acceptance passes with 78 focused view, pointer, screen, and
  real-PTY tests. A real 110×30 fixture hovered Research in the map, then
  clicked the Inspector's `Select` label outside `[ Enter ]`, persisted it as
  the bare-start default, and restored terminal modes. A separate real 80×24
  run against the current six-project registry scrolled from Default through
  the five-row window to Create, kept long Home values bounded, and detached
  cleanly. An 80×20 PTY additionally retained the complete Inspector and
  two-line status by reducing only the map window. Root TypeScript, CLI
  build/typecheck, and the 695-file suite pass (694 passed, 1 skipped; 6119
  tests passed, 10 skipped). Docker installer smoke passes, and package dry-run includes
  `src/supervisor-projects-view.ts`.
- Update selection is now a responsive Release Observatory inspired by OMP's
  model picker: a three-lane map and Channel Brief are adjacent on wide
  terminals and stack completely at the 80-column baseline. Lane hover and
  click only move selection; keyboard `Enter` or the Brief's whole `Check`
  surface is the single-channel network boundary. Closing the overlay now
  explicitly restores screen focus before hiding it.
- Release-Observatory real-PTY acceptance at 110×30 selected Dev with raw SGR
  pointer input, clicked `Check` outside `[ Enter ]`, issued exactly one Dev
  probe, displayed the current-channel result, and restored terminal modes.
- Release-Observatory acceptance passes with 78 focused view, pointer, screen,
  and real-PTY tests. Root TypeScript and CLI build/typecheck pass; the 696-file
  suite passes (695 passed, 1 skipped; 6123 tests passed, 10 skipped). Docker
  installer smoke passes, and package dry-run includes
  `src/supervisor-release-view.ts`.
- Remote migration now runs inside a responsive Transfer Flight Deck. Its
  eight-stage route distinguishes completed, current, and next boundaries while
  the Mission Brief keeps the existing input, choice, review, progress,
  recovery, and completion components in one stable region. Wide terminals use
  adjacent route/Brief panels; narrow terminals compress the route and Safety
  Rail so the complete default-No review fits the 80×24 baseline.
- Flight-Deck acceptance passes with 82 focused view, transfer, pointer, screen,
  and real-PTY tests. The six PTY recovery scenarios include a 110×30 raw-mouse
  destination selection and an 80×24 default cancellation. Root TypeScript and
  CLI build/typecheck pass; the 697-file suite passes (696 passed, 1 skipped;
  6126 tests passed, 10 skipped). Docker installer smoke passes, and package
  dry-run includes `src/supervisor-transfer-view.ts`.
- AliceProject creation now stays inside a responsive Foundry rather than
  falling back from the Switchboard to a raw input card. Identity and Complete
  Home remain visible beside the focused Field Inspector on wide terminals;
  the narrow path keeps current/next context, field guidance, action surface,
  and creation contract within the 80×24 baseline.
- Foundry acceptance passes with 83 focused view, Switchboard, pointer, screen,
  and real-PTY tests. A 110×32 run clicked the full `Continue` and
  `Create & select` labels outside their keycaps, created and selected Research,
  then restored Default; a separate 80×24 run retained the complete Identity
  step and returned without mutation. Root TypeScript and CLI build/typecheck
  pass; the 698-file suite passes (697 passed, 1 skipped; 6130 tests passed, 10
  skipped). Docker installer smoke passes, and package dry-run includes
  `src/supervisor-project-foundry-view.ts`.
- Runtime Source now opens as a responsive Launch Bay rather than a raw input
  card. Select, Validate, Save, and Launch remain visible beside the focused
  checkout Inspector on wide terminals; validation failures mark the route
  `REJECTED`, block the downstream stages, and retain the editable field. The
  80-column layout stacks the same complete route and launch contract.
- Source-Launch-Bay acceptance passes with 80 focused view, pointer, screen,
  and real-PTY tests. A 110×28 no-checkout run typed an invalid path, hovered
  and clicked the full `Save & start` segment, rendered the rejected route,
  then cancelled without mutation; a separate 80×24 run retained the complete
  route and restored terminal modes. Root TypeScript and CLI build/typecheck
  pass; the 699-file suite passes (698 passed, 1 skipped; 6134 tests passed, 10
  skipped). Docker installer smoke passes, and package dry-run includes
  `src/supervisor-source-view.ts`.
- Setup value editing now stays inside a responsive Workbench instead of
  dropping from Setup Studio into the legacy Editor card. The active Project or
  Machine layer, field position, Edit/Validate/Save route, focused input, and
  inheritance contract remain visible; rejected values switch to a complete
  `FIX` route without losing the user's entry.
- Setup-Workbench acceptance passes with 83 focused view, pointer, screen, and
  real-PTY tests. A 110×30 run used the full action segment to submit an invalid
  project port, corrected it, clicked again, and persisted the valid value; a
  separate 80×24 run switched to Machine defaults and persisted its port through
  the stacked Workbench. Root TypeScript and CLI build/typecheck pass; the
  699-file suite passes (698 passed, 1 skipped; 6137 tests passed, 10 skipped).
  Docker installer smoke passes, and package dry-run retains
  `src/supervisor-setup-view.ts`.
- Transfer entry now reads as a Mission Console instead of exposing raw Input
  and SelectList cards inside the Flight Deck. Project identity, destination,
  credentials, and policy phases use semantic field or choice headers, explicit
  `FIX` validation state, and whole-segment Continue/Choose/Back shelves while
  the existing wizard, validators, and transfer controller remain authoritative.
- Mission-Console acceptance passes with 82 focused view, pointer, screen, and
  real-PTY tests. The six transfer PTY scenarios include a 110×30 run that used
  raw SGR pointer input to submit an invalid destination key from outside the
  keycap, observed the `FIX` state, corrected it, and completed the remaining
  semantic choice phases. Root TypeScript and CLI build/typecheck pass; the
  699-file suite passes (698 passed, 1 skipped; 6139 tests passed, 10 skipped).
  Docker installer smoke passes, and package dry-run retains both
  `src/supervisor-transfer-view.ts` and `src/supervisor-tui.ts`.

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
