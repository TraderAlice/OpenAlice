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

- Product priority is Launcher first, State Manager second, and bounded light
  workbench third. Inbox is evidence that a connected target is useful, not the
  reason the TUI exists.
- The disconnected surface must make one linear promise without requiring Help:
  choose a Machine, choose an AliceProject, then Start locally or Connect over
  SSH. Each step exposes its current value and completion state, and successful
  activation transitions into the connected workbench rather than opening a
  browser implicitly.

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

### Connection-first information architecture decision

- Adding Inbox beside the five existing pages would expose more capability but
  preserve a mixed hierarchy of setup, status, diagnostics, and documentation.
- Expanding the Supervisor into a full terminal clone of the Web UI would make
  the TUI broad, but duplicate feature ownership outside its frontend boundary.
- The selected model is a two-phase adaptive shell. Before a usable target is
  connected, the TUI is a guided three-step launch path: Machine, AliceProject,
  then Runtime transport. After connection it becomes a workbench organized as
  Home, Inbox, Connections, and Runtime; Help moves behind `?` and Logs plus
  Doctor become Runtime tools instead of equal product destinations. Enter
  connects or starts and remains in the TUI; opening the Web UI is a separate
  explicit action. This is an autonomous topic decision, not recorded
  maintainer approval.

### Active target and Inbox boundary decision

- Reading Inbox JSONL directly would bypass server-owned read state and couple
  the frontend to persistence details. Reproducing the entire Web Inbox would
  also exceed the Supervisor's bounded operational role.
- The selected Inbox consumes only the existing authenticated HTTP history and
  read-state routes. It provides a bounded unread-aware list and inspector,
  supports read/unread and refresh, and deliberately omits destructive delete.
- Every connected workbench binds to one explicit active target containing its
  Machine, AliceProject, Runtime, transport, and reachable endpoint. Local
  Runtime discovery may create that target directly; SSH connection must retain
  the forwarded local URL instead of treating tunnel readiness as a boolean.
  This prevents a remote connection from silently continuing to render and
  mutate local context. This is an autonomous topic decision, not recorded
  maintainer approval.

### Connected-state control-plane decision

- Treating a successful SSH forward as a one-time navigation event leaves the
  user unable to answer which target subsequent commands affect, how to leave
  it, or what happened when the tunnel closes.
- Allowing several background tunnels while only one target is rendered also
  violates the active-target model and makes switching appear cheaper and safer
  than it is.
- The selected model keeps exactly one active target. The persistent command
  spine names its Machine, AliceProject, transport, and live signal; Connections
  marks that same target independently of list focus. Remote targets expose an
  explicit Disconnect action and a target-scoped Command Dock. Selecting a new
  local or remote target closes the previous SSH forward, while authoritative
  local Runtime loss returns the default shell to the Launcher with a visible
  reason. Browser opening remains a separate action. This is an autonomous
  topic decision, not recorded maintainer approval.

### Connection-health recovery decision

- Leaving an SSH target visually LIVE until its process exits hides endpoint
  stalls; immediately destroying the tunnel after one failed probe turns a
  transient network wobble into unnecessary user disruption.
- The selected model separates transport ownership from endpoint health. A
  TUI-owned SSH forward remains the active target while bounded readiness
  probes move it through connected, degraded, and unreachable states. One
  failure is degraded; three consecutive failures are unreachable; any later
  success restores connected in place. Home, navigation, the persistent Dock,
  and the Command Dock project the same phase. An unhealthy target replaces
  Open with an explicit Retry action, while Disconnect remains available and
  never stops the remote Runtime. Local inspection failures degrade the current
  target without pretending the Runtime stopped; only an authoritative absent
  Runtime returns to the Launcher. This is an autonomous topic decision, not
  recorded maintainer approval.

### Runtime-status chronicle decision

- Naming the connected navigation destination Runtime while rendering only a
  bounded process-log tail leaves the status-manager promise unresolved. A
  colored health badge says what is true now but cannot explain whether the
  target was just acquired, degraded, recovered, switched, or released.
- The selected model makes Runtime a layered status surface. A bounded,
  session-local Connection Chronicle leads with the exact Machine →
  AliceProject → transport route, current health, and the valid target action;
  it records only meaningful target and health transitions rather than every
  poll. Local Runtime events remain directly below as supporting evidence;
  remote targets retain a complete Chronicle without pretending local log and
  Doctor controls apply remotely. The trail is presentation state only: it is
  not persisted, does not create a second health authority, and never changes
  lifecycle or tunnel ownership. This is an autonomous topic decision, not
  recorded maintainer approval.

### Launch-flight recorder decision

- Keeping the Launcher inventory visible while one generic Busy rail says
  `Starting` or `Connecting` makes selection look actionable even though input
  is owned by an opaque operation. Adding a larger spinner would make the wait
  louder without answering which target, transport, or boundary is active.
- The selected model temporarily replaces the Launcher inventory with a Launch
  Flight Recorder for local start, remote start, and SSH connect. It preserves
  the selected Machine and AliceProject as mission identity, projects only
  stages the existing orchestration can truthfully observe, distinguishes
  complete, active, waiting, and recoverable-failure states without color, and
  keeps the persistent Detach route. Success hands directly into the connected
  Home surface; failure stays on the selected target and makes Enter the retry
  path. This is presentation state only and does not add cancellation,
  lifecycle, readiness, or tunnel authority. This is an autonomous topic
  decision, not recorded maintainer approval.

### Launch-briefing decision

- Keeping the disconnected Fleet's expanded Selection Constellation exposes
  owner, uptime, service, port, and capability inventory before the user has a
  connected target. That information is useful in the connected Connections
  manager, but in the Launcher it competes with the more important questions:
  what is selected, what will the primary action do, and where will it land.
  Adding another tutorial overlay would hide the target hierarchy and create a
  second dismissal/focus model.
- The selected model gives the same Fleet primitive two semantic modes. Before
  connection, its passive detail card becomes a Launch Briefing with the exact
  Machine/AliceProject route, one human outcome, a three-stage handoff preview,
  and the same primary command owned by the bottom Action Shelf. After
  connection, Connections retains the technical Selection Constellation. The
  briefing and Action Shelf resolve one shared launch intent so blocked or
  unavailable targets cannot advertise a stale Start/Connect command. Wide
  terminals show the handoff and target context; ordinary and narrow terminals
  keep a two-line outcome plus next action. Glyphs and text preserve meaning in
  `NO_COLOR`, every action remains keyboard-accessible, and no new pointer,
  lifecycle, tunnel, readiness, or persistence authority is introduced. This
  is an autonomous topic decision, not recorded maintainer approval.

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

### Overview action-hierarchy decision

- Keeping Enter in both the Launchpad and bottom Action Shelf reinforces its
  shortcut, but renders two competing primary surfaces on the same page.
- Removing the Launchpad action would simplify the frame while returning the
  AliceProject card to the status-report hierarchy the redesign replaced.
- The selected model makes the Launchpad the only Overview primary surface.
  Its Enter action is always truthful: stopped starts and opens, a verified Web
  endpoint opens, and every other non-recovery Runtime state runs Doctor. The
  bottom shelf contains only supporting commands such as quiet start, Setup,
  Source, Restart, Stop, Logs, and Update. All keys and callbacks already exist;
  this change removes duplication rather than adding an execution path.

### Launcher-to-state-manager handoff decision

- Keeping `Enter` bound to Open Web after a healthy connection makes Home
  remain a launcher forever, even when the connected AliceProject has state
  that needs attention.
- Adding a separate Inbox card would expose that state, but create a second
  primary surface and make the compact layout harder to scan.
- The selected model lets the existing Launchpad change responsibility. Before
  connection it starts or connects; connection recovery always retains highest
  priority; after a healthy connection, unread Inbox reports promote `Enter`
  to Review Inbox and leave `o` as the explicit Open Web accelerator. When no
  unread state remains, Home returns to Open Workspace. The same resolved
  intent owns the label, keyboard path, pointer target, and Action Shelf, so
  visual guidance cannot disagree with execution. No persistence or Inbox API
  ownership changes.
- Responsive behavior adds no rows: compact and wide Launchpads reuse the same
  semantic intent, one-line guidance, and full-row pointer target. Glyphs and
  text retain no-color meaning, and keyboard-only use remains complete. This
  is an autonomous topic decision, not recorded maintainer approval.

### Connected Home session-stage decision

- A same-size 120×32 and 80×24 ANSI-frame comparison against OMP 17.3.4
  confirmed that color is not the remaining Home problem. OpenAlice splits the
  first frame into equally loud Launchpad and Telemetry cards, repeats live
  truth through the brand, Control Path, service array, context row, and Dock,
  then leaves a large empty gulf above a detached Control Console.
- Copying OMP's three-column welcome card literally would preserve its identity
  but also copy its 80×24 top clipping. Replacing Home with several smaller
  dashboard cards would retain the old telemetry-first premise.
- The selected model is one responsive Session Stage. At wide widths, a bounded
  identity column anchors one selected AliceProject while a single content
  column flows through Now, Attention, Recent, and the resolved primary action.
  Ordinary widths preserve that exact order in one column and omit the brand
  illustration before omitting task truth. PID, complete URL, provider, uptime,
  and component diagnostics move back to Runtime; Home keeps only state needed
  to decide what happens next. Existing Inbox and Connection Chronicle
  snapshots supply Attention and Recent without a new backend contract.
- The OMP-inspired lower rail remains contextual and stable, but Home has only
  one primary action surface. Saturated color is reserved for identity, current
  focus, and actionable attention; optional disabled services are neutral, not
  failures. This is an autonomous topic decision, not recorded maintainer
  approval.

### Stable action-rail decision

- The former Control Console spent one permanent row naming its own chrome,
  then inserted a separate status row that shifted every mouse target whenever
  work started, completed, or failed.
- The selected rail keeps its geometry stable: a capped contextual action row
  sits directly above the Command Dock, while transient Working, Ready,
  Notice, Error, and Preview feedback replaces the Dock's right-hand context
  instead of adding height. The activity token keeps its semantic color and
  leads with the affected object so useful text survives truncation.
- At compact widths, when Inbox owns Home's primary action, Restart and Stop
  remain discoverable in `/ Commands` while the visible shelf retains Open Web,
  Logs, and More. Wider terminals keep the full action inventory. Keyboard and
  mouse routes continue to resolve through the same command targets.

### Wide framed-column theme decision

- Removing the Launchpad primary background at wide widths would hide the
  symptom, but weaken the action hierarchy precisely where the visual system
  has the most room to express it.
- Styling a fully composed terminal row is simple, but a row containing two
  adjacent cards is not one semantic surface: the left `[ Enter ]` currently
  causes the right Runtime field to inherit Action Shelf colors.
- The selected model keeps the existing cards, dimensions, and pointer
  geometry while splitting theme decoration at the rendered `│   │` card
  gutter. Each framed column is classified and decorated independently, then
  recomposed with an unstyled gutter. `NO_COLOR` remains byte-for-byte plain,
  and the fix becomes shared protection for every future wide TUI surface.

### Split-pane focus containment decision

- Keeping row-level semantic decoration is simple, but a selected row in one
  pane paints the adjacent Inspector at the same terminal row, visually joining
  two independent surfaces into one focus band.
- Removing background focus from split views would prevent bleed but weaken
  pointer and keyboard position precisely where dense operational lists need it.
- The selected model extends framed-column composition beyond Action Shelves.
  Fleet, Logs, Doctor, Help, and wide Overview rows are split at the rendered
  `│   │` gutter, then selected, hovered, pass/warn/fail, and launch-intent
  semantics decorate only the owning card's inner content. Borders, gutter, and
  semantically neutral neighbor columns remain untouched. Single-pane and
  `NO_COLOR` output keep their current byte contract. This is an autonomous
  topic decision, not a recorded maintainer approval.

### Fleet pane-focus hierarchy decision

- Keeping both selected Machine and selected AliceProject as identical strong
  background rows preserves their relationship, but makes the arrow-key owner
  ambiguous in the wide two-pane hierarchy.
- Highlighting only the active row would clarify focus but make the related
  selection in the other pane disappear as users move between hierarchy levels.
- The selected model follows OMP's focused-container hierarchy with terminal-
  native semantics: the active pane uses a `◆` title and `▶` selected row with
  the strong focus surface; the inactive pane uses a `◇` title and `◁` related
  row with foreground-only context. Hover remains `»`, clicking a pane moves
  the same existing focus state, narrow drill-down keeps one active pane, and
  `NO_COLOR` preserves the hierarchy through glyphs alone. This is an
  autonomous topic decision, not a recorded maintainer approval.

### Fleet pointer activation decision

- Activating any already-selected row on click is compact, but an item may be
  selected only as the related context of an inactive pane. Clicking it then
  drills down or invokes a Runtime action without first moving visible focus.
- Requiring a timed double-click would avoid that ambiguity but add terminal-
  dependent timing and a second activation model beside keyboard Enter.
- The selected model is focus-first and state-based: a click in an inactive
  Fleet pane only moves focus and selection, even when that row is already the
  related item. A subsequent click on the selected row while its pane is active
  invokes the same primary action as Enter. This matches pointer feedback,
  avoids accidental cross-pane activation, and changes no lifecycle callback.
  This is an autonomous topic decision, not a recorded maintainer approval.

### Fleet pane-surface decision

- Restricting hit targets to populated rows avoids ambiguous clicks, but makes
  users precisely target text even though the UI visibly presents two large
  focusable panes.
- Treating every pane click as a selected-row click would enlarge targets while
  weakening the focus-first safeguard and making empty space activate actions.
- The selected model follows OMP's component-focus behavior: pane headers and
  unused body space are focus-only surfaces, an inactive hovered title changes
  from `◇` to `»`, and clicking anywhere on that surface transfers pane focus
  without selecting or activating a row. Populated rows retain their existing
  selection and second-click action semantics; the gutter remains inert. This
  is an autonomous topic decision, not a recorded maintainer approval.

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

### Command palette search decision

- Keeping arrow-only selection would preserve the current compact menu, but it
  would become slower and less discoverable as the Supervisor gains commands.
- Replacing the Palette with a generic Input or dependency SelectList would
  provide text entry while splitting OpenAlice's contextual command ownership,
  pointer geometry, and existing activation callbacks across components.
- The selected model follows OMP's model-browser interaction more closely: a
  stable search rail edits in place, match quality ranks the contextual command
  set, the visible results alone own keyboard/wheel/pointer selection, and a
  truthful empty state keeps the overlay open for correction. Backspace edits,
  Ctrl+U clears, arrows or the wheel select, Enter or a whole-row click invokes
  the same existing Supervisor action, and `/` or Esc closes. No command or
  backend action is added by search.

### Command palette live-input decision

- Keeping the empty search rail as placeholder prose makes the focused overlay
  look static, and the prior single-ASCII-character gate silently rejects CJK
  and other printable Unicode input even though ranking already normalizes it.
- Replacing the search rail with a generic text-input dependency would split
  query, overlay, pointer, and activation ownership again.
- The selected model keeps the owned Palette renderer and turns its search rail
  into a live input surface: an always-present caret pulses at a bounded cadence
  when motion is enabled and remains solid under reduced motion; printable
  Unicode appends up to the existing bound; Backspace removes one code point;
  and compact Chinese intent aliases route to the same English command items.
  Search still cannot create or bypass an action. This is an autonomous topic
  decision, not a recorded maintainer approval.

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

### Event Lens clipboard decision

- Relying on native terminal selection would leave the selected Event Lens row
  without an application action and is unreliable while pointer reporting owns
  ordinary mouse gestures.
- Launching `pbcopy`, `xclip`, PowerShell, or another platform clipboard helper
  would add host binaries and process behavior to the Node-compatible CLI
  distribution boundary.
- The selected model adds an explicit `y` / whole-segment Copy action for the
  currently focused, already bounded and redacted Runtime event. It emits a
  size-capped OSC 52 write only after that user action, never reads clipboard
  contents, and reports the request truthfully because terminal policy may
  reject clipboard writes. Keyboard and mouse share the existing Action Shelf
  input path; empty or filtered-empty lenses expose no false Copy control. This
  is an autonomous topic decision, not a recorded maintainer approval.

### Runtime quiet-lens decision

- A wide, height-filling idle scope initially made Logs look intentionally
  composed, but the real 120×32 Runtime capture showed that its empty border
  claimed more visual weight than the Observatory while presenting no events.
- Inventing activity, a fake waveform, or an automatic live follower would add
  visual energy by lying about the snapshot and widening the bounded Logs
  contract.
- The corrected model spends height only on real evidence. Unloaded,
  loaded-but-quiet, and filtered-empty states become one four-line Runtime Lens
  with explicit `STANDBY`, `QUIET`, or `CLEAR` status, concise
  snapshot/lens/safety context, and one whole-segment `l` or `f` action. The
  remainder becomes honest breathing room above the grounded command rails.
  That action emits the existing keyboard input, so mouse and keyboard still
  share the same reader and filter owners. This is an autonomous topic
  decision, not a recorded maintainer approval.

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

### Doctor Diagnostic Radar decision

- Keeping the unrun Doctor as a loose `Press d` line and the zero-check report
  as a two-line card preserves minimal code, but both states collapse the
  composed application into a sparse legacy command surface.
- Animating invented probes or treating zero returned checks as healthy would
  look active while misrepresenting the read-only report contract.
- The selected model reuses the shared Signal Scope primitive as a Diagnostic
  Radar. `DOCTOR STANDBY` exposes read-only mode, intended scope, and zero writes;
  `NO CHECKS` truthfully names an empty completed report. Each ends in one
  pointer-capable `d` action segment routed through the existing Doctor input.
  Populated reports retain the checklist/Inspector model. This is an autonomous
  topic decision, not a recorded maintainer approval.

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

### Secondary-task workspace decision

- Keeping Setup, Source, AliceProject, and Release as centered overlays preserves
  their current implementation, but the Overview remains visible through every
  unused row and around both pane edges. At a 120x32 terminal this creates
  collisions between unrelated cards and makes a polished task surface read as
  a dialog pasted onto an older dashboard.
- Enlarging each overlay independently would hide more of the collision, but
  leave four subtly different origins, margins, and resize behaviors.
- Replacing the whole Supervisor with a second full-screen application for each
  task would provide isolation at the cost of duplicated navigation, terminal
  lifecycle, and pointer ownership. The selected model is therefore one shared
  Focus Workspace: at 100x28 and above, the active task owns every row between
  the persistent Mission Header and Control Console, blank surplus rows are
  deliberately cleared, and the existing renderer and input state machine are
  composed inside that stage. Smaller terminals retain the bounded responsive
  task sheet so complete stacked content is not clipped. This is an autonomous
  topic decision, not a recorded maintainer approval.

### Focus-workspace quiet-field decision

- Leaving the newly cleared rows completely blank gives the task room to
  breathe, but a 120x32 capture still reads as a compact dialog followed by an
  unfinished lower half.
- Stretching the split cards to the Control Console would fill the viewport,
  but only turn the same six settings or three release lanes into oversized
  empty boxes.
- Filling the area with animated telemetry would look active while inventing
  state that these configuration tasks do not own. The selected model follows
  OMP's setup-stage hierarchy: a quiet `Focus Trajectory` uses only the task's
  existing ordered contract and owner boundary. Setup shows Inspect/Edit/
  Validate/Save; Source shows Select/Validate/Save/Launch; Projects shows
  Inspect/Select or Create/Remember; Release shows Choose/Probe/Confirm/Install.
  It is centered in genuine surplus rows, publishes no pointer target, and is
  omitted below the existing 100x28 Focus Workspace boundary. This is an
  autonomous topic decision, not a recorded maintainer approval.

### Transfer focus-workspace decision

- Keeping Remote Transfer centered over Fleet preserves current coordinates,
  but a real 110x30 destination frame shows Fleet selection, capability text,
  and card borders crossing directly through the Flight Deck and Safety Rail.
- Rebuilding Transfer as another task renderer would remove that collision at
  the cost of duplicating its already-complete eight-stage route, Mission
  Brief, validation, review, streaming, recovery, and arrival state machine.
- The selected model moves the existing Flight Deck unchanged into the shared
  Focus Workspace after source and destination preflight succeeds. Navigation
  and Context Ribbon identify `TRANSFER`; every row between Header and Console
  is cleared; the Flight Deck's own eight stages remain the only trajectory.
  Narrow terminals retain the existing bounded sheet, and confirmations remain
  true centered modals. This is an autonomous topic decision, not a recorded
  maintainer approval.

### Focus Console decision

- Keeping the underlying Overview or Fleet Action Shelf visible is cheap, but
  makes a focused task advertise commands that no longer own keyboard or mouse
  input. A real Transfer frame still said Browse projects and Transfer after
  the Flight Deck had already taken control.
- Removing the Control Console entirely would avoid that false contract while
  throwing away the stable bottom anchor, task identity, and global terminal
  rhythm that now distinguish the Supervisor.
- The selected model lets the active task own the full Focus Console. A
  task-specific one-line Action Shelf exposes Enter, movement, and Back using
  the task's vocabulary; the Command Spine becomes `FOCUS WORKSPACE` plus a
  real Esc exit instead of advertising unavailable `/` and `q` controls. Both
  rows route pointer input back to the same active overlay component, so the
  footer is operational rather than decorative. Closing the task restores the
  prior panel Console unchanged. This is an autonomous topic decision, not a
  recorded maintainer approval.

### Focus Header decision

- Leaving Overview, Machines, Logs, Doctor, and Help visible preserves the
  normal rail, but every label becomes a false affordance once an overlay owns
  pointer and keyboard input. Clearing only the selected brackets does not tell
  the user that page navigation has intentionally yielded to the task.
- Allowing those tabs to remain live would punch through the focused workflow,
  create ambiguous overlay lifetime, and make Back/validation semantics depend
  on an unrelated page switch.
- The selected model replaces the page rail with a task-owned Focus Header for
  the overlay lifetime. It names the task surface and its existing contract,
  anchors a real `[ Esc ] Back` at the right edge, publishes no page targets,
  and routes that Back segment to the same active overlay component. The rail
  below becomes a quiet divider with no stale selection beacon. Closing the
  task restores the complete operational navigation unchanged. This is an
  autonomous topic decision, not a recorded maintainer approval.

### Focus build-provenance decision

- Keeping `[ u ]` in the Mission Header preserves the normal frame, but falsely
  advertises a Release control while a focused overlay explicitly prevents
  opening another task. Its current inertness is an event-routing accident, not
  an honest interaction contract.
- Making Release live through the overlay would create nested task ownership
  and bypass the Focus Header and Console Back semantics.
- The selected model keeps version, channel, and update provenance visible but
  removes the keycap and pointer target for the focused-task lifetime. The
  normal `[ u ]` Release Control returns unchanged when the task closes. This
  is an autonomous topic decision, not a recorded maintainer approval.

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

### Transfer Mission Control decision

- Keeping review, streaming, failure, and completion as unrelated text blocks
  would preserve their callbacks, but the Flight Deck would still lose visual
  continuity exactly when checksum evidence, cancellation, recovery, and the
  final Runtime choice matter most.
- Replacing those phases with a separate full-screen transfer application could
  expose more telemetry, but would duplicate the existing plan, sender, retry,
  abort, and activation controller and compete with the Flight Deck route.
- The selected model follows OMP's stable framed status hierarchy: one Mission
  Control region projects four semantic cards — Manifest, In Flight, Recovery,
  and Arrival — with a strong state signal, bounded evidence, and complete
  action shelves. The existing plan review renderer, progress callback, retry
  decision, receipt, and Start/Open/Done handlers remain authoritative. Wide and
  80×24 layouts retain the same information and pointer targets; only spacing
  and progress-meter width respond.

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

### OMP-style Command Spine decision

- Recoloring the flat context ribbon would improve contrast while preserving
  its status-string silhouette and weak relationship to the rest of the frame.
- Copying OMP's two-row prompt/status frame would create the strongest visual
  likeness, but consume another row at the required 80×24 baseline even though
  Supervisor has no text prompt to justify it.
- The selected model evolves the existing one-row ribbon into a bottom Command
  Spine. `╰─`/`─╯` close the application visually, a flexible `─` track joins
  controls to context, and `›` breadcrumbs express AliceProject → Runtime →
  active view. Wide layouts retain every segment; constrained layouts remove
  view, project, then context before ever losing Commands or Detach. Color
  terminals give controls, identity, Runtime, and view distinct tones on one
  continuous rail; `NO_COLOR` keeps the same glyph hierarchy. Existing keycaps,
  pointer targets, overlay routing, and one-row geometry remain authoritative.

### Narrow Command Spine closure decision

- Keeping the wide Spine compositor unchanged below 60 columns leaves an empty
  right-context separator after responsive removal, producing a visible double
  gap and a detached one-character rail before `╯`.
- Hiding the track entirely would remove the artifact but weaken the visual
  closure that makes the Spine part of the application frame.
- The selected model gives the no-context state its own continuous closure:
  Commands and Detach keep identical text and pointer targets, then one elastic
  track runs directly into `─╯`. Context-bearing widths retain the existing
  breadcrumb separator and suffix. This is an autonomous topic decision, not a
  recorded maintainer approval.

### Command Dock persistent-Spine routing decision

- Letting every pointer event outside any overlay fall through to the
  application would make the visible Spine work, but could activate obscured
  controls behind confirmation, Setup, transfer, and other focused overlays.
- Teaching the overlay router a duplicate bottom-margin Close target would fix
  one label while creating a second source of Command Spine geometry.
- The selected model grants only the Command Dock one persistent-chrome route.
  While it is active, the Supervisor first hit-tests the final rendered Spine
  targets; Close, Detach, and visible AliceProject therefore keep their exact
  Screen-owned geometry and existing input handlers. A miss routes normally to
  the Dock overlay, while every other overlay remains strictly modal. Hover
  also clears when the pointer returns to Dock content. This is an autonomous
  topic decision, not recorded maintainer approval.

### Adaptive wide-Overview stage decision

- Leaving all surplus height between the Context Tip and Control Console keeps
  the cards compact, but a live 120x32 comparison with OMP v17.3.4 shows that
  the primary OpenAlice surface then ends near the top of the terminal and
  leaves most of the viewport as unowned whitespace.
- Stretching every panel would make short lists and bounded Logs or Doctor
  inspectors look artificially empty, and would blur their existing scrolling
  contracts.
- The selected model lets only the wide two-column Overview absorb a bounded
  share of available height. Both cards gain the same quiet interior rows while
  their existing primary action and Uptime anchors stay aligned at the bottom;
  the AliceProject context rail, Context Tip, and Control Console retain their
  order and the console remains terminal-grounded. The stage never grows beyond
  17 rows and widths below 100 keep their existing dense layouts. This is an
  autonomous topic decision, not recorded maintainer approval.

### Framed Control Console decision

- Styling the existing Activity Slot and Action Shelf more aggressively would
  preserve every byte of layout, but would leave three visually disconnected
  rows pretending to be one console.
- Adding a separate frame above and below the existing rows would create a
  convincing panel at the cost of two more terminal rows and would move every
  bottom pointer target on constrained screens.
- The selected model recomposes the existing rows without increasing height.
  The Activity Slot becomes an OMP-composer-style top rail whose label changes
  with Working, Ready, Notice, Error, Status, or Preview state; its idle label is
  `CONTROL CONSOLE`. Every responsive Action Shelf row becomes framed body
  content, and the existing Command Spine remains the closing border. Commands
  still derive pointer geometry from their final framed layout, feedback keeps
  its priority and fixed slot, and `NO_COLOR` retains the same structural box.
  This is an autonomous topic decision, not recorded maintainer approval.

### Viewport-aware Fleet window decision

- Stretching the two Fleet panes to consume all surplus height would make the
  page look grounded, but blank pane rows would become large focus-only mouse
  surfaces without exposing more useful inventory.
- Applying one height rule to Fleet, Logs, Doctor, and Help would ignore their
  different bounded-reader and inspector semantics.
- The selected model expands only Fleet's real visible window. At 72 columns
  and wider, the viewport budget may raise the five-row baseline up to the
  larger of the current Machine or selected AliceProject inventories; it never
  creates rows beyond real inventory. Rendering, scroll rails, and pointer
  mapping share that final row count. Narrow drill-down keeps five rows, short
  terminals preserve the natural complete layout, and remaining surplus stays
  in the elastic stage. This is an autonomous topic decision, not recorded
  maintainer approval.

### Sparse Fleet Selection Constellation decision

- Extending the Machine and AliceProject panes to the bottom would create
  blank focus-only rows that look selectable but contain no additional
  inventory.
- An ambient constellation could own the empty viewport visually, but would
  imply Fleet telemetry without helping the user understand the selected
  Machine or AliceProject.
- The selected model spends wide-screen surplus on a passive Selection
  Constellation only when at least nine complete detail rows fit. It visualizes
  the real Machine to AliceProject to Runtime/Web route and expands the existing
  product, port, owner, uptime, services, capability, and refresh facts. Dense
  inventory still receives rows before detail, detail never publishes a
  pointer target, and ordinary 80x24, narrow, or constrained terminals retain
  the two-row Selection inspector. This is an autonomous topic decision, not
  recorded maintainer approval.

### Operational Canvas decision

- Stretching every Supervisor page to the viewport would produce one uniform
  silhouette, but Help, Setup, and bounded modal workflows would gain empty
  framed regions with no additional information or interaction meaning.
- Keeping Logs and Doctor compact while enlarging only the elastic stage would
  preserve their current implementation, but a live 120x32 comparison with OMP
  v17.3.4 shows the old CLI break clearly: the operational surface ends after
  seven rows while the rest of the terminal becomes unowned background.
- The selected model gives only Logs and Doctor an OMP-inspired Operational
  Canvas at 100 columns and wider. Populated readers spend available height on
  additional real bounded events or checks, with render windows, scroll rails,
  and pointer targets sharing the final count. Standby, quiet, and filtered-
  clear Signal Scopes instead keep their truthful facts top-anchored and their
  existing primary action bottom-anchored inside the same framed surface. The
  surplus quiet region carries only a centered, non-interactive echo of that
  truthful state glyph; it does not imply an event, check, or progress value.
  The 80x24, narrow, and constrained-height contracts retain their current
  compact density. This is an autonomous topic decision, not recorded
  maintainer approval.

### Rail Navigator decision

- Keeping proportional rails as positional evidence preserves the current
  mouse-wheel and full-row selection model, but the `│`/`█` surface looks like
  a control and then refuses the most direct pointer interaction.
- Making track clicks page above or below the thumb would match a conventional
  desktop scrollbar with little state, but it remains coarse in long bounded
  snapshots and does not reward the terminal's all-motion SGR reports.
- OMP v17.3.4 keeps `ScrollView` geometry independent from selection while its
  list components own mouse routing. The selected OpenAlice model retains that
  separation and adds one Rail Navigator contract across Logs, Doctor, and both
  Fleet panes: hover exposes a structural marker and consequence preview; a
  left press selects a proportional real item and begins a rail-owned drag;
  left-button motion continuously scrubs; release ends the drag. The rail only
  changes focus/selection and never activates an AliceProject, lifecycle action,
  diagnostic request, or log reload. Wheel, row-click, and keyboard behavior
  remain unchanged. This is an autonomous topic decision, not recorded
  maintainer approval.

### Bottom Control Console decision

- Leaving the footer directly after page content preserves the current natural
  line count, but makes taller terminals read like a report printed at the top
  of an otherwise unused canvas. In a live 120x32 comparison, OpenAlice ended
  its Command Spine ten rows above the terminal edge while OMP kept its global
  controls grounded at the bottom.
- Distributing spare rows through cards would fill the canvas, but make content
  and pointer geometry drift vertically as the terminal grows.
- The selected model treats Activity Slot, contextual Action Shelf, and Command
  Spine as one bottom Control Console. A single elastic stage between page
  content and that console absorbs only surplus terminal rows, so content stays
  top-anchored and every control settles against the bottom edge. Short
  terminals keep the existing natural flow without clipping or compression.
  The viewport height is read at render time so resize updates the stage without
  resetting focus, selection, or action state. This is an autonomous topic
  decision, not recorded maintainer approval.

### Context Tip Beacon decision

- Leaving the elastic stage completely blank keeps the composition calm, but
  wastes the exact space OMP uses to teach high-value interactions without
  opening Help.
- Filling the stage with an ambient constellation or animated telemetry would
  look more decorative, but add motion and visual competition without helping
  a user operate the Supervisor.
- The selected model ports OMP's contextual Tip pattern into one quiet Tip
  Beacon. Overview changes its hint with Runtime state; Fleet, Logs, Doctor,
  Help, and Recovery each explain the most useful non-obvious interaction on
  that surface. The Beacon occupies the elastic stage only when at least one
  blank row can remain between page content and the hint, so it never grows the
  natural layout or moves the bottom Control Console. It has no pointer target,
  action, timer, or backend read. Color gives only its `Tip:` lead-in emphasis;
  `NO_COLOR` preserves identical text. This is an autonomous topic decision,
  not recorded maintainer approval.

### Mission Header decision

- Recoloring the existing title, divider, and tabs would be the least invasive
  change, but preserve three unrelated horizontal strips and leave the global
  shell visually unfinished above the framed Launchpad.
- Wrapping the whole application in an additional multi-row outer frame would
  create the strongest container, but take content rows and columns away from
  the supported 80×24 surface.
- The selected model recomposes the same three rows as a Mission Header: the
  first row frames brand and release provenance, the second frames the complete
  segmented navigation, and the third closes the rail. Navigation renders
  against the true inner width and offsets its published pointer geometry into
  the frame, so compact/minimal labels, mouse hit regions, and `NO_COLOR`
  structure remain authoritative. This is an autonomous topic decision, not a
  recorded maintainer approval.

### Mission Header View Beacon decision

- Cross-fading or sliding whole page bodies would make navigation feel lively,
  but destabilize operational text and pointer geometry during the transition.
- Adding a separate active-view status row would preserve content, but repeat
  information already present in the selected tab and Command Spine.
- The selected model uses one junction glyph on the Mission Header's existing
  closing rail as a View Beacon. It rests beneath the selected tab and, when
  motion is enabled, follows a short eased path from the previous tab to the
  next. Reduced motion lands directly on the final column. The renderer uses
  the exact responsive navigation targets, so wide, compact, and minimal labels
  share one source of geometry. This is an autonomous topic decision, not a
  recorded maintainer approval.

### Mission Header Release Control decision

- Leaving version, channel, and update availability as decorated text keeps
  provenance visible but forces mouse users to discover `u` elsewhere.
- Adding a dedicated update row would make the action explicit at the cost of
  another scarce baseline row and duplicate the Release Observatory.
- The selected model turns the Mission Header's existing provenance tail into
  a Release Control. Wide layouts expose `[ u ]`; compact layouts keep a `↗`
  affordance while preserving the full installed version and channel. The
  renderer publishes the exact truncated segment geometry for hover and click,
  and activation routes through the existing `u` handler. No network request
  occurs until the Observatory's explicit Check action. This is an autonomous
  topic decision, not a recorded maintainer approval.

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

### Launchpad brand-beacon decision

- Copying OMP's full-screen welcome composition would create a memorable first
  frame, but delay operational truth and crowd the required 80×24 experience.
- Translating the official Alice pixel portrait into terminal blocks would be
  closer to the raster asset, but recognition would depend on a large canvas
  and color fidelity that `NO_COLOR` and narrow terminals cannot promise.
- The selected model is a wide-only, three-row `ALICE` pixel wordmark Beacon
  above the existing Overview cockpit. It pairs the mark with the selected
  AliceProject and truthful Runtime state, reuses the bounded brand entrance
  sweep, remains meaningful without color, and appears only from 116 columns.
  The action-first Launchpad, 80×24 geometry, and lifecycle callbacks remain
  unchanged.

### Responsive Signal Deck decision

- Keeping the brand Beacon wide-only preserves the existing layout, but live
  comparison with OMP v17.3.4 shows that OpenAlice loses its strongest visual
  identity in the ordinary 80-column terminal where the experience matters
  most.
- Adding another standalone hero card at standard widths would reproduce OMP's
  welcome-screen impact, but consume vertical capacity and push operational
  controls toward or beyond the 80x24 boundary.
- The selected model composes the existing three-row `ALICE` mark, local-control
  identity, and truthful Runtime state into the left side of the existing
  Runtime card from 72 through 99 columns. The complete telemetry remains on
  the right at the same card height; below 72 columns the original text stack
  remains authoritative. From 100 columns the existing full Beacon becomes the
  wide composition. Brand entrance, `NO_COLOR`, reduced motion, lifecycle
  actions, and pointer geometry keep their current owners. This is an
  autonomous topic decision, not a recorded maintainer approval.

### Integrated wide Launchpad decision

- Keeping the standalone wide Beacon maximizes brand area, but repeats the
  selected AliceProject and Runtime state immediately above the Launchpad that
  owns the same identity and action. The result reads as three stacked cards
  rather than one operational welcome surface.
- Wrapping brand, Launchpad, and Runtime in one giant compound frame would most
  closely copy OMP's Welcome card, but merge action and telemetry into one
  semantic styling and pointer container.
- The selected model retires the standalone Beacon at 100 columns and wider and
  integrates the same three-row `ALICE` mark into the Launchpad pane. Project
  identity and launch intent remain above it; complete guidance wraps beside
  the mark, and the existing primary action remains the final row. Runtime stays
  an independent right-hand pane so its passive telemetry cannot inherit action
  focus or color. The 72–99 Signal Deck and below-72 compact flow remain
  unchanged. Brand entrance/prism styling, `NO_COLOR`, and every lifecycle and
  pointer callback keep their existing owners. This is an autonomous topic
  decision, not recorded maintainer approval.

### Ambient brand-prism decision

- Keeping the bounded entrance as the only brand motion is quiet and cheap,
  but the Signal Deck settles back into the same static texture as every other
  status card after less than a second.
- Copying OMP's continuously changing welcome composition across the complete
  Overview would feel alive, but redraw operational content behind focused
  overlays and compete with Working, confirmation, and error states.
- The selected model gives only the visible `ALICE` mark a slow six-phase prism
  loop after the entrance settles. It advances once per 240ms, leaves geometry
  and all surrounding telemetry byte-stable, and pauses while any compositor
  overlay, confirmation, or busy operation owns attention. Closing the overlay
  resumes the same phase. `NO_COLOR` and reduced motion never start the ambient
  timer. This is an autonomous topic decision, not a recorded maintainer
  approval.

### Startup Boot Sequence decision

- Keeping the current immediate first frame is fastest, but a live 120x32 OMP
  v17.3.4 comparison shows the missing transition clearly: the shell becomes a
  framed status page without first becoming an owned OpenAlice surface.
- Copying OMP's 2.6-second animated setup splash literally would maximize
  spectacle, but it would delay a lifecycle console on every ordinary launch
  and import Pi-specific water/logo imagery that does not belong to OpenAlice.
- The selected model creates an original OpenAlice Boot Sequence from the
  existing `ALICE` mark, brand prism, deterministic signal field, and truthful
  AliceProject/Machine/Runtime stages. It owns the complete terminal for at most
  sixteen existing 80ms motion ticks, then hands off to the normal Mission
  Header without mutating or rereading Runtime state. Any ordinary key or left
  click skips and is consumed instead of activating the surface underneath;
  `q` and Ctrl-C still detach immediately. Reduced motion, `NO_COLOR`, test
  processes, or `OPENALICE_TUI_BOOT=0` bypass the sequence; tests may opt in
  explicitly with `OPENALICE_TUI_BOOT=1`. This is an autonomous topic decision,
  not recorded maintainer approval.

### Wide Overview control-path decision

- Returning the 120-column Overview to natural-height cards would remove the
  mechanical empty rows, but it would reopen the unowned center interval that
  the adaptive stage was introduced to solve.
- Filling the stage with an abstract waveform or star field would be visually
  louder, but it would imply telemetry that the Supervisor does not own and add
  no operational understanding after the new Boot Sequence hands off.
- The selected model spends only real wide-screen surplus on a passive Control
  Path and Service Array inside the existing paired stage. The path visualizes
  the already-known AliceProject, Runtime, and Web readiness; the service array
  decomposes the already-reported Alice, UTA, and Connector states. It adds no
  read, mutation, focus target, or lifecycle route, preserves the compact
  80x24 surface, and keeps reduced-motion output structurally identical. This
  is an autonomous topic decision, not recorded maintainer approval.

### Wide Help Control Atlas Board decision

- Stretching the existing selector/detail pair would retain its one-category-at
  a-time hierarchy and merely move the unused space inside larger borders.
- Three equal horizontal cards would expose every category, but Runtime's eight
  commands would either wrap unpredictably or make that card much taller than
  Navigation and AliceProject.
- The selected model replaces only the wide, tall ordinary Help surface with a
  vertical Control Atlas Board. Navigation, Runtime, and AliceProject stay
  simultaneously visible as full-width sections whose commands form a bounded
  two-column grid; hovering or clicking any row focuses its owning section.
  Short terminals retain the existing responsive selector/detail inspector,
  and configuration Recovery retains its deliberately narrow safe-control
  vocabulary. The board adds no operational action or mutation. This is an
  autonomous topic decision, not recorded maintainer approval.

### Bottom Command Dock decision

- Keeping the centered Command Palette preserves the existing overlay shell,
  but the unfiltered nine-command list occupies roughly half of an 80x24
  terminal and turns the still-useful Launchpad and Signal Deck into backdrop.
- Replacing it with an unframed autocomplete list would copy OMP most literally,
  but would discard OpenAlice's established panel identity and make the focused
  input boundary weaker in no-color terminals.
- The selected model keeps the searchable command contract inside a shallow
  bottom-anchored Command Dock. It spans the available width above the Command
  Spine, shows at most four results around the current selection, and exposes
  the complete result position so keyboard and wheel movement can reach every
  command without growing the overlay. Filtered and empty states contract to
  their content. The existing activation, confirmation, refusal, and detach
  paths remain the only action owners. This is an autonomous topic decision,
  not a recorded maintainer approval.

### Hover Preview Rail decision

- Keeping hover as color-only feedback preserves the current geometry, but a
  pointer user still has to click before learning whether a short label opens,
  mutates, confirms, or merely changes focus.
- Adding tooltips beside every control would provide local explanations, but
  introduces transient geometry, collision, and dismissal behavior throughout
  the terminal frame.
- The selected model projects the hovered control's consequence into the
  existing fixed Activity Slot. Working, Error, Notice/Ready/Status, Preview,
  and blank form a strict priority order, so operational feedback can never be
  displaced by hover. Moving off the target restores the previous rail without
  changing layout. Navigation, Action Shelf, and Command Spine targets share
  the same preview language; activation remains owned by their existing key
  paths. This is an autonomous topic decision, not a recorded maintainer
  approval.

### Signal Hotspots decision

- Keeping Overview telemetry read-only avoids accidental actions, but also
  makes the visual object a dead end: a pointer user sees the verified Web
  endpoint or selected AliceProject and must then hunt for a shortcut elsewhere.
- Making every Runtime field clickable would over-promise controls for passive
  facts such as PID, services, and uptime, and would weaken the Launchpad's
  primary-action hierarchy.
- The selected model promotes only identity and telemetry with a truthful,
  already-owned route: AliceProject opens the Switchboard, a verified Web
  endpoint opens the existing browser path, and Provider opens Source only
  while the Runtime is stopped. `⌂`, `↗`, and `⑂` expose those affordances;
  hover becomes `›`, highlights the complete field, and projects its consequence
  into the fixed Activity Slot. Click still emits only `i`, `o`, or `c`, so
  lifecycle, refusal, overlay, and recovery ownership remain unchanged. This is
  an autonomous topic decision, not a recorded maintainer approval.

### Confirmation-modal decision

- Keeping the centered card over an unchanged application frame preserves
  geometry, but a live 120x32 capture showed chopped Launchpad text beside the
  card and still-bright Commands, Setup, and Source controls that no longer own
  input.
- Dimming that frame would reduce contrast but preserve both the fragmented
  background copy and the false control inventory.
- The selected model follows the focus ownership observed in OMP v17.3.4's live
  Models surface: the bounded confirmation card remains centered, while a
  `DECISION GATE` clears the operational field and replaces navigation and the
  bottom console with confirmation-specific identity, Confirm, and Cancel.
  Version/update provenance stays visible but read-only. Enter/Esc and complete
  pointer segments still feed the one existing confirmation state machine;
  acceptance closes the gate before work feedback appears, and cancellation
  restores the exact previous page without mutation. This is an autonomous
  topic refinement, not a recorded maintainer approval.

### Decision action-language decision

- A generic bottom `Confirm / Cancel` shelf keeps the Decision Gate reusable,
  but a live Stop frame showed it contradicting the focused card's precise
  `Stop Runtime / Keep running` safety language.
- Repeating the action-to-label mapping inside the Screen would make the chrome
  precise while allowing modal and Console wording to drift independently.
- The selected model lets the centered card and grounded Console render one
  shared confirmation Action Shelf projection. Stop, Restart, managed Source,
  and Update therefore preserve their exact positive and refusal labels at
  every visible activation edge, while Enter/Esc still enter the existing
  confirmation state machine. This is an autonomous topic decision, not a
  recorded maintainer approval.

### Decision mission-header decision

- Keeping `CONFIRMATION / CONFIRM OR CANCEL / Cancel` in the Mission Header
  preserves a stable generic title, but leaves the most prominent task boundary
  contradicting the precise action language now shared by the card and Console.
- Mapping confirmation kinds to a second set of Header labels would make the
  chrome specific while recreating the wording-drift risk removed from the
  Action Shelf.
- The selected model projects the same resolved confirmation view into all
  Decision Gate boundaries. The Header uses the positive action as its
  task identity, retains the review contract, and uses the refusal label for
  its Esc target; the centered card and grounded Console keep using the same
  labels. Responsive fallback drops contract detail before it drops the exact
  task or refusal.
  This is an autonomous topic refinement, not a recorded maintainer approval.

### Adaptive Runtime telemetry decision

- Keeping three fixed `Alice/UTA/Connector not reported` rows preserves the
  reported-service geometry, but presents one missing snapshot as three
  negative-looking component states and wastes the most valuable wide pane.
- Hiding component rows and uptime whenever they are absent would make the pane
  quieter, but unexplained whitespace would leave users unable to distinguish
  unsupported telemetry from a delayed or stopped Runtime.
- The selected model gives the Runtime pane an explicit Telemetry identity and
  adapts its content contract. Reported component snapshots retain the
  three-service array; an absent snapshot becomes one bounded pending cluster
  that names the expected components and explains whether launch or reporting
  is pending. Wide uptime remains anchored but distinguishes a stopped Runtime
  from a live Runtime whose uptime was not reported. This is an autonomous topic
  refinement, not a recorded maintainer approval.

### Empty-state control ownership decision

- Keeping the normal Logs and Doctor shelves visible in an empty Signal Scope
  preserves fixed command positions, but advertises Scroll, Copy, Inspect,
  Latest, First, and Last when no event or check can receive those actions.
- Hiding the entire Action Shelf would make the empty state visually quiet, but
  would also remove the safe Reload/Rerun path that can resolve it.
- The selected model gives each empty Signal Scope a contextual shelf and Tip.
  Logs retain Reload, filter cycling, and Help; Doctor retains Run/Rerun and
  Help. Object-dependent navigation and copy actions appear only when filtered
  events or diagnostic checks exist. The full keyboard handlers remain safe,
  but the visible control surface describes only truthful current affordances.
  This is an autonomous topic refinement, not a recorded maintainer approval.

### Active Runtime with missing Project home decision

- Keeping `missing` as the sole Fleet status preserves a simple availability
  rule, but hides a Runtime that the Supervisor has just verified is still
  serving a Web endpoint.
- Prioritizing `running` would make the global LIVE state and Fleet row agree,
  but would conceal that the remembered AliceProject home can no longer support
  ordinary file-backed project operations.
- The selected model renders one compound attention state: `running · home
  missing` or `external · home missing`. The active control route and verified
  Web endpoint remain visible, while the row no longer presents the project as
  normally available. A purely missing, inactive project keeps the quieter
  `missing` state. This is an autonomous topic refinement, not a recorded
  maintainer approval.

### Compound Runtime signal decision

- Leaving the Command Dock at green `LIVE` preserves its narrow Runtime-only
  contract, but visually overrules the adjacent Fleet warning at the strongest
  persistent status boundary.
- Replacing LIVE with a generic warning would acknowledge the missing home, but
  discard the verified fact that the Runtime and Web route remain online.
- The selected model projects the same dual truth into the Dock as `LIVE · HOME
  MISSING` or `EXTERNAL · HOME MISSING` and styles that complete signal as a
  warning. Normal active projects keep the green LIVE/EXTERNAL signal, while
  focus and responsive fallbacks consume the same projection. This is an
  autonomous topic refinement, not a recorded maintainer approval.

### Compound Launchpad decision

- Keeping Overview Runtime-only would leave its green RUNNING badge, LIVE
  intent, and ordinary Home rail contradicting the persistent compound Dock.
- Treating the whole Launchpad as failed would hide the verified Web route and
  turn a recoverable file-ownership edge into a false Runtime outage.
- The selected model keeps Open as the primary action while projecting
  `RUNNING · HOME MISSING`, `LIVE RUNTIME · PROJECT HOME MISSING`, and an
  explicit missing-Home rail through wide and compact Overview layouts. The
  briefing explains that Open uses the verified Web route. Healthy and stopped
  Launchpads retain their current hierarchy. This is an autonomous topic
  refinement, not a recorded maintainer approval.

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
- [x] Represent an active Runtime whose AliceProject home disappeared as one
  compound Fleet state without hiding either the live route or missing home.
- [x] Carry that compound warning into the persistent Command Dock without
  changing healthy LIVE/EXTERNAL styling or narrow responsive behavior.
- [x] Reconcile the Overview Launchpad, Runtime signal, briefing, and Home rail
  with the same live-Runtime/missing-home truth while retaining verified Open.
- [x] Dogfood the real `pnpm cli` surface across wide, 80x24, and narrow sizes;
  inspect mouse, resize, copy/selection, signal exit, and failure recovery.
- [x] Run the owning package typecheck and tests, affected tests, full hermetic
  tests at dependency/shared-renderer boundaries, and installer/package smoke
  when the distributed payload changes.
- [x] Replace the plain Working/Notice/Diagnostic tail with a semantic,
  full-width activity rail and purposeful OMP-inspired busy animation.
- [x] Add a bounded one-shot entrance treatment and subtle Runtime heartbeat;
  preserve the static reduced-motion frame as the complete experience.
- [x] Add an OMP-inspired wide Launchpad brand Beacon without displacing the
  complete 80×24 operational frame.
- [x] Compose that identity into a responsive Signal Deck at standard widths
  and promote the complete Beacon to the 100-column wide cockpit.
- [x] Give the responsive brand mark an overlay-aware ambient prism while
  keeping operational content and reduced-motion frames static.
- [x] Replace the centered Command Palette with a shallow bottom Command Dock
  that keeps every command reachable without obscuring the operational frame.
- [x] Project hovered control consequences into the fixed Activity Slot without
  displacing operational feedback or creating another action path.
- [x] Promote actionable Overview identity and telemetry into responsive
  whole-field pointer hotspots backed only by existing keyboard routes.
- [x] Turn Overview into a responsive AliceProject/Runtime cockpit without
  changing lifecycle action semantics or sacrificing the 80x24 baseline.
- [x] Promote Overview into an action-first Launchpad with a semantic intent
  strip and whole-row primary-action pointer target.
- [x] Make the Overview Launchpad the single truthful primary surface and keep
  its Action Shelf focused on supporting commands.
- [x] Contain semantic Action Shelf color inside its framed column when wide
  layouts compose adjacent cards.
- [x] Contain split-pane selection, hover, diagnostic, and launch-intent styling
  inside the owning framed column.
- [x] Separate Fleet's active keyboard/pointer pane from its related inactive
  selection with container and row-level focus hierarchy.
- [x] Make Fleet pointer activation focus-first so an inactive related row
  cannot invoke its pane's primary action on the first click.
- [x] Make Fleet headers and unused pane space focusable pointer surfaces while
  keeping row activation and the inter-pane gutter isolated.
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
- [x] Keep zero-event Runtime Logs in a compact Runtime Lens that preserves
  truthful snapshot state and existing `l`/`f` actions without claiming canvas
  height.
- [x] Replace the static Command Deck with a contextual, selectable, whole-row
  mouse-capable Command Palette.
- [x] Upgrade the Command Palette with OMP-inspired in-place fuzzy search,
  ranked results, and a corrective empty state without adding action paths.
- [x] Turn the Palette search rail into a live Unicode input with a bounded
  caret pulse and English/Chinese intent aliases over the same command model.
- [x] Replace Doctor's flat line scroller with a responsive, selectable
  checklist and detail Inspector.
- [x] Replace Doctor's loose unrun/zero-check messages with a shared responsive
  Diagnostic Radar that preserves its read-only `d` action.
- [x] Replace Help's static shortcut wall with a responsive, pointer-aware
  Control Atlas while keeping the Command Palette as the fast execution path.
- [x] Give every Supervisor overlay list, input, and visible command keycap the
  same pointer semantics as the application frame.
- [x] Turn the bottom command dock into a persistent, pointer-aware
  AliceProject/Runtime/view context ribbon.
- [x] Evolve the flat context ribbon into an OMP-style one-row Command Spine
  with a closing frame, semantic breadcrumbs, and whole-segment pointer targets.
- [x] Close the context-free narrow Command Spine with one continuous track
  while preserving Commands/Close and Detach pointer geometry.
- [x] Anchor Activity Slot, Action Shelf, and Command Spine as one bottom
  Control Console without changing page content or action semantics.
- [x] Add one OMP-inspired contextual Tip Beacon to surplus stage space without
  consuming a required row or adding an action path.
- [x] Fold the standalone wide Beacon into the action-first Launchpad without
  duplicating identity or losing guidance, motion, or pointer geometry.
- [x] Turn the first terminal frame into a skippable OpenAlice Boot Sequence
  without delaying reduced-motion startup or allowing input click-through.
- [x] Replace mechanical wide-Overview filler with a truthful animated Control
  Path and passive Service Array without changing compact terminal behavior.
- [x] Replace wide Help's one-category inspector with an all-system Control
  Atlas Board while preserving compact and Recovery behavior.
- [x] Turn sparse wide Fleet surplus into a truthful passive Selection
  Constellation without creating fake inventory or action targets.
- [x] Keep the visible Command Spine mouse-capable while the Command Dock owns
  overlay input, without enabling click-through for any other modal surface.
- [x] Let the wide Overview absorb a bounded share of surplus terminal height
  instead of dumping the entire remainder into an unowned blank stage.
- [x] Recompose Activity, actions, and Command Spine into one same-height framed
  Control Console with stateful OMP-style top-rail feedback.
- [x] Let wide Fleet spend available height on additional real inventory rows
  before showing a scroll rail or leaving the remainder to the elastic stage.
- [x] Give populated Logs and Doctor an Operational Canvas that spends wide
  viewport height on additional real events and checks.
- [x] Let truthful Logs and Doctor Signal Scopes own the same wide canvas with
  top-anchored facts and a bottom-anchored primary action.
- [x] Turn every overflowing Logs, Doctor, Machine, and AliceProject rail into
  one hoverable, clickable, left-drag Rail Navigator.
- [x] Collapse the title/divider/tabs stack into a two-row Mission Rail that
  frames brand, release provenance, and clickable navigation.
- [x] Remove the decorative traveling View Beacon so selected state changes
  immediately through foreground emphasis, brackets, and pointer hover.
- [x] Turn Mission Header release provenance into a responsive whole-segment
  Release Control backed by the existing Observatory path.
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
- [x] Unify transfer review, streaming, recovery, and arrival as Mission Control
  status cards while preserving plan, abort, retry, and activation ownership.

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
  and direct shortcuts remain available. The dock changes to `Close`
  while open. Real 80-column acceptance hovered Setup, moved selection with a
  raw SGR wheel event, clicked Setup into the existing overlay, then used `l`
  inside the reopened Palette to enter Logs; detach restored terminal modes.
- Command-Palette acceptance passes with 65 focused screen, Fleet, Palette,
  log-module, and real-PTY tests, CLI build/typecheck, root TypeScript check, and
  the 687-file repository suite (686 passed, 1 skipped; 6071 tests passed, 10
  skipped). The Docker installer smoke passes, and
  `pnpm pack --dry-run --json` confirms the new Palette module is included in
  the published CLI file set.
- The Command Palette now follows OMP's search-first browser model instead of
  stopping at arrow navigation. A stable `⌕` rail filters contextual command
  names, groups, and shortcuts with exact/substring matches ahead of restrained
  label-only fuzzy matches; description prose cannot flood the result set.
  Backspace edits, Ctrl+U clears, arrows and the wheel operate only on visible
  results, and an explicit zero-match state remains open for correction. Real
  80-column PTY acceptance typed `setup`, then clicked the filtered row well
  outside its label and entered the existing Setup Studio action path.
- Searchable-Palette acceptance passes with 78 focused Palette, screen, and
  real-PTY tests; CLI build/typecheck; root TypeScript check; and the 699-file
  repository suite (698 passed, 1 skipped; 6,144 tests passed, 10 skipped). The
  Docker installer smoke passes without Node or an Agent Runtime, and
  `pnpm pack --dry-run --json` confirms both Palette and Supervisor sources are
  present in the published CLI payload.
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
- Transfer review, execution, recovery, and completion now share one Mission
  Control language. Manifest carries READY/HOLD evidence and the default-No
  boundary; In Flight exposes a proportional file/byte meter and atomic-publish
  gate; Recovery distinguishes transaction retry from manifest rebuild; Arrival
  keeps stopped-Runtime state beside Start, Connect/Open, and Done.
- Mission-Control acceptance passes with 89 focused view, pointer, screen, and
  real-PTY tests. Six real transfer scenarios cover the 80×24 default-No review,
  110×30 successful arrival, live 25% progress, planning failures, and two
  100-column recovery paths that hover and click Retry outside its keycap. Root
  TypeScript and CLI build/typecheck pass; the 699-file suite passes (698 passed,
  1 skipped; 6142 tests passed, 10 skipped). Docker installer smoke passes, and
  package dry-run retains both `src/supervisor-transfer-view.ts` and
  `src/supervisor-tui.ts`.
- A live 120-column comparison against the locally installed OMP home screen
  showed that OpenAlice had reached operational clarity but still lacked a
  memorable first-frame brand composition. Overview now adds a wide Launch
  System Beacon: a terminal-native `ALICE` pixel wordmark and selected
  AliceProject/Runtime signal share an internal split frame, and the existing
  bounded brand sweep crosses the wordmark before settling.
- Beacon acceptance passes with 73 focused screen and real-PTY tests. A real
  120×30 color session hovered and clicked the shifted Launchpad primary row
  outside its keycap and reached the existing start/open callbacks. `NO_COLOR`
  retains the complete wordmark and state, while 115 columns and below keep the
  prior operational geometry. Testing initially exposed a reproducible 110×32
  compositor focus regression; raising the decorative boundary to 116 restored
  the complete AliceProject create/switch flow. CLI build/typecheck and root
  TypeScript pass; the 699-file suite passes (698 passed, 1 skipped; 6,145 tests
  passed, 10 skipped). Docker installer smoke passes, and package dry-run
  retains the theme, view, and Supervisor sources.
- Overview now has one visual and behavioral primary action instead of repeating
  Enter in both the Launchpad and Action Shelf. Stopped and Web-ready states
  retain start/open and open; incompatible or otherwise unavailable Runtime
  states now truthfully run the existing Doctor action. The shelf carries only
  supporting commands, including Source, lifecycle controls, Logs, and Update.
- Action-hierarchy acceptance passes with 75 focused screen and real-PTY tests.
  The degraded-Runtime PTY fixture pressed Enter on `Run Runtime Doctor`,
  observed the diagnostic service result exactly once, and restored terminal
  modes; the stopped Overview fixture also hovered and clicked Setup outside its
  keycap after the shelf reflow. CLI build/typecheck and root TypeScript pass;
  the 699-file suite passes (698 passed, 1 skipped; 6,147 tests passed, 10
  skipped). Docker installer smoke passes, and package dry-run retains the
  Supervisor source without publishing test fixtures.
- A fresh 120×30 color comparison against OMP 17.3.4 exposed a theme-compositor
  defect rather than a layout problem: the Launchpad primary background crossed
  the three-column card gutter and painted Runtime Uptime as part of Enter.
  Framed columns are now classified and decorated independently, so semantic
  color cannot escape its card while geometry and pointer targets stay intact.
- Framed-column acceptance passes with 76 focused screen and real-PTY tests.
  The regression covers exact color containment, byte-identical `NO_COLOR`,
  wide Beacon hover/click behavior, and terminal-mode restoration; a real
  Default AliceProject session confirmed the left primary surface resets before
  the unstyled gutter and right Runtime card. CLI build/typecheck and root
  TypeScript pass; the 699-file suite passes (698 passed, 1 skipped; 6,148 tests
  passed, 10 skipped). Docker installer smoke passes, and package dry-run
  retains the shared Supervisor theme source.
- The flat bottom ribbon is now an OMP-inspired Command Spine. `╰─`/`─╯` close
  the application frame, an elastic track joins controls to context, and `›`
  breadcrumbs make AliceProject, Runtime, and active view scan as distinct
  segments. Cyan controls, white identity, semantic Runtime, and purple view
  tones share one continuous rail without relying on color for structure.
- Command-Spine acceptance passes with 76 focused screen and real-PTY tests.
  A real 80×24 run clicked the visible AliceProject name outside `[ i ]`, opened
  and closed Switchboard, then clicked the Commands label to open the Palette;
  whole segments, not only keycaps, own hover/click geometry. A real 120×30
  Default AliceProject run confirmed the complete four-segment Spine beneath
  the wide Beacon, while 60- and 46-column render contracts preserve Runtime/
  view or essential controls without adding a row. CLI build/typecheck and root
  TypeScript pass; the 699-file suite passes (698 passed, 1 skipped; 6,148 tests
  passed, 10 skipped). Docker installer smoke passes, and package dry-run
  retains the shared theme and view sources.
- The disconnected title, divider, and tab rows are now a same-height Mission
  Header. Its masthead joins OpenAlice identity to version/channel provenance,
  its framed navigation preserves complete segmented targets, and its closing
  rail pairs with the bottom Command Spine without taking another content row.
  The navigation renderer owns the true inner width and its targets are offset
  into the frame, so hover and click follow the rendered segments exactly.
- Mission-Header acceptance passes with 76 focused screen and real-PTY tests.
  Real Default AliceProject runs at 120×30, 80×24, and 46×30 confirmed the
  complete masthead, the compact `Home / Fleet / Logs / Doc / Help` fallback,
  stable content geometry, and terminal-mode restoration after detach. CLI
  build/typecheck and root TypeScript pass; the 699-file suite passes (698
  passed, 1 skipped; 6,148 tests passed, 10 skipped). Docker installer smoke
  passes, and package dry-run includes the changed Supervisor theme, view, and
  renderer sources.
- The Mission Header's closing rail now owns an accent View Beacon aligned to
  the selected navigation segment. Keyboard and pointer navigation move it over
  a four-frame eased path; a second navigation action starts at the last
  rendered beacon column instead of snapping to either tab center. The final
  static frame is identical with motion disabled except that it lands
  immediately, and operational page bodies never animate or shift.
- View-Beacon acceptance passes with 77 focused screen and real-PTY tests. A
  real 100×30 Default AliceProject session moved the beacon from Overview to
  Machines while preserving the Fleet frame; a 46×30 `NO_COLOR` and
  `OPENALICE_TUI_MOTION=0` session placed it directly under compact Home and
  Logs targets and restored terminal modes after detach. CLI build/typecheck
  and root TypeScript pass; the 699-file suite passes (698 passed, 1 skipped;
  6,149 tests passed, 10 skipped). Docker installer smoke passes, and package
  dry-run includes the changed Supervisor controller and theme sources.
- Mission Header release provenance is now a whole-segment Release Control.
  Wide frames expose `[ u ]` beside version/channel/update state; compact frames
  preserve the complete version and channel behind a `↗` affordance. Hover owns
  the complete rendered tail rather than the keycap alone, and click enters the
  existing Release Observatory without crossing its explicit Check boundary.
- Release-Control acceptance passes with 77 focused screen and real-PTY tests.
  Raw SGR pointer input opened the Observatory from the Header in the release
  fixture; real Default AliceProject sessions repeated the path at 100×30 and
  at 46×30 with `NO_COLOR` and motion disabled, then restored terminal modes
  after cancel and detach. CLI build/typecheck and root TypeScript pass; the
  699-file suite passes (698 passed, 1 skipped; 6,149 tests passed, 10 skipped).
  Docker installer smoke passes, and package dry-run includes the changed
  Supervisor view, controller, and theme sources.
- The Command Palette search rail is now a live Unicode input surface. Its
  caret pulses without moving geometry and remains solid under reduced motion;
  printable Unicode, code-point-safe Backspace, and English/Chinese intent
  aliases let operators search the existing command set naturally without
  introducing another command or backend path.
- Live-input acceptance passes with 84 focused screen and real-PTY tests. Real
  sessions confirmed `日志` opens Runtime logs at 100 columns, the caret pulses
  in truecolor at 80×24, and `设置` resolves to Setup at 46×30 with `NO_COLOR`
  and motion disabled; every path restored terminal modes after closing. CLI
  build/typecheck and root TypeScript pass; the 699-file suite passes (698
  passed, 1 skipped; 6,150 tests passed, 10 skipped). Docker installer smoke
  passes, and package dry-run includes the changed command-deck and Supervisor
  controller sources.
- A live OMP v17.3.4 comparison exposed the remaining ordinary-width identity
  gap: its 80-column welcome keeps animated brand art beside useful context,
  while OpenAlice previously hid `ALICE` until 116 columns. The Overview now
  composes the existing mark, local-control identity, and truthful Runtime
  signal beside complete telemetry in a same-height Signal Deck from 72–99
  columns; the full Launch System Beacon now begins at the 100-column cockpit.
- Signal-Deck acceptance passes with 84 focused screen and real-PTY tests. A
  real truecolor 80×24 Default AliceProject session retained Home, Web, Owner,
  Provider, Services, Action Shelf, and Command Spine while the bounded prism
  sweep stayed inside the mark; a real 100×24 reduced-motion session rendered
  the full Beacon and complete controls in 22 rows. Both restored cursor,
  bracketed-paste, mouse, and alternate-screen modes after detach. CLI
  build/typecheck and root TypeScript pass; the 699-file suite passes (698
  passed, 1 skipped; 6,150 tests passed, 10 skipped). Docker installer smoke
  passes, and package dry-run includes the changed Supervisor view source.
- The responsive `ALICE` mark now remains alive after its entrance with a
  six-phase prism that advances every 240ms. The Header and operational
  telemetry stay byte-stable; focused overlays, confirmations, and busy work
  pause the ambient loop, while closing the owner resumes it. Reduced-motion
  and `NO_COLOR` sessions retain the complete static composition.
- Ambient-prism acceptance passes with 84 focused screen and real-PTY tests. A
  real truecolor 80×24 Default AliceProject session confirmed three-row-only
  incremental updates, visual silence while Setup owned focus, resumption after
  Escape, and complete cursor, bracketed-paste, mouse, and alternate-screen
  restoration on detach. CLI build/typecheck and root TypeScript pass; the
  699-file suite passes (698 passed, 1 skipped; 6,150 tests passed, 10 skipped).
  Docker installer smoke passes, and package dry-run contains the changed TUI
  theme and Supervisor controller sources.
- A live OMP v17.3.4 comparison showed that its command suggestions stay next
  to the composer while OpenAlice's centered nine-row Palette covered roughly
  half of the operational frame. `/` now opens a full-width, bottom-anchored
  Command Dock with a four-result sliding window; filtering and empty results
  contract naturally while the existing command and safety owners remain
  unchanged.
- Command-Dock acceptance passes with 88 focused screen and real-PTY tests. A
  real truecolor 80×24 Default AliceProject session reached result 8/9 while
  showing only Setup, Update, Next view, and Help, restored the complete
  Overview on Escape, and restored cursor, bracketed-paste, mouse, and
  alternate-screen modes on detach. The filtered Setup row also activates by
  real pointer coordinates in PTY. CLI build/typecheck and root TypeScript
  pass; the 699-file suite passes (698 passed, 1 skipped; 6,150 tests passed,
  10 skipped). Docker installer smoke passes, and package dry-run contains the
  changed Command Dock and Help sources.
- Pointer hover now has explanatory depth instead of color alone. Navigation,
  Action Shelf, and Command Spine targets project their consequence into the
  fixed Activity Slot as `PREVIEW`; moving away restores the blank rail, while
  Working, Error, and persisted feedback retain strict priority. The existing
  `c` Runtime Source action is also discoverable through the same Command Dock
  search model without gaining a second handler.
- Hover-Preview acceptance passes with 93 focused feedback, Command Dock,
  screen, and real-PTY tests. A real truecolor 80×24 Default AliceProject
  session hovered Setup and updated only the Preview and Action Shelf rows,
  moved into blank space and cleared the Preview, then hovered Logs and exposed
  its Event Lens consequence. Raw PTY input confirms preview-before-click and
  the existing Setup overlay path; detach restored cursor, bracketed-paste,
  mouse, and alternate-screen modes. CLI build/typecheck and root TypeScript
  pass; the 699-file suite passes (698 passed, 1 skipped; 6,151 tests passed,
  10 skipped). Docker installer smoke passes, and package dry-run contains the
  changed feedback, theme, Command Dock, and Supervisor sources.
- Overview now supports direct manipulation without turning passive telemetry
  into fake controls. AliceProject identity opens the Switchboard, a running
  Runtime's verified Web endpoint opens the browser, and a stopped Runtime's
  Provider field opens Source. Each complete responsive field owns hover/click
  geometry, a stable no-color marker, semantic focus color, and an Activity
  Slot Preview; all three routes re-enter the existing `i`, `o`, or `c` input
  state machine.
- Signal-Hotspot acceptance passes with 80 focused screen and real-PTY tests.
  Render-derived full-field targets pass at 46, 80, and 100 columns.
  A real truecolor 80×24 Default AliceProject session hovered and clicked the
  Project and Provider fields across their padded width, opened the existing
  Switchboard and Source overlays, cancelled without writing configuration,
  and restored cursor, bracketed-paste, mouse, and alternate-screen modes on
  detach. A running-runtime PTY clicked the verified Web field outside its
  label and reached the existing browser-open callback. CLI build/typecheck and
  root TypeScript pass; the 699-file suite passes (698 passed, 1 skipped; 6,153
  tests passed, 10 skipped). Docker installer smoke passes without Node, npm,
  pnpm, Bun, or an Agent Runtime, and package dry-run contains the changed view,
  theme, and Supervisor controller sources.
- Wide split-pane semantic decoration now stops at the owning card's inner
  content. Overview launch intent, Fleet selections, Logs hover/selection,
  Doctor severity, and Help selection no longer paint the gutter, borders, or
  a neutral Inspector at the same terminal row; independently semantic content
  in the neighboring pane still receives its own status treatment.
- Split-pane containment acceptance passes with 100 focused screen and
  real-PTY tests. A real truecolor 100×30 Default AliceProject session walked
  Overview, Fleet, Logs, Doctor, and Help and confirmed independent card focus;
  detach restored cursor, bracketed-paste, mouse, and alternate-screen modes.
  CLI build/typecheck and root TypeScript pass; the 699-file suite passes (698
  passed, 1 skipped; 6,155 tests passed, 10 skipped). Docker installer smoke
  passes without Node, npm, pnpm, Bun, or an Agent Runtime, and package dry-run
  contains the changed TUI theme source.
- A live OMP v17.3.4 comparison and real Fleet walk exposed that two identical
  strong selections hid which pane owned arrow-key input. Fleet now renders the
  active pane as `◆` + `▶`, the related inactive context as `◇` + `◁`, and
  leaves non-focus information cards unmarked. Enter, left-arrow, and pointer
  selection transfer the same existing focus owner without changing actions.
- Fleet-focus acceptance passes with 102 focused screen and real-PTY tests.
  Real truecolor 100×30 input moved focus Machine → AliceProject → Machine →
  AliceProject by keyboard and pointer across local and remote inventory; a
  real 46×30 `NO_COLOR` session preserved the single-pane drill-down hierarchy.
  Both restored cursor, bracketed-paste, mouse, and alternate-screen modes on
  detach. CLI build/typecheck and root TypeScript pass; the 699-file suite
  passes (698 passed, 1 skipped; 6,157 tests passed, 10 skipped). Docker
  installer smoke passes without Node, npm, pnpm, Bun, or an Agent Runtime, and
  package dry-run contains the changed Fleet and TUI theme sources.
- Fleet pointer activation now honors the visible pane owner before the related
  selection. Clicking an inactive selected Machine or AliceProject transfers
  focus without drilling down or invoking `onActivateFleet`; only a subsequent
  click while that pane and row are active reuses its Enter action.
- Focus-first pointer acceptance passes with 103 focused screen and real-PTY
  tests. A real truecolor 100×30 Default AliceProject session entered the
  project pane, clicked the inactive selected Machine once to move focus, then
  clicked it again to drill down; no Runtime action fired and detach restored
  cursor, bracketed-paste, mouse, and alternate-screen modes. CLI build/typecheck
  and root TypeScript pass; the 699-file suite passes (698 passed, 1 skipped;
  6,158 tests passed, 10 skipped). Docker installer smoke passes without Node,
  npm, pnpm, Bun, or an Agent Runtime, and package dry-run contains the changed
  Supervisor pointer controller source.
- Fleet panes are now pointer surfaces rather than decorative boxes around row
  targets. Headers and unused body space expose focus-only geometry, inactive
  header hover uses `»`, and the three-column gutter remains inert; row
  selection and second-click activation retain separate ownership.
- Pane-surface acceptance passes with 105 focused screen and real-PTY tests. A
  real truecolor 100×30 Default AliceProject session hovered and clicked the
  inactive AliceProjects header, returned through blank Machine-pane space, and
  verified the gutter caused no state change or action. Detach restored cursor,
  bracketed-paste, mouse, and alternate-screen modes. CLI build/typecheck and
  root TypeScript pass; the 699-file suite passes (698 passed, 1 skipped; 6,160
  tests passed, 10 skipped). Docker installer smoke passes without Node, npm,
  pnpm, Bun, or an Agent Runtime, and package dry-run contains the changed Fleet
  geometry and Supervisor pointer-controller sources.
- Runtime Logs no longer collapse to a one-line legacy card when the bounded
  snapshot is unloaded, quiet, or empty under the selected severity lens. A
  shared Event Signal Scope distinguishes `STANDBY`, `QUIET`, and `LENS CLEAR`,
  keeps snapshot/lens/safety truth visible, and promotes the existing `l` or `f`
  input into a themed pointer-capable action segment without adding a read path.
- Signal-Scope acceptance passes with 92 focused screen and real-PTY tests. A
  real truecolor 80×24 Default AliceProject session loaded its 200-event stream,
  traversed severity lenses, and preserved the populated Event Lens; an isolated
  quiet session hovered and clicked Reload through raw pointer input. A real
  46×30 `NO_COLOR` session retained all five Scope rows, showed the hover Preview,
  reloaded twice, and restored cursor, bracketed-paste, and mouse modes after
  detach. CLI build/typecheck and root TypeScript pass; the
  699-file suite passes (698 passed, 1 skipped; 6,163 tests passed, 10 skipped).
  Docker installer smoke passes without Node, npm, pnpm, Bun, or an Agent
  Runtime, and package dry-run contains the changed Logs and theme sources.
- Doctor's unrun and zero-check paths now share the same responsive status-scope
  primitive as Logs without sharing domain claims. `DOCTOR STANDBY` exposes
  read-only mode, diagnostic scope, and zero writes; `NO CHECKS` distinguishes
  an empty completed report from a healthy one. Both promote only the existing
  `d` input, while populated reports keep their checklist/Inspector geometry.
- Diagnostic-Radar acceptance passes with 99 focused Doctor, Logs, screen, and
  real-PTY tests. A real truecolor 80×24 Default AliceProject run produced its
  seven-check degraded report and preserved selection/detail rendering. A real
  46×30 `NO_COLOR` zero-check session retained all Radar facts, hovered the
  complete Rerun segment, invoked Doctor twice by pointer, and restored cursor,
  bracketed-paste, and mouse modes after detach. CLI build/typecheck and root
  TypeScript pass; the 699-file suite passes (698 passed, 1 skipped; 6,166 tests
  passed, 10 skipped). Docker installer smoke passes without Node, npm, pnpm,
  Bun, or an Agent Runtime, and package dry-run contains the shared view,
  Doctor, Logs, and theme sources.
- The context-free Command Spine no longer carries a ghost breadcrumb slot at
  narrow widths. Once project, Runtime, and view context are intentionally
  removed below 60 columns, one elastic track now runs from Detach directly
  into `─╯`; context-bearing layouts retain their existing separated suffix.
- Narrow-Spine acceptance passes with 94 focused screen, pointer, and real-PTY
  tests. A real truecolor 46×30 session rendered the continuous closure, hovered
  and clicked Commands, opened the bottom Command Dock, closed it with `/`, and
  restored the identical Spine plus cursor, bracketed-paste, and mouse modes on
  detach. Screen tests preserve Commands/Close and Detach targets at 46 and 52
  columns, while `NO_COLOR` is byte-identical. CLI build/typecheck and root
  TypeScript pass; the 699-file suite passes (698 passed, 1 skipped; 6,168 tests
  passed, 10 skipped). Docker installer smoke passes without Node, npm, pnpm,
  Bun, or an Agent Runtime, and package dry-run contains the changed shared TUI
  view source.
- A live OMP v17.3.4 comparison at 120x32 made the remaining vertical-canvas
  break visible: OpenAlice's Command Spine ended ten rows above the terminal
  edge while OMP grounded its global controls. The Supervisor now composes its
  Activity Slot, Action Shelf, and Command Spine as one bottom Control Console;
  only a single elastic stage above it grows with surplus terminal height.
- Control-Console acceptance passes with 95 focused screen, pointer, and
  real-PTY tests. A real truecolor PTY rendered Activity, actions, and Spine on
  rows 30/31/32 at 120x32, opened the Command Dock by pointer, resized live to
  80x24, rendered the same three surfaces on rows 22/23/24, and opened the Dock
  again through the recomputed bottom-row target. Detach restored cursor,
  bracketed-paste, mouse, and alternate-screen modes. A 46x30 PTY likewise
  activates the Spine on row 30, while a short-height unit path proves content
  remains complete rather than clipped. CLI build/typecheck and root TypeScript
  pass; the 699-file suite passes (698 passed, 1 skipped; 6,169 tests passed, 10
  skipped). Docker installer smoke passes without Node, npm, pnpm, Bun, or an
  Agent Runtime, and package dry-run contains both changed Supervisor sources.
- OMP v17.3.4 uses the quiet region directly beneath its welcome card for a
  concise `Tip:` rather than decorative motion. The Supervisor now follows that
  pattern with a Context Tip Beacon: Overview responds to live/stopped/uncertain
  Runtime state, and Fleet, Logs, Doctor, Help, and Recovery each teach their
  most useful non-obvious interaction. It appears only in an elastic stage with
  at least two spare rows and keeps one blank row after page content.
- Context-Tip acceptance passes with 96 focused screen, pointer, and real-PTY
  tests. Real truecolor 120x32, 80x24, and 46x30 frames place the same semantic
  Tip at display-width-safe sizes without moving the bottom Control Console; a
  real Logs PTY switches from the Overview signal hint to the `f`/`End` event
  hint while preserving its reload pointer action. Unit acceptance covers every
  context, ensures the Tip publishes no command target, proves a constrained
  terminal omits it instead of clipping content, and keeps `NO_COLOR` text
  byte-identical. CLI build/typecheck and root TypeScript pass; the 699-file
  suite passes (698 passed, 1 skipped; 6,170 tests passed, 10 skipped). Docker
  installer smoke passes without Node, npm, pnpm, Bun, or an Agent Runtime, and
  package dry-run contains the changed view, theme, and Supervisor sources.
- The wide Overview no longer stacks a standalone Launch System Beacon above a
  second copy of AliceProject identity and Runtime state. At 100 columns and
  wider, the `ALICE` mark now lives inside the action-first Launchpad, with the
  complete guidance wrapping beside it and the existing primary action closing
  the pane. Runtime remains a separate right pane whose final Uptime row aligns
  with the Launchpad action without inheriting its semantic background.
- Integrated-Launchpad acceptance passes with 96 focused screen, pointer, and
  real-PTY tests. Truecolor 100x24 and 120x24 boundary frames retain every
  guidance phrase, show one stopped/running identity instead of the duplicated
  hero, preserve the 99-column Signal Deck, and keep the Context Tip plus bottom
  Control Console fixed. A 120x30 PTY hovered and clicked the relocated primary
  row outside its keycap, reached start/open exactly once, and restored terminal
  modes; motion tests prove the integrated mark still participates in entrance
  and ambient prism frames. CLI build/typecheck and root TypeScript pass; the
  699-file suite passes (698 passed, 1 skipped; 6,170 tests passed, 10 skipped).
  Docker installer smoke passes without Node, npm, pnpm, Bun, or an Agent
  Runtime, and package dry-run contains the changed Supervisor view source.
- The Command Dock no longer strands its still-visible Command Spine behind the
  overlay pointer router. Its final rendered Close, Detach, and AliceProject
  targets retain Screen-owned geometry and handlers; every miss stays with the
  Dock, so Action Shelf and content controls cannot activate through it. Other
  overlays remain fully modal.
- Persistent-Spine routing acceptance passes with 94 focused screen and
  real-PTY tests. The 46x30 truecolor PTY now opens and closes the Dock through
  raw SGR mouse input on the same bottom-row segment, rather than using `/` for
  the close half. Unit coverage proves covered Action Shelf geometry is inert
  while visible AliceProject and Detach segments still route correctly. CLI
  build/typecheck and root TypeScript pass; the 699-file suite passes (698
  passed, 1 skipped; 6,171 tests passed, 10 skipped). Docker installer smoke
  passes without Node, npm, pnpm, Bun, or an Agent Runtime, and package dry-run
  contains the changed Supervisor input controller.
- A live 120x32 OMP v17.3.4 and Default AliceProject comparison exposed that
  OpenAlice's wide Overview ended near the top of the terminal and left most of
  the viewport as an unowned blank interval. The paired Launchpad and Runtime
  cards now absorb a bounded share of that height as one mission stage, while
  their existing primary action and Uptime rows remain aligned at its lower
  edge. The 17-row cap preserves breathing room, and sub-100-column plus
  non-Overview surfaces retain their natural density.
- Adaptive-stage acceptance passes with 95 focused screen and real-PTY tests.
  A real truecolor 120x32 Default AliceProject render keeps the stage, Home
  context, Tip, and bottom Console in order; the 120x30 PTY hovers and clicks
  the relocated row-19 primary surface and reaches start/open exactly once.
  Unit coverage proves equal lower anchors, the 17-row cap at 48 rows, and the
  unchanged 99-column stacked boundary. CLI build/typecheck and root TypeScript
  pass; the 699-file suite passes (698 passed, 1 skipped; 6,172 tests passed, 10
  skipped). Docker installer smoke passes without Node, npm, pnpm, Bun, or an
  Agent Runtime, and package dry-run contains both changed Supervisor sources.
- The bottom controls no longer read as a loose blank row, shortcut line, and
  unrelated closing rail. They now form one OMP-composer-style Control Console:
  the top border carries idle or live feedback state, every responsive Action
  Shelf row is framed inside it, and the existing context-rich Command Spine
  closes the surface without adding terminal height.
- Framed-Console acceptance passes with 101 focused feedback, screen, and
  real-PTY tests. Real truecolor Default AliceProject sessions at 120x32 and
  46x30 preserve the grounded bottom edge, full-width borders, and wrapped
  narrow actions. Hovering Setup in the 80x24 PTY moves the existing Preview
  into the top rail, highlights the framed whole-row segment, opens Setup once,
  and restores terminal modes after detach. Unit coverage verifies final
  framed pointer geometry, stable display widths, semantic state color, and
  byte-identical `NO_COLOR` structure. CLI build/typecheck and root TypeScript
  pass; the 699-file suite passes (698 passed, 1 skipped; 6,173 tests passed, 10
  skipped). Docker installer smoke passes without Node, npm, pnpm, Bun, or an
  Agent Runtime, and package dry-run contains the changed view, theme, and
  Supervisor sources.
- A real 120x32 Default AliceProject Fleet exposed a false scarcity: six local
  projects were compressed into five visible rows and a scroll rail while ten
  usable terminal rows remained unowned below the panel. Wide Fleet now spends
  its viewport budget on additional real Machine or selected AliceProject rows,
  capped by actual inventory; narrow drill-down and short terminals retain the
  five-row baseline, so the change never manufactures blank focus targets.
- Viewport-aware Fleet acceptance passes with 107 focused renderer, screen,
  and real-PTY tests. The live truecolor 120x32 Default AliceProject session
  showed all six projects without a scroll rail, and raw mouse movement plus a
  click selected `Ui Dev` on row 11 as item 6/6. The isolated six-project PTY
  covers the same path, while unit coverage proves narrow and 20-row fallback
  behavior. CLI build/typecheck and root TypeScript pass; the 699-file suite
  passes (698 passed, 1 skipped; 6,176 tests passed, 10 skipped). Docker
  installer smoke passes without Node, npm, pnpm, Bun, or an Agent Runtime,
  and package dry-run contains both changed Supervisor Fleet/TUI sources.
- A fresh live 120x32 comparison against OMP v17.3.4 exposed the next old-CLI
  seam: quiet Logs and Doctor cards ended after seven rows and abandoned most
  of the terminal as unowned background. Their wide Operational Canvas now
  owns that height. Populated readers reveal additional real events or checks;
  truthful empty scopes retain top facts, a centered non-interactive state echo,
  and their existing action on the lower frame edge. The 80x24, narrow, and
  constrained contracts keep their compact density.
- Operational-Canvas acceptance passes with 114 focused view, screen, and
  real-PTY tests. The isolated 120x32 PTY showed all twenty Runtime events
  without a rail, hovered and clicked event 19 on row 24, updated the Inspector,
  and restored terminal modes. A real truecolor 120x32 quiet Logs session kept
  the Context Tip and Control Console below the owned frame; raw mouse hover and
  click on the relocated row-25 Reload action incremented the real fixture read
  count from one to two. CLI build/typecheck and root TypeScript pass; the
  699-file suite passes (698 passed, 1 skipped; 6,182 tests passed, 10 skipped).
  Docker installer smoke passes without Node, npm, pnpm, Bun, or an Agent
  Runtime, and package dry-run contains all changed Supervisor sources.
- The proportional overflow marks are now one Rail Navigator across Logs,
  Doctor, Machines, and AliceProjects. Hover replaces the exact track cell with
  `◆` and previews the proportional real item; left press jumps selection and
  owns left-button motion until release. The rail never activates a Runtime,
  AliceProject, reload, or diagnostic request, while row, wheel, and keyboard
  navigation retain their existing behavior.
- Rail-Navigator acceptance passes with 131 focused renderer, pointer, screen,
  and real-PTY tests. A real 80x24 terminal accepted raw SGR hover, press,
  button-32 drag, and release reports: the first cell previewed Runtime event
  1/10 and a drag to the last cell selected event 10/10 without reloading.
  Root TypeScript and the CLI build pass; the 699-file suite passes (698 passed,
  1 skipped; 6,185 tests passed, 10 skipped). Docker installer smoke passes
  without Node, npm, pnpm, Bun, or an Agent Runtime, and package dry-run
  contains the shared rail plus every changed Supervisor owner.
- A live 120x32 OMP v17.3.4 launch made the remaining first-frame gap explicit,
  so OpenAlice now owns the shell-to-product transition with an original Boot
  Sequence. The full viewport composes a doubled `ALICE` prism, sparse
  deterministic signal field, responsive horizon, and an
  `AliceProject → Machine → Runtime → Control` rail before handing off to the
  unchanged Mission Header. Compact terminals keep a centered complete mark;
  reduced-motion, no-color, dumb-terminal, and explicit opt-out launches remain
  immediate.
- Boot-Sequence acceptance passes with 108 focused renderer, screen, and
  real-PTY tests. The truecolor 120x32 fixture filled all 32 rows and handed off
  automatically in sixteen 80ms ticks. An 80x24 raw SGR click at the ready
  Launchpad action's future coordinates skipped without click-through
  (`starts=0 opens=0 loads=0 diagnoses=0`); a second PTY detached directly with
  `q` before the Mission Header appeared and restored every terminal mode. CLI
  build and root TypeScript pass; the 700-file suite passes (699 passed, 1
  skipped; 6,191 tests passed, 10 skipped). Docker installer smoke passes
  without Node, npm, pnpm, Bun, or an Agent Runtime, and package dry-run contains
  the new Boot Sequence owner.
- The wide Overview's adaptive stage no longer stretches seven empty paired
  rows between identity and action. Its real surplus now centers a Control Path
  for AliceProject, Runtime, Workspace, and provider beside a Service Array
  derived from the existing Alice, UTA, and Connector report. Live route
  packets follow the existing Runtime pulse; stopped and unreported states stay
  explicit, and neither surface publishes a pointer or keyboard target. The
  80x24 and 99-column layouts remain unchanged.
- Control-Path acceptance passes with 106 focused screen and real-PTY tests. A
  truecolor 120x32 running fixture showed the route and array inside the paired
  stage while keeping the primary action and Uptime on their shared lower edge;
  the existing 120x30 raw-pointer PTY saw the new stage, hovered and clicked the
  relocated primary surface, invoked start/open exactly once, and restored all
  terminal modes. Component coverage distinguishes ready/connected, disabled,
  and unreported service truth, while the wide-stage test forbids three
  consecutive mechanical filler rows and proves the 99-column boundary omits
  the new composition. CLI build and root TypeScript pass; the 700-file suite
  passes (699 passed, 1 skipped; 6,192 tests passed, 10 skipped). Docker
  installer smoke passes without Node, npm, pnpm, Bun, or an Agent Runtime, and
  package dry-run contains the changed Supervisor view source.
- A fresh OMP v17.3.4 no-session run exposed the next old-menu seam: OMP's
  welcome surface keeps Tips, LSP, sessions, composer context, and command
  suggestions simultaneously visible, while OpenAlice's 120x32 Help showed one
  category beside its detail and then abandoned thirteen viewport rows. Wide
  tall Help is now a Control Atlas Board that expands Navigation, Runtime, and
  AliceProject together. Each section keeps its description and a two-column
  command grid; pointer focus spans every command row instead of only the
  heading. The board activates only with at least 21 available content rows,
  while 20-row, sub-100-column, and Recovery surfaces retain the prior compact
  inspector.
- Control-Atlas-Board acceptance passes with 112 focused Help, screen, and
  real-PTY tests. A truecolor 120x32 fixture filled the operational stage with
  all three complete sections and kept the Context Tip plus Control Console at
  the bottom. Raw SGR hover on an ordinary Runtime command row changed the
  section from idle to hover; clicking the same row selected Runtime without
  invoking a lifecycle action, and detach restored cursor, mouse, bracketed
  paste, and alternate-screen modes. Renderer coverage proves exact 21/22-row
  boundaries, 120-column display widths, complete commands, whole-section
  targets, and the Recovery exclusion. CLI build and root TypeScript pass; the
  700-file suite passes (699 passed, 1 skipped; 6,194 tests passed, 10 skipped).
  Docker installer smoke passes without Node, npm, pnpm, Bun, or an Agent
  Runtime, and package dry-run contains both changed Supervisor sources.
- A live 120x32 comparison confirmed that the Command Dock already carries the
  useful OMP composer properties—inline query, immediate suggestions, status
  metadata, and preserved page context—while sparse Fleet remained the larger
  old-dashboard break. With one Machine and one AliceProject, its two five-row
  panes plus two-line Selection abandoned ten usable rows. Wide Fleet now
  spends that remaining budget on a Selection Constellation after real
  inventory receives priority. The Constellation renders the selected
  Machine → AliceProject → Runtime/Web signal path and reported product, port,
  owner, uptime, services, capabilities, default, and refresh facts; compact
  Selection remains unchanged below the complete nine-detail-row threshold.
- Selection-Constellation acceptance passes with 118 focused Fleet, screen,
  and real-PTY tests. The truecolor 120x32 running fixture filled the former
  gap while preserving both inventory panes, Context Tip, and bottom Control
  Console. A raw SGR hover/click inside the Constellation invoked no start,
  open, log, or Doctor action and detach restored terminal modes. Unit coverage
  proves the 11/12 requested-row and 99/100-column boundaries, exact reported
  facts, display-width containment, and absence of Fleet pointer geometry in
  the detail region. CLI build and root TypeScript pass; the 700-file suite
  passes (699 passed, 1 skipped; 6,196 tests passed, 10 skipped). Docker
  installer smoke passes without Node, npm, pnpm, Bun, or an Agent Runtime, and
  package dry-run contains the changed Fleet renderer.
- A fresh 120x32 audit of Setup, Source, AliceProject, and Release found the
  next cross-surface seam: each polished split-pane task was still centered on
  Overview, whose cards leaked through unused rows and edges. The shared Focus
  Workspace now gives these tasks every row between Mission Header and Control
  Console at 100x28 and above, clears surplus rows, removes the false Overview
  selection, and names SETUP, SOURCE, PROJECTS, or RELEASE in both navigation
  focus and the Context Ribbon. Smaller terminals retain their complete
  responsive sheets. Raw semantic rows continue to own hit-testing while ANSI
  hover decoration remains presentation-only, so a hovered action stays
  clickable.
- Focus-Workspace acceptance passes with 115 focused task-surface,
  navigation, screen, and real-PTY tests. Truecolor 120x32 captures show all
  four tasks starting directly below the Header, no Overview text bleeding
  through, explicit `FOCUS` identity above, and task identity in the anchored
  Control Console below. Raw SGR hover then click still cycles Setup, selects a
  Release lane, submits Source, advances Foundry, and selects a Switchboard
  row; Esc restores top-level Overview identity and detach restores terminal
  modes. CLI build and root TypeScript pass; the 701-file suite passes (700
  passed, 1 skipped; 6,199 tests passed, 10 skipped). Docker installer smoke
  passes without Node, npm, pnpm, Bun, or an Agent Runtime, and package dry-run
  contains `src/supervisor-task-surface.ts`.
- OMP v17.3.4's live 120x32 setup stage confirmed that its apparent richness
  comes from task title, ordered setup context, dividers, selection, and footer
  controls rather than indiscriminate density. OpenAlice's Focus Workspace now
  uses its lower quiet field for the selected task's real trajectory and owner
  boundary instead of a blank half-screen or invented telemetry. The field is
  visually subordinate to the split task cards, has no command geometry, and
  disappears with the Focus Workspace below 100x28.
- Focus-Trajectory acceptance passes with 113 focused task-surface, screen,
  and real-PTY tests. Truecolor 120x32 Setup and Release captures place the
  trajectory in rows 21–24 between task status and Control Console, retain the
  split-card primary hierarchy, and expose matching `FOCUS`/Context Ribbon
  identity. Tests prove all four exact workflows, display-width containment,
  no invented CURRENT/DONE/READY state, no command targets, no-color parity,
  and complete omission below either Focus Workspace boundary. CLI build and
  root TypeScript pass; the 701-file suite passes (700 passed, 1 skipped;
  6,202 tests passed, 10 skipped). Docker installer smoke passes without Node,
  npm, pnpm, Bun, or an Agent Runtime, and package dry-run contains the changed
  task-surface owner.
- A real 110x30 Transfer destination frame exposed Fleet card borders and
  selection text crossing through the centered Flight Deck and Safety Rail.
  Remote Transfer now enters the same Focus Workspace after preflight, clears
  every Fleet row between Header and Console, and publishes matching
  `FOCUS · TRANSFER` and `◆ TRANSFER` identity. Its existing eight-stage Flight
  Deck remains the sole trajectory; the 80x24 fallback remains a bounded sheet.
- Transfer-Focus acceptance passes with 121 focused renderer, task-surface,
  screen, and real-PTY tests. The six-scenario PTY matrix proves mouse selection,
  invalid-key repair, default-No cancellation, auth/occupancy recovery,
  checksum retry, cancellation retry, focus exit, and terminal restoration at
  80x24 through 110x30. CLI build and root TypeScript pass; the 701-file suite
  passes (700 passed, 1 skipped; 6,202 tests passed, 10 skipped). Docker
  installer smoke passes without Node, npm, pnpm, Bun, or an Agent Runtime, and
  package dry-run contains the changed Supervisor, task-surface, and Transfer
  renderers.
- A live OMP v17.3.4 comparison reinforced that its lower composer always owns
  the current interaction context. OpenAlice's Focus Workspace still leaked
  Overview or Fleet actions into that position even though those commands no
  longer owned input. The new Focus Console gives Setup, Source, Projects,
  Release, and Transfer task-specific Enter and movement language, a shared
  Back action, `FOCUS WORKSPACE` identity, and a non-command `⌂` project label.
  `/`, `q`, and `[ i ]` are no longer advertised while an overlay owns them.
- Focus-Console acceptance passes with 128 focused renderer, pointer, screen,
  and real-PTY tests. A truecolor 110x30 Transfer capture shows no underlying
  Fleet commands in either bottom row. Raw SGR mouse input submits an invalid
  and repaired project key through the mirrored bottom Enter segment, while a
  second path closes recovery through the bottom Esc Spine; both reach the same
  overlay state machine and restore the original Fleet Console on exit. CLI
  build and root TypeScript pass; the 701-file suite passes (700 passed, 1
  skipped; 6,204 tests passed, 10 skipped). Docker installer smoke passes
  without Node, npm, pnpm, Bun, or an Agent Runtime, and package dry-run contains
  every changed Supervisor source.
- The Focus Header now removes Overview, Machines, Logs, Doctor, and Help for
  the exact lifetime in which those page targets do not own input. Setup,
  Source, Projects, Release, and Transfer instead project their existing task
  surface and workflow contract into the Header, with a right-anchored Esc
  exit and a quiet divider instead of a stale selection beacon.
- Focus-Header acceptance passes with 133 focused navigation, renderer,
  pointer, screen, and real-PTY tests. A truecolor 110x30 Transfer capture shows
  `TRANSFER FLIGHT DECK` and `8-STAGE GUARDED MIGRATION` above the uninterrupted
  Flight Deck, with no page labels or beacon. Raw SGR hover/click on the top
  Back key closes an authentication-recovery frame through the active overlay
  state machine and restores Fleet navigation. CLI build and root TypeScript
  pass; the 701-file suite passes (700 passed, 1 skipped; 6,204 tests passed, 10
  skipped). Docker installer smoke passes without Node, npm, pnpm, Bun, or an
  Agent Runtime, and package dry-run contains the changed navigation, theme,
  pointer, and Supervisor sources.
- Focus mode now projects version, channel, and update provenance as a
  read-only `◇ BUILD` signal in the Mission Header. The normal `[ u ]` Release
  keycap and its complete pointer target are absent while any focused overlay
  owns input, then return unchanged with the operational page chrome.
- Focus-build acceptance remains green across the 133 focused navigation,
  renderer, pointer, screen, and real-PTY tests. A truecolor 110x30 Transfer
  capture shows `◇ BUILD v0.91.0-beta.3 · DEV` without an interactive release
  marker; unit coverage proves the old header location cannot dispatch Update
  in focus and that ordinary stopped-state chrome still exposes `[ u ]`. CLI
  build and root TypeScript pass; the 701-file suite passes (700 passed, 1
  skipped; 6,204 tests passed, 10 skipped). Docker installer smoke passes
  without Node, npm, pnpm, Bun, or an Agent Runtime, and package dry-run contains
  the changed Supervisor view and theme sources.
- Event Lens selection now terminates in a useful explicit action: `y` and the
  complete pointer-capable `Copy event` segment send the focused bounded,
  redacted raw projection through a 24 KiB-capped OSC 52 request. Empty lenses
  advertise no Copy action, UTF-8 is never split at the cap, no platform helper
  or clipboard read enters the CLI, and feedback distinguishes a request sent
  from terminal-policy acceptance.
- Event-copy acceptance passes with 148 focused clipboard, Logs, feedback,
  navigation, overlay, task-surface, transfer, screen, and real-PTY tests. The
  80x24 PTY selected warning event 9 with raw SGR input, hovered and clicked the
  complete Copy segment, emitted the exact sanitized JSON payload through OSC
  52, reported the request, and restored terminal modes. Root TypeScript and
  CLI build pass; the 702-file suite passes (701 passed, 1 skipped; 6,207 tests
  passed, 10 skipped). Docker installer smoke passes without Node, npm, pnpm,
  Bun, or an Agent Runtime, and package dry-run now proves the new clipboard
  owner is present in the published CLI tarball.
- A live OMP v17.3.4 Models surface and OpenAlice 120x32 confirmation comparison
  exposed the next modal seam: OMP lets its focused surface own the operational
  field, while OpenAlice left chopped Launchpad copy and bright but inert page
  controls around the centered card. Confirmation now enters a Decision Gate:
  the card stays bounded and centered, the field clears, Header navigation and
  release affordances become confirmation identity plus read-only BUILD, and
  the grounded Console advertises only the active action/refusal pair.
  Confirmation takes priority over any existing Focus task and cancellation
  restores that task or page unchanged.
- Decision-Gate acceptance passes with 125 focused navigation, task-surface,
  overlay-pointer, screen, and real-PTY tests. Truecolor 120x32 and 80x24 frames
  contain no underlying Launchpad/Fleet copy or page commands; the 80x24 PTY
  hovered and clicked the complete bottom Cancel segment, closed the managed-
  source card through the existing confirmation state machine, restored the
  prior Overview, and restored terminal modes on detach. Root TypeScript and
  CLI build pass; the 702-file suite passes (701 passed, 1 skipped; 6,207 tests
  passed, 10 skipped). Docker installer smoke passes without Node, npm, pnpm,
  Bun, or an Agent Runtime, and package dry-run retains every changed TUI owner.
- The Decision Gate now derives its centered card and grounded Console from one
  shared Action Shelf projection. Destructive Runtime control therefore keeps
  the exact `Stop Runtime / Keep running` or `Restart Runtime / Keep running`
  language in both locations, while managed Source and Update keep their own
  exact positive and refusal labels instead of collapsing to generic
  `Confirm / Cancel` copy.
- Exact-action acceptance passes with 123 focused confirmation, navigation,
  overlay-pointer, screen, and real-PTY tests. A settled truecolor 120x32 Stop
  frame shows `Stop Runtime / Keep running` in both the centered card and the
  bottom Control Console with no operational action leakage; the 80-column
  managed-Source PTY proves the longer `Prepare source / Not now` shelf remains
  pointer-operable. Root TypeScript and CLI build pass; the 702-file suite
  passes (701 passed, 1 skipped; 6,207 tests passed, 10 skipped). Docker
  installer smoke passes without Node, npm, pnpm, Bun, or an Agent Runtime, and
  package dry-run retains the shared confirmation projection in the CLI.
- A live OMP v17.3.4 home-composer comparison reinforced that the strongest
  chrome boundary should name the current concrete context, not merely its UI
  category. Decision Gate Mission Headers now use the resolved positive action
  as identity, the resolved refusal as their complete pointer-capable Esc
  target, and `REVIEW IMPACT` as the stable contract. The Control Console's
  right task badge carries that same action instead of generic `CONFIRMATION`.
- Action-Mission acceptance passes with 124 focused confirmation, navigation,
  overlay-pointer, screen, and real-PTY tests. A settled truecolor 120x32 Stop
  frame carries `STOP RUNTIME` through Header, centered card, Action Shelf, and
  Dock while every refusal edge says `Keep running`; an 80x24 managed-Source
  PTY hovers and clicks the complete top `[ Esc ] Not now` target and restores
  Overview. Root TypeScript and CLI build pass; the 702-file suite passes (701
  passed, 1 skipped; 6,208 tests passed, 10 skipped). Docker installer smoke
  passes without Node, npm, pnpm, Bun, or an Agent Runtime, and package dry-run
  retains the updated navigation, Dock, and Supervisor owners.
- A settled 120x32 Overview audit exposed a data-trust seam in the visual
  hierarchy: one missing component snapshot expanded into three negative-looking
  `not reported` rows, while a live Runtime without uptime still claimed it was
  waiting for a Runtime. The wide right pane is now
  `Runtime Telemetry · OpenAlice` and adapts missing data into one explicit pending cluster instead
  of imitating three component failures.
- Adaptive-Telemetry acceptance passes with 111 focused screen and real-PTY
  tests. Settled truecolor 120x32 running and stopped frames prove the two
  distinct contracts: live ownership shows `SNAPSHOT PENDING`, expected
  components, and `Uptime · Live · not reported`; stopped ownership shows
  `AVAILABLE AFTER LAUNCH` and keeps `Waiting for Runtime`. A reported snapshot
  still expands into the three-service array. Root TypeScript and CLI build
  pass; the 702-file suite passes (701 passed, 1 skipped; 6,209 tests passed, 10
  skipped). Docker installer smoke passes without Node, npm, pnpm, Bun, or an
  Agent Runtime, and package dry-run retains the changed TUI view owner.
- A settled five-page 120x32 audit found that the empty Event Signal Scope and
  Diagnostic Radar still advertised object-dependent Console actions even
  though their bodies owned no event or check. Their Tips repeated the same
  stale assumption, and a zero-check Doctor report incorrectly earned the
  navigation success badge.
- Empty-Scope acceptance passes with 117 focused navigation, screen, and
  real-PTY tests. Settled truecolor 120x32 Logs and Doctor frames expose only
  Reload/Rerun, filter, and Help recovery routes; Scroll, Copy, Inspect, Latest,
  First, and Last return with real objects. The Tips name the empty contract,
  existing card actions remain pointer-operable, and zero checks render neutral
  `Doctor` while an actual all-pass report earns `Doctor✓`. Root TypeScript and
  CLI build pass; the 702-file suite passes (701 passed, 1 skipped; 6,210 tests
  passed, 10 skipped). Docker installer smoke passes without Node, npm, pnpm,
  Bun, or an Agent Runtime, and package dry-run retains the changed navigation,
  view, and Supervisor owners.
- A settled 120x32 Fleet audit exposed a cross-state contradiction: the global
  Dock truthfully reported LIVE and the selected project exposed a verified Web
  endpoint, while both project surfaces reduced the same selection to
  `missing`. Fleet now represents that edge as `running · home missing` (or
  `external · home missing`) so neither live ownership nor the unavailable
  file-backed home is concealed. Transfer disappears from the Action Shelf and
  its hidden shortcut refuses the unavailable home; Open remains available for
  the verified current Runtime route.
- Compound-Fleet acceptance passes with 124 focused Fleet, screen, and real-PTY
  tests. The real 120x32 PTY fixture proves the compound status, retained Web
  route, removed pure-missing claim, passive Selection Constellation, and clean
  terminal restoration. Root TypeScript and CLI build pass; the 702-file suite
  passes (701 passed, 1 skipped; 6,212 tests passed, 10 skipped). Docker
  installer smoke passes without Node, npm, pnpm, Bun, or an Agent Runtime, and
  package dry-run retains both changed Supervisor owners in the published CLI.
- The persistent Command Dock now consumes current-project availability instead
  of restating Runtime class alone. A verified live Runtime over a missing home
  reads `LIVE · HOME MISSING` at the strongest global signal boundary and uses
  warning color; healthy LIVE/EXTERNAL, responsive elision, focus ownership,
  command targeting, and no-color output retain their existing contracts.
- Compound-Signal acceptance passes with 113 focused Dock, theme, screen, and
  real-PTY tests. Truecolor unit coverage proves the complete warning token and
  exact ANSI-free parity; the 120x32 PTY proves the responsive Fleet frame and
  terminal restoration. Root TypeScript and CLI build pass; the 702-file suite
  passes (701 passed, 1 skipped; 6,212 tests passed, 10 skipped). Docker
  installer smoke passes without Node, npm, pnpm, Bun, or an Agent Runtime, and
  package dry-run contains every changed Dock projection and theme owner.
- Overview now consumes the same current-project availability signal as Fleet
  and Dock. Wide and compact Launchpads replace the falsely ordinary RUNNING,
  LIVE SESSION, and Home rail with a compound attention state, explain that the
  verified Web route remains usable, and retain Open as the exact primary
  action. The Runtime signal deck and wide control path use the same warning;
  healthy and stopped views remain unchanged.
- Compound-Launchpad acceptance passes with 113 focused Overview, theme,
  pointer, screen, and real-PTY tests. The 80x24 PTY proves the added briefing
  row preserves hover, preview, click, verified Web open, and terminal cleanup;
  the 120x32 PTY proves the full warning hierarchy and Fleet transition. Root
  TypeScript and CLI build pass; the 702-file suite passes (701 passed, 1
  skipped; 6,212 tests passed, 10 skipped). Docker installer smoke passes
  without Node, npm, pnpm, Bun, or an Agent Runtime, and package dry-run retains
  every changed Overview, theme, and Supervisor owner.
- The Supervisor now treats its disconnected state as an OpenAlice Launcher
  rather than a status dashboard. Its adaptive header exposes only Connect and
  contextual Help, and a visible Machine → AliceProject → Runtime rail names
  the selected values plus the exact next action. Local Enter starts and stays
  in the TUI; remote Enter starts or connects, and a ready post-start inventory
  continues into the SSH forward. A successful target transition replaces the
  launcher with Home, Inbox, Connections, and Runtime.
- The connected shell owns one explicit active target across local loopback and
  remote SSH-forward transports. Remote tunnel readiness retains the forwarded
  endpoint instead of silently returning to local context, browser opening is
  a separate `o` action, and tunnel loss falls back to the reachable local
  target or the Launcher. Inbox consumes the existing bounded HTTP history and
  shared read-state routes, renders responsive list/Inspector views, polls every
  20 seconds, and deliberately exposes no destructive delete.
- Launcher-Workbench acceptance passes with 139 focused navigation, Inbox,
  Fleet, screen, and real-PTY tests, including a default stopped 100x28 launch
  frame and terminal restoration. Root TypeScript and CLI build pass; the
  703-file suite passes (702 passed, 1 skipped; 6,222 tests passed, 10 skipped).
  Docker installer smoke passes without Node, npm, pnpm, Bun, or an Agent
  Runtime. Package dry-run contains the new `supervisor-inbox.ts` owner among
  68 published files. `OPENALICE_TUI_START_VIEW=home` preserves an explicit
  expert/deep-regression entry without changing the adaptive product default.
- Connected-state control now keeps one target instead of treating SSH as a
  transient browser route. The persistent Dock names local or remote Machine,
  AliceProject, transport, and signal; Connections marks the active Machine and
  project independently from focus. Switching closes the old TUI-owned tunnel,
  remote `x` disconnects without stopping OpenAlice, and the remote Command
  Dock contains no local lifecycle or configuration mutations. Authoritative
  local Runtime loss returns the adaptive shell to its Launcher.
- State-control acceptance passes with 145 focused Command Dock, Fleet, Inbox,
  screen, and real-PTY tests. Added integration coverage proves explicit SSH
  disconnect aborts the tunnel and returns to Connections, and a polled local
  stop clears the active target and restores the launch rail. Root TypeScript
  and CLI build pass; the 703-file suite passes (702 passed, 1 skipped; 6,228
  tests passed, 10 skipped). Docker installer smoke passes without Node, npm,
  pnpm, Bun, or an Agent Runtime, and package dry-run retains all 68 published
  CLI files including every changed TUI owner.
- Active-target health is now a recoverable state machine instead of a LIVE
  boolean. Bounded probes preserve the owned local or SSH target through
  connected, degraded, and unreachable phases; one failure warns, three
  consecutive failures block stale Open actions, and a later success restores
  the same target in place. Home, navigation, Dock, Runtime, and Command Dock
  share the phase, expose Retry, retain remote Disconnect, and label retained
  telemetry as a last snapshot rather than a live session.
- Connection-recovery acceptance passes with 158 focused Command Dock,
  navigation, theme, screen, integration, and real-PTY tests, including an
  automatic remote degraded-to-unreachable-to-connected cycle and local
  inspection recovery without a false Launcher transition. The complete CLI
  suite passes (61 files, 616 tests); `test:affected` passes across 703 files
  (702 passed, 1 skipped; 6,235 tests passed, 10 skipped). CLI build, the
  68-file package dry-run, and Docker installer smoke all pass; the installer
  remains independent of Node, npm, pnpm, Bun, and an Agent Runtime.
- Runtime now begins with a bounded Connection Chronicle instead of presenting
  a process-log tail as the complete status manager. Wide terminals pair Active
  Link truth with a newest-first Session Trail; ordinary terminals retain the
  exact route, two newest transitions, and one valid action. The trail records
  acquire, release, degraded, unreachable, recovered, and stopped transitions,
  deduplicates and caps them at twelve, sanitizes target identity, and remains
  session-local. Local Runtime logs stay directly below as evidence; remote
  Runtime keeps only Open, Check, Disconnect, Connections, and Help.
- Chronicle acceptance passes through the complete CLI suite (62 files, 620
  tests), including all 49 real-PTY cases. The remote PTY visibly traverses
  degraded → unreachable → recovered, opens Runtime, and proves all four
  semantic events remain in the live Session Trail while the SSH forward stays
  owned. `test:affected` passes across 704 files (703 passed, 1 skipped; 6,239
  tests passed, 10 skipped). CLI build, the 70-file package dry-run, and Docker
  installer smoke all pass; the packaged installer remains independent of
  Node, npm, pnpm, Bun, and an Agent Runtime.
- Launcher waits now become a Launch Flight Recorder for local start, remote
  start, and SSH connect instead of leaving apparently selectable inventory
  behind one generic Busy label. The selected Machine/AliceProject route,
  transport, elapsed time, and only the orchestration stages the TUI can
  observe remain visible; complete, active, waiting, and failure states have
  explicit glyph/text semantics. Success hands to connected Home, while a
  failure keeps Enter retry and Esc return paths on the same selected target.
- Flight-recorder acceptance passes through 130 focused renderer, theme,
  orchestration, screen, and real-PTY tests. The real terminal visibly traverses
  local validate → start → bind → connected Home; remote integration covers
  start → refreshed endpoint → SSH forward → bound target. The complete CLI
  suite passes (63 files, 625 tests), and `test:affected` passes across 705 files
  (704 passed, 1 skipped; 6,244 tests passed, 10 skipped). CLI typecheck/build,
  the 71-file package dry-run, and Docker installer smoke all pass; the packaged
  installer remains independent of Node, npm, pnpm, Bun, and an Agent Runtime.
- A live OMP 17.3.4 launch confirmed its welcome surface prioritizes context,
  one next action, and the handoff into work over low-level inventory. The
  disconnected Fleet now applies that hierarchy as a Launch Briefing: exact
  target route, human outcome, three-stage handoff, target context, and one
  shared Start/Connect/Refresh intent. Offline Machines retain last-known
  project browsing, but unavailable projects, missing lifecycle/tunnel
  capability, and endpoint-less Runtimes no longer advertise a stale launch.
  Connected Connections deliberately retains the technical Selection
  Constellation.
- Launch-Briefing acceptance passes through 142 focused Fleet, theme, screen,
  pointer/keyboard, and real-PTY tests. The wide PTY proves Briefing → Flight
  Recorder → connected Home, while the resize PTY proves offline drill-down
  remains available. The complete CLI suite passes (63 files, 628 tests), and
  `test:affected` passes across 705 files (704 passed, 1 skipped; 6,247 tests
  passed, 10 skipped). CLI typecheck/build, the 71-file package dry-run, and
  Docker installer smoke all pass; the packaged installer remains independent
  of Node, npm, pnpm, Bun, and an Agent Runtime.

### Runtime observatory decision

- The previous Runtime surface spent its leading region on an Active Link and
  Session Trail split while omitting the owner, provider, uptime, and component
  facts needed to understand a running OpenAlice. Its local log lens then became
  the largest object on the page despite being supporting evidence rather than
  the status manager itself.
- Runtime now uses one responsive Observatory. Wide terminals compose Runtime,
  Route, and Services as three scan paths; compact terminals retain that order
  in one stack. Recent connection transitions stay inside the same object,
  local logs remain below it, and remote Runtime uses surplus height for more
  session history instead of an empty log region.
- Home can therefore remain a launcher and next-action surface. PID, owner,
  provider, endpoint, uptime, component state, health checks, and connection
  history have one diagnostic owner in Runtime. Disabled optional services are
  neutral, actual failures use danger semantics, and absent telemetry remains
  explicitly unreported. This change adds no backend read, lifecycle route, or
  persisted state.
- Observatory acceptance passes through 82 focused renderer/screen tests, all
  51 real-PTY cases, and the complete CLI suite (63 files, 629 tests). Real
  120×32 and 80×24 captures prove the three-column and compact-stack forms keep
  their route, owner, provider, uptime, services, recent event, and valid action
  visible without relying on the local log lens.
- A follow-up screenshot audit removed the height-filling zero-event Signal
  Scope beneath the Observatory. The compact Runtime Lens now occupies four
  lines at both 120×32 and 80×24, retains whole-row pointer reload/filter
  actions, and lets only real event streams expand into the Operational Canvas.
  Acceptance passes through 86 focused renderer/screen tests, the raw-PTY
  pointer reload case, and the complete CLI suite (63 files, 629 tests).

### Single-spine workbench decision

- A live OMP 17.3.4 capture at 120×32 and 80×24 confirmed that its default
  workbench is grounded by one identity/status rail rather than a persistent
  wall of shortcut chips. OpenAlice's contextual Action Shelf repeated actions
  already present in page content or `/` Commands, competed with the Command
  Spine, and made sparse pages feel like stacked chrome instead of one stage.
- Ordinary Home, Inbox, Connections, Runtime, Logs, and Doctor pages now use
  the Command Spine as their sole footer. Actions move to the object they
  affect: Alice Session, Launch Briefing, Launch Flight Recorder, Fleet
  Selection, Inbox Inspector, Runtime Observatory/Lens, and Doctor Signal
  Scope. Direct shortcuts and their safety state machines are unchanged, and
  `/` Commands remains the discoverable long-tail surface. Focus Workspaces and
  confirmation/refusal overlays retain their task-owned Action Shelf because
  those bounded surfaces temporarily replace the ordinary workbench.
- Removing duplicate chrome exposed useful discoverability gaps instead of
  hiding them. Failed launch flights now show both Enter Retry and Esc Back;
  Fleet Selection shows Enter's resolved Start, Connect, Browse, or Use action
  and local Transfer when available; Inbox Inspector shows Enter's read-state
  mutation; Home unread guidance names `o` Open Web; populated Logs guidance
  names filter, copy, and latest navigation.
- Real 120×32 and 80×24 captures of Home, Runtime, and Inbox prove that page
  content, contextual guidance, and the single Command Spine remain visible
  while the large terminal stage gains the same deliberate breathing room seen
  in OMP. Keyboard and pointer acceptance continue to cover the visible
  content actions and Command Spine independently.
- Single-spine acceptance passes through 101 focused screen and renderer tests,
  all 51 real-PTY cases, and the complete CLI suite (63 files, 629 tests). CLI
  typecheck and build also pass.

### Two-row Mission Rail decision

- The single-spine screenshot audit exposed one remaining piece of legacy
  chrome: brand masthead, full-width colored tab strip, and animated closing
  beacon still occupied three visual layers above an otherwise stage-oriented
  Home. A fresh OMP 17.3.4 comparison showed one framed identity line and a
  restrained context rail with foreground emphasis instead of a persistent
  selected-tab color slab.
- The Mission Header is now two rows. Brand, release control, version, and
  channel remain on the masthead; the second row is itself the closing
  navigation rail. Selected destinations use bold foreground plus brackets,
  pointer hover alone owns a bounded background, and passive destinations are
  muted. The decorative View Beacon and its transition state are removed, so
  view changes are immediate and no animation timer exists solely for chrome.
- Exact rendered segment geometry continues to own mouse targets after the
  frame offset. Connected, Launcher, Recovery, focus-task, compact, minimal,
  release-hover, keyboard, and `NO_COLOR` behavior retain their existing input
  and accessibility contracts. Two quiet rows remain between navigation and
  content, preserving pointer row stability and giving the stage deliberate
  breathing room rather than replacing removed chrome with denser content.
- Real 120×32 and 80×24 Home and Runtime captures prove the rail closes cleanly,
  every valid destination remains visible, selected state does not depend on
  color, and the main stage plus single bottom Command Spine retain their
  hierarchy.
- Two-row Mission Rail acceptance passes through 85 focused navigation, theme,
  and screen tests, all 51 real-PTY cases, and the complete CLI suite (63 files,
  629 tests). CLI typecheck and build also pass.

### Compact launch-path decision

- The first post-Mission-Rail Launcher capture showed that 80×24 still divided
  its three-stage path into equal technical columns. Machine and AliceProject
  names acquired ellipses while the two-row Briefing repeated the complete
  Start → Verify → Home handoff, so the most important instruction competed
  with duplicated process detail.
- Between 72 and 95 columns the path now uses compact stages that prioritize the
  selected Machine and AliceProject names, then an explicit `[Enter] START`,
  `USE`, or `CONNECT`. At wider sizes the renderer first attempts the complete
  technical path and only applies per-stage truncation when the full route
  truly exceeds available display width.
- A two-row Launch Briefing now carries the resolved Next key, action, and one
  immediate consequence such as “stay here through readiness.” The full
  three-stage handoff remains available in the wide Briefing instead of being
  duplicated into the compact surface. The launcher-specific Tip teaches Enter,
  arrow selection, pane movement, and repeated-click activation in one line.
- A real 80×24 capture proves that `This computer`, `Default AliceProject`,
  `[Enter] START`, `Start OpenAlice`, and the consequence all remain visible
  without ellipsis in the launch path or action line.
- Compact launch-path acceptance passes through 93 focused Fleet and screen
  tests, all 51 real-PTY cases, and the complete CLI suite (63 files, 630
  tests). CLI typecheck and build also pass.

### Launcher Spine coherence decision

- The remote-target screenshot exposed two simultaneous truths: the Launchpad
  selected `Cloud Lab → Research`, while the Command Spine still advertised
  `[i] Default AliceProject · COLD` from the local launch context. Apart from
  being visually contradictory, replacing that text with the remote name while
  retaining `[i]` would falsely imply that the local Switchboard controls the
  remote AliceProject.
- While the Launcher owns the session, the Spine now consumes its selected
  Machine, AliceProject, transport, availability, and Runtime class. It renders
  a passive route such as `Cloud Lab / Research · SSH › LIVE › LAUNCH`; it has
  no `[i]` pointer target. Connected workbench pages retain their active-target
  route and the existing local `[i]` Switchboard control.
- At constrained widths the launcher route first removes the `LAUNCH` badge and
  then Machine identity, preserving the selected AliceProject, transport, and
  Runtime signal. Real 120×32 and 80×24 captures prove remote selection stays
  coherent across the Launch path, Briefing, and Spine; the local 80×24 capture
  likewise retains `Default AliceProject · LOCAL › COLD` in full.
- Launcher-Spine acceptance passes through 93 focused screen and Fleet tests,
  all 51 real-PTY cases, and the complete CLI suite (63 files, 630 tests). CLI
  typecheck and build also pass.

### Content-owned Help exit decision

- The first Help screenshots after the single-spine change exposed a concrete
  discoverability regression: `?` still closed Help, but neither the wide
  Control Atlas Board nor the 80-column stacked Atlas visibly taught that exit
  after the ordinary Action Shelf was removed.
- Ordinary Help now ends with one content-owned `◆ [ ? ] Close Help` action in
  Board, wide list-detail, and compact stacked layouts. The row participates in
  existing action geometry, so keyboard `?`, pointer hover, and pointer click
  all use the same Help toggle without restoring a second footer spine.
- Recovery remains deliberately different: its safe Update and Exit groups
  already contain `? Close safe controls`, so it does not duplicate a generic
  close row or weaken the recovery-specific language.
- Real 120x32 and 80x24 captures prove the exit stays visible beneath the
  Control Atlas while preserving the contextual Tip and sole Command Spine.
- Content-owned-exit acceptance passes through 83 focused Help and screen
  tests, all 51 real-PTY cases including an 80x24 pointer close, and the
  complete CLI suite (63 files, 630 tests). CLI typecheck and build also pass.

### Home Session Canvas decision

- The post-navigation screenshots proved that removing the old dashboard did
  not completely remove its layout premise. Wide Home still drew an internal
  divider between identity and work, pushed the primary action to the panel's
  bottom edge, and left a conspicuous empty monitoring field between Recent
  state and the only useful next move. Compact Home compressed the same facts
  into an eight-row block at the top of a mostly empty terminal.
- Home now behaves as one Session Canvas. Its open wide gutter separates brand
  identity from the decision flow without pretending they are two panels; both
  regions are optically centered inside the bounded stage. The task flow is
  `Now -> primary action -> Signals -> Recent`, so Start, Retry, Review Inbox,
  or Open Workspace appears immediately after the sentence that explains it.
- The 80-column form keeps the same order and introduces bounded blank rhythm
  between route, Now, action, Signals, and Recent. It therefore uses the middle
  of the terminal without adding telemetry, secondary controls, or a different
  state machine. `NO_COLOR`, keyboard, mouse, motion, and hotspot ownership stay
  unchanged.
- Real running and cold 120x32/80x24 captures verify that the complete selected
  AliceProject, Machine transport, Runtime state, next action, connection
  signal, recent event, contextual Tip, and Command Spine remain visible.
- Session-Canvas acceptance passes through 78 focused screen and theme tests,
  all 51 real-PTY cases, and the complete CLI suite (63 files, 630 tests). CLI
  typecheck and build also pass.

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
