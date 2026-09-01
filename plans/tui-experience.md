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
- The selected model is a persistent clickable command dock plus a contextual
  Command Deck opened with `/`. It exposes only existing Supervisor actions and
  routes every keypress and pointer click through the same action, confirmation,
  refusal, and detach state machines.

### Runtime log presentation decision

- Coloring raw JSON would leave the event message behind long metadata and
  terminal clipping.
- Requiring every line to parse as OpenAlice JSON would hide valid third-party
  and legacy plain-text output.
- The selected model is best-effort semantic projection: recognized JSON puts
  severity, time, message, and compact context first; all other lines retain a
  sanitized plain-text fallback. The bounded snapshot edge is named `LATEST`,
  not the misleading `LIVE TAIL`.

### Operational navigation decision

- Static route labels are simple but require opening every page to discover
  inventory, loaded logs, or diagnostic attention.
- Color-only dots would be ambiguous and violate the no-color contract.
- The selected model adds compact textual/glyph badges to the existing tabs:
  Machine and loaded-log counts plus Doctor pass/warn/fail state. Badges extend
  the original pointer target and do not introduce separate controls.

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
