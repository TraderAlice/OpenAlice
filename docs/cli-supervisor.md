# Shell CLI Supervisor

This guide owns the computer-level `openalice` command surface above Guardian:
background and foreground lifecycle, status presentation, browser opening,
machine-readable envelopes, shell completion, compatibility aliases, and the
boundary of the Supervisor TUI.

Installer transactions belong to [[docs/cli-installer.md]]. Source preparation
and the native headless bundle provider belong to [[docs/local-runtime.md]].
Remote orchestration belongs to [[docs/remote-access.md]]. Guardian lock,
takeover, and process-tree truth belong to [[docs/project-structure.md]] and
`packages/guardian-runtime/`.

Remaining Supervisor product work is tracked in
[[plans/shell-first-cli-supervisor.md]]. Native Bun distribution and explicit
release-channel work are tracked in [[plans/bun-cli-distribution.md]] and
[[plans/release-channels-0.90.2.md]]. This guide describes only behavior already
shipped in the current tree.

## Product Boundary

The Shell Supervisor controls the local OpenAlice Runtime. It does not reproduce
the OpenAlice Web product:

```text
openalice lifecycle command
  -> presentation-neutral lifecycle core
      -> Guardian control endpoint and lease
          -> Alice + optional UTA + optional Connector

browser / Electron
  -> product interaction
```

Lifecycle start/stop commands do not edit Workspaces, broker state, trading
permissions, or product configuration. `project copy-ai-creds` is the explicit
exception that merges one complete home's AI vault into another. Browser
closure and shell exit do not stop a detached Runtime.

## Canonical Lifecycle Commands

The top-level lifecycle surface is:

```bash
openalice up [path] [options]
openalice run [path] [options]
openalice down [options]
openalice status [options]
openalice logs [options]
openalice doctor [options]
openalice open [options]
openalice create alice-project [options]
openalice project [list|use|copy-ai-creds|transfer] [options]
```

| Command | Contract |
|---|---|
| `create alice-project` | Register a named complete home. Interactive or `--yes` with `--name`, `--home`, and optional `--product trader\|nano`. Product is immutable birth (Trader default; Nano never starts UTA). TUI create remains Trader-equivalent. |
| `project list` | Print registered AliceProjects and the remembered bare-start default. `--json` emits the registry summary. |
| `project use <key>` | Record that AliceProject as the next bare-start default. Does not start, stop, or copy another project. |
| `machine list` | Print the implicit local Machine and explicitly registered SSH Machines. `--json` emits a versioned secret-free summary. |
| `machine add/remove` | Atomically remember or forget local SSH connection metadata. Non-interactive mutation requires `--yes`; remote state is never changed. |
| `machine inspect [key]` | Build a typed Machine → AliceProject inventory; each remote Machine uses one bounded aggregate SSH command. |
| `project copy-ai-creds` | Copy AI credential rows from one complete home into another. Interactive unless `--from`, `--to`, and `--yes` are set. Matching vendor+key rows are skipped; colliding slugs are renamed. Workspace launch preferences, broker accounts, and `sealing.key` are never copied. Secrets are never printed. |
| `project transfer` | Plan or copy a stopped local AliceProject to a new complete Home on a registered SSH Machine. Portable configuration and Workspace/Git state transfer; Session/runtime/auth state does not. Credentials use the SSH stream and are re-sealed with a new remote key. The source and remote default remain unchanged. |
| `up` | Prepare the selected provider when needed, start `cli-server` detached, and return only after Guardian control plus Alice HTTP readiness |
| `run` | Start the same `cli-server` owner in the foreground without opening a browser; normal Ctrl+C/SIGTERM stops that self-owned tree |
| `down` | Ask a matching Guardian to stop itself, then wait for endpoint and ownership release |
| `status` | Read normalized status and activation state without mutation |
| `logs` | Read a bounded, redacted tail from safe Runtime log rotations |
| `doctor` | Run read-only provenance, ownership, readiness, component, provider, update-metadata, and log-layout checks |
| `open` | Require an advertised Web endpoint and a successful `/api/auth/status` probe before invoking the platform browser opener |

`up` is idempotent for an already healthy matching owner. `down` is idempotent
when no owner exists. Ordinary start never signals another owner. `--takeover`
delegates replacement to Guardian's established discover, TERM, grace, KILL,
wait, then acquire ordering.

Lifecycle inspection compares the installed native content identity with the
running Guardian provider. `status`, TUI polling, and an idempotent `up` expose
a pending activation when the installed package differs from the live Runtime.
For direct Bash installs, first successful readiness confirms the installer's
activation receipt; a first-start early exit, timeout, or execution failure
restores the exact retained pointer without touching user data. A
package-manager install is only reported as pending because its manager remains
the sole owner of package files.

Native CLI installs use the Bun standalone provider, which skips source
preparation and re-enters one executable as distinct
Guardian/Alice/UTA/Connector processes; its release gate lives in
[[plans/bun-cli-distribution.md]]. `up` and `run` remain
browserless lifecycle commands and accept home, port, wait, and takeover
options; `--app-dir` is an advanced source override with the preparation and
rebuild options documented in [[docs/local-runtime.md]]. `--open` performs a
separate verified browser open after readiness.

## Default and Compatibility Surface

- bare `openalice` enters the local Supervisor TUI;
- `openalice tui` is the explicit equivalent for tests and scripts;
- `openalice start` retains the existing foreground, browser-oriented
  compatibility launcher and also selects the installed bundle by default;
- `openalice server run|start|status|stop` remains available for managed remote
  and existing scripts;
- new code uses `run|up|status|down`;
- `server status --json` retains its legacy raw status payload.

The top-level commands and the `server` compatibility surface launch the same
`cli-server` Guardian owner. They are presenters over one lifecycle rather than
separate daemons.

The TypeScript TUI reports and polls the selected Runtime, detaches with `q`,
`Esc`, or `Ctrl+C`, and exposes the same presentation-neutral operations as the
explicit commands. It owns an alternate-screen application canvas and restores
the screen, cursor, and mouse modes on detach or signal exit. `NO_COLOR` and
`TERM=dumb` remove decorative color without removing state text;
the default start view adapts to connectivity: a stopped Runtime or startup
without a reachable target opens the Machine → AliceProject → Runtime Launcher,
while a reachable target
opens the connected workbench. `OPENALICE_TUI_START_VIEW=home` explicitly opens
the Home surface for expert workflows and focused regression checks without
changing lifecycle state;
`OPENALICE_TUI_MOUSE=0` keeps the full keyboard surface while disabling terminal
mouse reporting, and `OPENALICE_TUI_MOTION=0` replaces purposeful activity
animation with a stable glyph without changing its text or layout. A normal
animated color launch begins with a full-viewport OpenAlice Boot Sequence: the
existing `ALICE` prism, deterministic signal field, and
`AliceProject → Machine → Runtime → Control` rail hand the shell into the
Mission Header in at most sixteen 80ms ticks. Any ordinary key or left click
skips and is consumed so it cannot activate the surface underneath; `q` and
Ctrl-C still detach immediately. Reduced motion, `NO_COLOR`, `TERM=dumb`, and
`OPENALICE_TUI_BOOT=0` enter the ready surface directly. The sequence performs
no Runtime read, write, discovery, or lifecycle action. Its ordinary path is
intentionally parameter-free:

- before connection, the default Connect page is an OpenAlice Launcher. Its
  explicit Machine → AliceProject → Runtime rail names all three selected
  values and whether the Runtime is ready to browse, start, connect, or use.
  Machine and AliceProject panes remain keyboard- and pointer-selectable; the
  passive detail surface is a Launch Briefing rather than a pre-connection
  telemetry dump. It names the selected route, explains the human outcome, and
  previews the three-stage handoff into connected Home; wide terminals add
  target context in a content-sized nine-row stage while ordinary and narrow
  terminals retain the outcome and next command. The final command is a
  full-row primary Action Shelf such as `◆ [ Enter ] Start OpenAlice`, not a
  keycap buried in a prose Next sentence; its complete painted row is also its
  pointer target. Surplus viewport height stays outside the Briefing so this
  action remains visually adjacent to the contextual Tip. The Briefing and its
  content-owned action share one
  resolved intent,
  so an offline, unavailable, capability-blocked, or endpoint-less target
  promotes Refresh instead of advertising a stale Start or Connect. An offline
  Machine can still expose its last known AliceProjects for inspection before
  the selected project asks for Refresh. The connected Connections page keeps
  the technical Selection Constellation for owner, service, endpoint, and
  capability inspection. Starting locally stays in the TUI and transitions to
  the connected workbench after readiness.
  A stopped remote target starts on Enter and automatically continues into its
  SSH connection when the refreshed inventory advertises a Web endpoint.
  While local start, remote start, or SSH connection owns input, the target
  inventory becomes a Launch Flight Recorder instead of remaining deceptively
  selectable behind a generic busy label. It keeps the selected Machine and
  AliceProject visible, names only observable validation, lifecycle, inventory,
  forwarding, and binding stages, and distinguishes complete, active, waiting,
  and failed stages in text and glyphs without relying on color. When replacing
  an active target, the Recorder keeps the still-live source visible as From
  and the in-flight candidate as To until readiness promotes it. Success hands
  directly to connected Home. A failure remains on the selected target with
  Enter to retry or Esc to return to target selection; its contextual Tip names
  Retry, Back, and Detach rather than teaching the hidden inventory controls.
  `q` can still detach at any time. While a stage is in flight, the Command
  Spine replaces the disabled Commands affordance with Operation Active and the
  contextual Tip states that input is owned until ready; only the truthful `q`
  detach route remains actionable. The recorder is session-local presentation
  state and does not own
  Runtime readiness, lifecycle, SSH cancellation, or persistence;
  At 72–95 columns the launch path uses compact stage vocabulary that spends
  width on the selected target names and readiness state instead of repeating
  the same Enter command or independently truncating three equal-width
  technical labels. The compact Briefing then owns the resolved full-row action
  and its immediate consequence; it does not repeat the same three-stage
  handoff. Its Tip names selection, pane movement, and repeated-click
  activation without repeating the visible primary action;
- the connected workbench has exactly one active target. Its persistent command
  spine names the Machine, AliceProject, loopback or SSH transport, and live
  Runtime signal on every page. Connections marks the active Machine and
  AliceProject independently from its current keyboard or pointer selection.
  Its contextual Tip always teaches `←→` pane movement and `↑↓` selection
  before the state-specific Enter consequence, so the single-pane compact
  layout never hides the route back to Machines. The Command Spine calls this
  surface `CONNECTIONS` when space permits, contracts it to `CONN` before
  dropping the page badge, and never leaks the internal `fleet` owner name.
  Selecting another target closes the previous TUI-owned SSH forward; it never
  leaves hidden remote tunnels behind. A remote target exposes `x` Disconnect,
  which closes only the SSH forward and does not stop the remote Runtime. Its
  Command Dock contains only remote-safe open, disconnect, navigation, and help
  routes; local Source, Setup, Logs, Doctor, restart, and stop commands do not
  silently act on the local Runtime while a remote target is active. If an
  authoritative poll reports that the active local Runtime stopped, the default
  shell returns to the Launcher and explains why. An SSH tunnel exit returns to
  the available local target or Connections with a visible disconnect notice;
- active-target health is independent from tunnel ownership. A bounded
  `/api/auth/status` probe moves a TUI-owned SSH target from connected to
  degraded after one failed check and unreachable after three consecutive
  failures without closing the forward. Any later success restores connected
  in place. Local inspection failures use the same degraded/unreachable
  presentation but do not claim the Runtime stopped; only an authoritative
  absent result returns to the Launcher. Navigation, Home guidance, Runtime,
  the persistent Dock, and the Command Dock expose the same non-color phase.
  An unhealthy target replaces Open and lifecycle mutations with `r` Retry;
  SSH `x` Disconnect remains available and still does not stop the remote
  Runtime. Automatic checks continue while the target is retained;
- the connected Home page is one responsive `Alice Session` stage rather than
  a dashboard. It orders the selected context as identity, Now, one full-row
  primary action, Signals, then Recent. Wide terminals keep the terminal-native
  `ALICE` mark and AliceProject/Machine identity in a quiet left region while
  the task sequence owns the right; an open gutter rather than an internal
  border keeps both regions inside one visual canvas. Ordinary terminals
  preserve the same task order in one column, add bounded whitespace between
  each decision layer, and omit illustration before task truth. Home
  intentionally does not repeat PID, provider, endpoint, uptime, or component
  telemetry; Runtime owns those diagnostic facts. The primary action paints
  the complete task-column width on the wide canvas and the complete content
  width when compact; its glyph and keycap retain the same hierarchy with
  color disabled, and the existing whole-row pointer target is unchanged.
  Before connection, Enter starts or connects the selected target. A degraded
  or unreachable endpoint always promotes Retry. After a healthy connection,
  unread Inbox reports promote Enter to Review Inbox and keep `o` as the
  explicit Open Web route; when attention clears, Enter returns to Open
  Workspace. The rendered label, whole-row pointer target, and Enter handler
  resolve from the same intent. `⌂` AliceProject remains
  a direct route into the Switchboard, while passive identity and status rows
  do not pretend to be controls. Color strengthens identity, focus, healthy
  state, and actionable attention, but glyphs and text keep the complete
  contract under `NO_COLOR`;
- the Fleet page renders `Machine → AliceProject`: launch-capable ordinary
  terminals use two bordered panes, while a connected Connections page below
  96 columns gives the focused inventory one complete full-width pane instead
  of truncating both sides. Terminals below 72 columns retain the narrow
  Machines-to-Projects drill-down;
  selection and list windows survive resize, use Unicode display width, and
  keep the action/detach footer visible at the supported 80×24 baseline.
  Overflowing Machine and AliceProject panes reserve their final content column
  for a proportional `│` track and `█` thumb, exposing each pane's independent
  window position. Hovering that Rail Navigator replaces the track cell with
  `◆` and previews the proportional Machine or AliceProject; left press jumps
  selection to it and owns a left-button drag until release. Rail interaction
  only changes focus and selection, so it never drills in, opens, stops,
  restarts, or detaches an AliceProject. In the wide
  hierarchy, the active pane uses a `◆` title and `▶` strong selection while
  the related inactive pane uses a `◇` title and foreground-only `◁` context.
  Enter, left-arrow, or pointer selection moves that same focus owner; narrow
  drill-down retains one active pane, and `NO_COLOR` keeps the distinction in
  the glyphs.
  Background refresh of the selected local Runtime updates its inventory row
  without moving a user who is inspecting another Machine or AliceProject;
- the top-level chrome is a two-row Mission Rail: a framed brand/release
  masthead and one OMP-style closing navigation rail. It replaces the legacy
  title/divider/tab stack and removes the decorative traveling View Beacon.
  Navigation changes immediately instead of animating application chrome and
  accepts Tab, left/right, and `[`/`]`. Its valid destinations are adaptive:
  connected sessions expose Home, Inbox, Connections, and Runtime; the
  Launcher exposes Connect and Help; Recovery exposes Recovery and Help. Each
  destination keeps a stable glyph, label, and optional status badge. Color
  terminals use strong foreground emphasis for the selected bracketed label,
  a bounded background only for pointer hover, and a muted rail for passive
  destinations; `NO_COLOR` preserves the same brackets and glyphs. Wide labels
  collapse through compact and minimal variants so every valid destination
  remains reachable at 46 columns. The renderer publishes exact final segment
  geometry for pointer hover and click rather than reconstructing hit regions
  from labels.
  `↑`/`↓` move within the active Fleet pane and the mouse wheel moves the
  focused Fleet selection.
  Connections, Inbox, and loaded Runtime events expose available counts in the
  navigation rail.
  Each status badge is part of its tab's pointer target rather than a separate
  control.
  Fleet rows expose pointer hover and click: the first click selects or focuses,
  including when the row was already selected only as inactive related context.
  A second click on the focused selected Machine drills into AliceProjects; a
  second click on the focused selected AliceProject invokes Enter's primary
  action. Pointer activation therefore cannot cross an inactive pane boundary
  on its first click. Pane headers and unused body space are focus-only pointer
  surfaces: hovering an inactive pane changes its title marker from `◇` to `»`,
  and clicking transfers focus without selecting or activating a row. The
  inter-pane gutter remains inert.
  Fleet uses five visible inventory rows as its compact baseline. At 72 columns
  and wider, surplus viewport height expands that window only as far as real
  Machine or selected AliceProject inventory requires. Both panes, independent
  scroll rails, and pointer row mapping consume the same final count, so a tall
  terminal reveals more real rows before it asks the user to scroll; narrow
  drill-down and constrained terminals keep the five-row contract.
  When wide Fleet still has at least nine complete detail rows after revealing
  all available inventory, Selection becomes a passive Constellation instead
  of leaving that surplus unowned. It visualizes the selected
  Machine → AliceProject → Runtime/Web route and expands only reported product,
  port, owner, uptime, service, capability, and refresh facts. The Constellation
  has no pointer target or lifecycle action. The Selection surface owns the
  current Enter action in both forms and exposes Transfer only for an available
  local AliceProject; compact Selection remains two rows plus that content-
  owned action. When the exact connected AliceProject is selected, that surface
  is titled Active Connection and Enter returns Home; choosing any other target
  turns it into a Switch Target surface with an explicit Switch Candidate
  identity and Switch AliceProject or Connect & Switch action. Its contextual
  Tip explains that the current target remains live until the new route is
  ready. Machine focus retains Browse projects and its generic focus guidance.
  With only the local Machine, Fleet focus starts on its current AliceProject;
- ordinary workbench pages have one bottom surface: the Command Spine. Primary
  and contextual actions live with the object they affect: Alice Session,
  Launch Briefing, Launch Flight Recorder, Fleet Selection, the selected
  message inside Inbox Desk, Runtime Observatory or Lens, and Doctor Signal
  Scope. `/` Commands owns the
  long tail while direct shortcuts remain active; `?` retains the complete
  keyboard reference. The Inbox Desk's selected message exposes Enter's
  read-state mutation, and a failed Flight Recorder keeps both Enter Retry and
  Esc Back visible in its content. This avoids a second footer that competes
  with page truth or repeats the Spine. Focus Workspaces and
  confirmation/refusal overlays still own a local Action Shelf because that
  bounded task temporarily replaces ordinary workbench navigation. Each
  complete local action segment derives a display-
  width-aware pointer target from the final responsive layout, so hover and
  click survive reflow and invoke the same input state machine as the
  corresponding key. Hover changes the leading `◆`/`·` or divider to `›`,
  preserving a visible focus signal even under `NO_COLOR`. Confirmation and
  refusal semantics therefore do not have a separate mouse-only path. When a
  wide layout composes adjacent framed cards, theme decoration classifies each card
  column independently at the rendered gutter; a primary action in one card
  must not color fields, borders, or whitespace in its neighbor;
- wide split-pane content follows the same containment contract. Selection,
  pointer hover, diagnostic severity, and launch-intent styling own only the
  inner content of the framed column that carries that semantic state. The
  gutter, borders, and semantically neutral neighboring pane remain unchanged;
  independent semantic rows in both panes may still style themselves. Single-
  pane and `NO_COLOR` output retain their existing plain-text structure;
- an empty Runtime log lens stays compact instead of claiming the Operational
  Canvas. Its four-line panel states Standby, Quiet, or Clear and retains only
  snapshot reload or filter cycling plus Help. Empty Doctor keeps its truthful
  Signal Scope with Run/Rerun and Help. Scroll, copy, Inspect, Latest, First,
  and Last return only when a filtered event or diagnostic check exists. Their
  contextual Tips state the same empty contract;
- at 100 columns and wider, Home's single Alice Session stage may absorb
  available terminal height up to a bounded 17 rows. The identity column stays
  quiet while both identity and task sequences center independently; the
  primary action follows Now instead of settling against the stage's lower
  edge. Compact layouts use the same hierarchy with bounded vertical rhythm,
  and no other panel inherits this Home-only height policy;
- the connected Home page keeps one product name from Mission Header through
  Command Spine: the footer projects `◆ HOME`, never the internal `overview`
  panel key. At compact widths the view badge is removed before selected
  AliceProject or Runtime truth, matching the Spine's existing priority order;
- a persistent full-width Command Spine is the sole default footer and closes
  the application with `╰─`/`─╯`
  while keeping `[ / ] Commands` and `[ q ] Detach` visible on every Supervisor
  page. A flexible track joins those controls to an OMP-style breadcrumb of the
  selected AliceProject, compact Runtime signal, and active-view badge. The
  responsive order removes the view, then project context, before the essential
  controls; 80 columns retain the complete project name and Runtime signal,
  while wider terminals retain all four segments. Controls, project identity,
  Runtime health, and view use distinct semantic tones on one continuous rail;
  `NO_COLOR` preserves the border, track, glyphs, and breadcrumb hierarchy.
  Below 60 columns, where all right-side context is intentionally removed, the
  flexible track closes continuously from Detach into `─╯`; it does not retain
  an empty breadcrumb gap or a detached final rail.
  `[ i ]` and its complete visible project-name segment are one direct
  pointer/keyboard route into the existing AliceProjects overlay. Commands and
  Detach likewise expose their complete labels as pointer targets. `/`
  opens a shallow bottom-anchored Command Dock over the unchanged current page
  and changes the Spine action to `Close`. The Dock spans the available width
  above the Spine, shows at most four results around the current selection, and
  contracts for filtered or empty states. It exposes
  only commands valid for the current Runtime/recovery context. Typing filters
  and ranks command names, groups, shortcuts, and compact English/Chinese
  intent aliases in place. The focused search rail always exposes a caret;
  color terminals pulse it at a bounded cadence while reduced motion keeps the
  same solid affordance. That rail is the sole typing instruction. A muted
  footer names only the current navigation, run, close, and—once a query
  exists—edit/clear routes; keycaps carry the emphasis while the persistent
  Spine remains the owner of `/` Close. Unicode input is preserved, Backspace
  removes one code point, Ctrl+U clears,
  and an explicit empty state keeps the query available for correction. Up/Down
  wraps selection, the mouse wheel moves within the visible result set, pointer
  hover highlights a complete row, and clicking a row selects and runs it.
  Enter runs the selected command, while direct shortcuts remain available from
  the Supervisor outside the Dock. All routes feed the existing keyboard
  action, confirmation, refusal, or detach state machine.
  Activation closes the Dock before Setup, Update, project selection, or a
  confirmation modal takes focus; only one overlay owns input at a time.
  The persistent Command Spine is the sole exception to overlay pointer
  isolation: its final rendered Close, Detach, and visible AliceProject segments
  remain mouse-capable while the Dock is open and still feed the same Screen
  input handlers. No other overlay permits pointer click-through. `/`, `Esc`, or
  the visible Close segment closes the Dock without exiting, while `q`, its
  visible Detach segment, and `Ctrl+C` retain global detach behavior;
  Before connection, the Spine describes the selected Launcher target instead
  of the local process context: Machine/AliceProject, LOCAL or SSH transport,
  selected Runtime signal, and a wide `LAUNCH` badge. This route is passive and
  deliberately has no `[ i ]` keycap because that key edits the local registry,
  not the selected remote target. Compact projection drops Machine before the
  AliceProject identity so the actionable target survives at 80 columns;
- asynchronous work, results, and pointer previews replace the Command Spine's
  right-side context instead of inserting a separate activity row. Working wins
  over Error, which wins over Notice/Ready/Status, which wins over Preview;
  removing hover restores the selected Machine/AliceProject/Runtime/view
  breadcrumb. Busy, informational, successful, actionable-warning, failed, and
  preview states retain distinct glyph and text labels without depending on
  color; only the busy glyph animates. Feedback is object-first and bounded to
  the available rail width, so it never moves Command Spine pointer targets
  and does not introduce a second lifecycle or error path.
  When the terminal is taller than the current page, one elastic blank stage
  grounds the Command Spine at the terminal edge; short
  terminals retain their natural complete flow without clipping. Resize changes
  only that elastic stage and does not reset selection, focus, or action state.
  When the stage has at least two spare rows, one contextual `Tip:` Beacon
  teaches a useful interaction for the active view or Runtime state while
  preserving a blank row after page content. It disappears rather than consume
  a required row, has no pointer target or action path, and remains identical
  text under `NO_COLOR`;
- color-capable motion-enabled sessions play one bounded brand-color sweep on
  entry across the OpenAlice header and any visible brand mark. The header then
  settles while a visible Overview `ALICE` mark continues a slow six-phase
  prism at 240ms per phase. The ambient mark pauses whenever a focused overlay,
  confirmation, or busy operation owns attention and resumes after it closes;
  `NO_COLOR` and reduced motion remain completely static. A successfully refreshed
  running Runtime alternates `●`/`◉` as a low-frequency heartbeat in Overview
  and Fleet; the adjacent `RUNNING`/`running` text never changes, and failed
  probes still surface through the diagnostic rail rather than animation;
- Help is a responsive task-led Control Atlas rather than a prose screen or
  static shortcut wall. Wide tall terminals become a Help console: a stable
  left rail exposes Start/Connect/Open, command search, AliceProject selection,
  and the Navigation/Runtime/AliceProject systems; a single right inspector
  explains only the selected system and presents its complete command list.
  Description text wraps instead of being silently truncated. Ordinary
  terminals split those groups from the selected group's explanation and
  visible keycaps; narrower terminals stack the same focus model.
  Arrow/Home/End keys, wheel movement, and whole-row pointer hover/click share
  one selection. Keycaps in the inspector remain direct command targets rather
  than enlarging the system-selection hit area. Ordinary Help owns a final
  `◆ [ ? ] Close Help` content action in the wide console, list-detail, and
  compact stacked layouts; its visible row is pointer-active and invokes the
  same `?` toggle as the keyboard. It does not restore the ordinary footer
  Action Shelf. Recovery keeps its explicit `? Close safe controls` action
  inside the safe update/detach groups instead of duplicating a generic exit.
  Recovery mode projects only safe update and detach groups. Help remains the
  place to understand controls, while `/` remains the faster Command Dock.
  Update, Setup, AliceProject selection, Runtime Source, and Remote Transfer
  use the same bordered overlay shell and semantic selected/description states.
  Runtime Source is a responsive Launch Bay: its Select, Validate, Save, and
  Launch route stays visible beside the checkout Field Inspector on wide
  terminals and stacks intact at the 80-column baseline. Rejected checkouts
  visibly block Save and Launch without leaving the focused input.
  Overlay lists share the application pointer contract: motion moves the
  visible selection, the wheel moves its list window, and a click invokes the
  same Enter path. Rendered keycaps remain clickable inside list, input,
  review, failure, and completion phases; the pointer router derives the
  overlay origin from the same terminal dimensions, anchor, margin, and
  rendered height used by the TUI compositor.
  Lifecycle, managed-source, and update confirmations enter a focused Decision
  Gate. The bounded card remains centered, but the operational field behind it
  is cleared so clipped page copy and inactive controls cannot read as modal
  context. Mission Header navigation becomes
  an action-specific identity such as `FOCUS · STOP RUNTIME / DECISION GATE`,
  its Esc target repeats the exact refusal such as `Keep running`, release
  provenance becomes read-only `BUILD`, and the bottom Console repeats the same
  exact action/refusal pair plus the positive action as its task badge. Each
  modal separates the question from an explicit Impact section and routes its
  own plus the Console's complete-segment pointer hover/click through the same
  confirmation state machine. Acceptance closes the gate before work appears in
  the fixed activity slot; cancellation restores the exact previous page and
  changes no Runtime or configuration state.
  Existing validation and hardware-cursor contracts remain unchanged;
- registered Machines refresh in the background with one bounded,
  non-interactive (`BatchMode=yes`) SSH inventory request each. Registered,
  checking, online, unauthorized, offline, and incompatible remain distinct
  from per-project Runtime state;
- `m` on a selected local Fleet AliceProject opens the remote-transfer wizard.
  Its Transfer Flight Deck keeps an eight-stage route, the current Mission
  Brief, and a stable Safety Rail visible across destination Machine,
  key/Home, credential handling, exact-Session Issue policy, checksum review,
  streaming, and arrival. Wide terminals pair route and Brief; the 80-column
  baseline compresses completed/current/next stages above the complete Brief.
  Entry phases render as a Mission Console with semantic field/choice headers,
  visible validation repair state, and whole-segment Continue, Choose, and Back
  actions; these project the existing wizard inputs and lists rather than
  introducing another transfer controller.
  Planning and execution stay in the same Mission Control region: Manifest
  exposes READY/HOLD evidence and the default-No boundary, In Flight shows
  files, bytes, progress, verification, and cancellation, Recovery distinguishes
  transaction retry from plan rebuild, and Arrival keeps Start, Connect/Open,
  and Done as separate whole-segment actions.
  It renders the same checksum and exclusion plan as the explicit command.
  Default No changes nothing. Success offers separate Start, Connect/Open, and
  Done actions and never auto-starts;
- Enter or `o` on a running compatible remote AliceProject opens a TUI-owned
  loopback tunnel and makes its forwarded endpoint the active target. It stays
  in the TUI; `o` from the connected workbench opens the browser separately.
  Detaching aborts only those tunnel processes;
  it never stops the local or remote Runtime. `s` on a stopped compatible
  remote AliceProject re-probes inventory and registration, then starts it
  through the registered SSH Machine. Enter is the visible primary equivalent.
  Remote stop, restart, logs, Doctor,
  Setup, source, and other configuration mutations remain refused;

- Enter on the disconnected local Launcher starts the persistent Runtime without
  opening a browser; once connected, Enter on Home opens the active endpoint;
- `s` starts the persistent Runtime in the background without opening a
  browser;
- `o` opens an advertised, verified Web endpoint;
- connected navigation is Home, Inbox, Connections, and Runtime. Inbox reads
  the active target's bounded `/api/inbox/history` surface, shares server-owned
  read/unread state, polls every 20 seconds, and offers no delete action. Its
  single responsive Inbox Desk keeps Message Stream and Selected Message in
  open columns on wide terminals and stacks the same reading order at compact
  widths. The selected message owns Enter's Mark read/unread action; arrows or
  the wheel move selection, and the contextual Tip teaches that exact loop.
  The Command Spine uses the themed `● INBOX` view identity, contracts it to
  `● BOX` only at the intermediate responsive tier, and removes the badge
  before sacrificing target or Runtime truth.
  Help remains available through `?`; Doctor remains a Runtime tool rather
  than a top-level product destination;
- Runtime is a layered status-manager surface rather than a renamed log tail.
  Its Command Spine identity is therefore `RUNTIME`, with `RUN` as the
  intermediate responsive badge before the view identity is removed; the
  internal `logs` panel key never appears in product chrome.
  Its responsive Runtime Observatory leads with three wide columns—Runtime,
  Route, and Services—or the same facts in one compact stack. It owns process
  state, owner/PID, provider identity, uptime, Alice/UTA/Connector status, the
  active Machine → AliceProject route, loopback or SSH-forward transport,
  endpoint health, failed-check count, and the valid Open or Retry action.
  Optional disabled services remain neutral; only reported failure is danger,
  and missing telemetry says `not reported` instead of inventing state. A
  bounded recent-event region records only meaningful acquire, release,
  degraded, unreachable, recovered, and stopped transitions, keeps at most
  twelve newest events, sanitizes target identity, and is never persisted.
  Local Runtime log evidence remains directly below the Observatory; remote
  targets give surplus height to recent transitions and expose only remote-safe
  Open, Check, Disconnect, Connections, and Help actions;
- `x` stops and `r` restarts only a `cli-server` owner, after an impact
  confirmation;
- `l` reads the bounded, redacted log tail;
- `d` runs read-only Doctor checks;
- `u` opens the responsive Release Observatory. The Mission Header exposes that
  same path as a responsive Release Control.
  Wide terminals show `[ u ]` beside version/channel provenance, compact
  terminals retain a `↗` affordance, and the whole rendered segment owns hover
  and click rather than only the keycap. The lane map and selected Channel
  Brief sit side by side on wide terminals and stack at the
  80-column baseline. Pointer movement or a lane click only changes the
  selection; `Enter` or the full `Check` action is the sole network boundary.
  It probes that one channel and, when a candidate is available, can install it
  after explicit confirmation through the same verified atomic installer path
  as `openalice update --yes`. The
  choice is session-local until installation succeeds; installer provenance
  makes the chosen channel the next launch's default. Package-manager-owned
  installs are never overwritten by the TUI: a stable candidate shows the
  matching manager command, while beta/dev explain that those channels require
  an explicit switch to the direct installer. If an explicit selector or
  channel manifest ever targets the legacy v0.90.1 layout, a native
  installation refuses that downgrade and stays unchanged. Current native
  stable releases switch through the ordinary direct-installer transaction.
  After a successful in-TUI install, the running Supervisor is still the
  previous CLI and does not reload; the user must exit and run `openalice`
  again;
- `i` lists the implicit default plus registered AliceProjects, selects one
  without stopping another project, or creates a separate named complete home.
  The responsive Switchboard pairs a bounded project map with Home, Web, role,
  and action inspection on wide terminals, then stacks the same regions at the
  80-column baseline. Its Create row opens a two-stage AliceProject Foundry:
  Identity and Complete Home remain visible beside the focused Field Inspector
  on wide terminals and stack as a compact route at 80 columns. Validation
  remains ordered, and only the final `Create & select` action registers the
  new complete home. AI vault copy is a separate command:
  `openalice project copy-ai-creds`;
- `p` opens Setup for data home, browser port, update checks, and resolved
  Runtime/config provenance. Setup can edit either the selected AliceProject or
  machine defaults inherited by projects. Wide terminals present a Setup map
  beside the selected field's Inspector; narrower terminals stack the same
  complete regions. Editable fields stay in that model through a responsive
  Setup Workbench: the active layer and Edit/Validate/Save route remain visible
  beside the focused input, while invalid values block Save and keep the field
  available for correction;
- `m` on Overview is an advanced control that confirms, prepares, remembers, and starts an installer-managed source
  aligned to the installed CLI branch/version;
- `c` opens the Source Launch Bay to choose, validate, remember, and then start
  the selected AliceProject's source checkout;
- `?` toggles Help; `[` and `]` expose the other top-level panels.

Setup, Source, AliceProject, Release, and Remote Transfer use one secondary-task
surface. At 100x28 and larger, a Focus Workspace replaces every Overview
content row between the Mission Header and Control Console instead of allowing
unrelated cards to show through a centered dialog. During focus, the ordinary
navigation rail is replaced by a task-owned Focus Header: it names the task
surface and existing workflow contract, exposes a real Esc Back action, and
publishes no page targets. The Context Ribbon uses the same task identity. The
task renderer, pointer targets, and mutation
callbacks remain unchanged inside that stage. Smaller terminals retain the
bounded centered sheet because their stacked responsive content takes priority
over clearing the whole viewport. Closing the task restores the prior
top-level panel identity without changing Runtime or selection state.
The Mission Header keeps version, channel, and update provenance as a read-only
`◇ BUILD` signal while focused; the normal `[ u ]` Release Control and its
pointer target return only after the task closes.
The Control Console follows the same ownership rule: its Action Shelf uses the
active task's Enter, movement, and Back vocabulary, while the Command Spine
shows `FOCUS WORKSPACE` and a real Esc exit instead of leaking unavailable
Overview or Fleet commands. Pointer activation on either Focus Console row is
routed to the same overlay component that owns keyboard input.
When the wide stage has enough surplus rows, a read-only Focus Trajectory
centers the task's existing workflow and mutation boundary in that quiet field.
It does not claim completion state, expose a hit target, or add another action
path: Setup projects Inspect/Edit/Validate/Save, Source projects
Select/Validate/Save/Launch, AliceProjects project Inspect/Select or
Create/Remember, and Release projects Choose/Probe/Confirm/Install.
Remote Transfer does not add a second trajectory: its existing eight-stage
Flight Deck already supplies destination, identity, location, secrets,
schedules, checksums, stream, and arrival context inside the same stage.

The TUI refuses to stop or restart Electron, development, incompatible, or
otherwise foreign owners. Its stop/restart confirmation states that active Web
and agent sessions will disconnect. Detaching never implies stopping. Update
discovery runs in the background against the installed channel and cannot block
lifecycle controls. Discovery never opens the channel selector or installs;
only a confirmed `u` action may invoke the installer. Stable/beta compare
product versions; dev compares the complete native archive checksum and
displays its commit as a diagnostic revision. The bounded startup cache is
keyed by both channel and installed source fingerprint, so activating a new
version or dev archive cannot reuse the previous installation's result.

The installed Runtime is the default provider below stored configuration and
above cwd discovery. TUI start therefore works from any directory and shows a
small ordinary action bar. A configured AliceProject source,
`OPENALICE_APP_HOME`, or `--app-dir` overrides the bundle; `m` and `c` remain
advanced source controls. The managed source path is
`<install root>/sources/<install-source identity>/OpenAlice`.

For an older or development install without a bundled Runtime, Enter still
owns the ordinary path. If current-directory source discovery fails, it reads
the installed branch/version provenance and opens the same managed-source
confirmation as `m`; accepting prepares and remembers that source, starts
OpenAlice, and opens the browser. `c` remains the explicit manual-checkout
path. A source-run CLI with no installed provenance falls back to the source
path editor instead of pretending it can manage an install root.

## TUI Launch Context

The TypeScript entry resolves launch-affecting values before starting terminal
raw mode. Bare `openalice` and `openalice tui` accept:

```text
--project <key>
--instance <key> # deprecated compatibility alias
--home <path>
--port <port>
--app-dir <path>
--no-update-check
--update-check
```

Resolution order is defaults, installed Runtime, machine Supervisor
configuration, selected AliceProject configuration, environment, then explicit CLI
flags. The immutable
resolver retains field provenance for every layer. Before terminal raw mode,
the Supervisor reads a versioned machine-local document at
`<Supervisor root>/config.json`. It contains machine defaults and an
AliceProject map outside every selectable complete home.

The same Supervisor root may contain `machines.json`, a separate versioned
registry for the implicit local computer plus named SSH hosts. It is not part
of any AliceProject and is not selected by `OPENALICE_HOME`. Writes are atomic
and owner-private; unknown additive fields survive rewrites, while an invalid
or newer known schema fails visibly. This registry remains separate from the
hashed `remote-targets.json` tunnel-port cache.

Bare `openalice` and flag-less `openalice tui` must still open a machine-level
Supervisor shell when that document cannot be parsed. Config recovery explains
that AliceProject configuration cannot be read and may require a newer
OpenAlice. It does not inspect, start, open, stop, restart, or configure a
guessed project; only help and the confirmed update path remain. Explicit
`--project`, `--instance`, or `--home` still fail rather than silently targeting
another home. Config recovery itself never inspects those homes. An unavailable
registered Home still fails when an environment or flag selection is explicit,
because that path would otherwise start a different project.

The current schema (`schemaVersion: 2`) preserves additive unknown fields
through parse and write so a later OpenAlice can add keys without being
stripped by an older Supervisor save. Invalid known fields still fail. A
genuinely newer `schemaVersion` is detected before unknown-field handling and
reported as a distinct newer-schema error. Released v1 documents still
canonicalize to v2 and still reject unknown v1 fields. Do not invent permanent
compatibility for unreleased shapes.

The `p` Setup overlay atomically edits the selected AliceProject's data home,
browser port, and update-check policy. Its first row switches between `This
AliceProject` and `Machine defaults`. A blank Home or port and the `Inherit` update
value remove that layer's override, exposing the next lower-priority value
immediately. Named AliceProjects must retain an explicit, separate complete home;
only the implicit `default` may inherit its Home. Home and port remain
read-only while the selected Runtime is active when the edited layer affects
that Runtime. A machine default may still be changed while a higher project,
environment, or flag layer shields the running AliceProject.

Setup renders as a responsive Setup Studio rather than exposing the underlying
settings widget directly. The map keeps all six fields and their EDIT/CYCLE/READ
capability visible; the Inspector keeps the selected field's current resolved
value, precedence or safety explanation, Runtime state, and complete Enter/Esc
Action Shelf together. At wide sizes the regions are adjacent and pointer input
is column-bounded, so clicking an Inspector action cannot select the row beside
it. At the 80-column baseline they stack without changing keyboard order or the
atomic configuration write path.

Any selected-project value supplied by an environment variable or explicit
CLI flag is shown with its resolved value and a locked provenance message; the
TUI never writes a lower-priority project value that appears to override it.
Machine-default editing remains available because it intentionally changes the
lower layer for future or inheriting launches. The overview reports the
resolved field provenance, and Setup identifies the installed Runtime by the
single OpenAlice product version plus diagnostic content identity rather than
presenting its filesystem path as a second product concept.

The `i` AliceProject overlay reads the same atomic registry, always shows the
implicit `default`, and adds every configured named project. Selecting one
switches the live Supervisor view and records it as the next bare-start
default; it does not stop, move, copy, or delete another project. Creating an
AliceProject collects a validated lowercase key and separate complete home
inside the TUI, rejects equal or nested registered homes, and selects the new
entry atomically. An existing target must be empty or recognizable as an
OpenAlice complete home; an unrelated non-empty directory is rejected. A new
target is created and canonicalized when registered, so a later missing
registered Home is never silently recreated. A bare TUI launch falls back to
the first available project, keeps the unavailable registry entry intact,
and shows a persistent notice directing the user to `i AliceProjects`; selecting
the displayed fallback repairs the remembered default. An explicit
environment/flag selection still fails instead of falling back because
automation must never run against a different Home. The suggested Home is a
sibling such as
`~/.openalice-research` and remains editable before creation. A session whose
project or complete home came from `OPENALICE_PROJECT`,
`OPENALICE_HOME`, `--project`, or `--home` shows the registry read-only
instead of pretending that a lower-priority selection can win.

The registry appears as an AliceProject Switchboard rather than the underlying
selection widget. Its map identifies current, bare-start default, available,
and create rows; the Inspector keeps the selected Home, automatic or fixed Web
port, role, consequence, and complete Enter/Esc Action Shelf together. Up to
eight rows remain visible beside the Inspector on wide terminals, while the
80-column layout uses a five-row scrolling window so map, Inspector, status,
and borders remain complete within 24 rows; shorter terminals reduce the map
window further instead of clipping the Inspector or status. The proportional
rail reflects overflow without owning selection. Pointer input is
column-bounded and feeds the existing list callbacks, so an Inspector click
cannot select the project beside it and no second persistence path exists.

`OPENALICE_INSTANCE` and `--instance` remain deprecated aliases at the released
automation boundary; they are not current product terminology.

The `c` editor validates an OpenAlice checkout, atomically saves it as the
selected AliceProject's `appDir`, and starts the Runtime. If
`OPENALICE_APP_HOME` or `--app-dir` supplied the source, the TUI reports that
higher-priority override instead of overwriting it. `openalice config check`,
live reload with last-known-good retention, registry-entry removal, and full
component/project dashboards remain later increments.

`OPENALICE_PROJECT`, `OPENALICE_HOME`, `OPENALICE_WEB_PORT`,
`OPENALICE_APP_HOME`, and `OPENALICE_NO_UPDATE_CHECK` are the corresponding
environment overrides. `OPENALICE_SUPERVISOR_HOME` may relocate the
machine-wide Supervisor root, which remains outside every selectable complete
home. Installer launchers supply the lower-priority internal pair
`OPENALICE_MANAGED_RUNTIME_PATH` and
`OPENALICE_MANAGED_RUNTIME_CONTENT_IDENTITY`; ordinary users do not need to set
them.

Only an installer-owned Runtime carrying `OPENALICE_MANAGED_PI_PATH` receives
project-private `PI_CODING_AGENT_DIR` and `PI_CODING_AGENT_SESSION_DIR`
values. Source development and an external Pi retain their native user
configuration and session roots.

The same stored resolver selects homes for `up`, `run`, `down`, `status`,
`open`, `logs`, and `doctor`; those commands also accept
`--project <key>` and load a Home registered through the TUI.
Consequently a Runtime started through the TUI and one started by
`openalice up` receive the same managed-Pi environment, source, Web-port
policy, and update-check setting unless an explicit command option overrides
them. The transitional `start` and `server` compatibility presenters still
own their legacy option parsing and output until the root parser conversion is
complete.

An inherited default Web port remains automatic for the source-backed built
Guardian: it probes upward from 47331 together with unconfigured
MCP/local-tool, UTA, and Connector ports. Consequently multiple complete homes
or the desktop app may occupy historical defaults without breaking a CLI
Runtime. Creating an AliceProject and the first Alice `loadConfig()` must not
write a default into `data/config/ports.json`; a written `web` value is a pin.
A machine/project setting, environment value, or explicit flag pins
the Web port and fails visibly on collision, as do explicit internal
environment or `data/config/ports.json` values. Stop and restart wait for
Guardian plus Alice ownership evidence to clear, not merely for the control
socket to disappear.

## Presentation-neutral Core

`packages/cli/src/lifecycle.mjs` owns:

- complete-home resolution;
- idempotent matching-owner discovery;
- source-provider preparation;
- detached or foreground Guardian spawn;
- readiness and early-exit handling;
- structured start results and lifecycle events;
- graceful stop delegation;
- verified Web opening.

It returns structured values and does not decide human or JSON wording.
`packages/cli/src/lifecycle-command.mjs` owns top-level parsing, presentation,
help, completion, and JSON envelopes. `packages/cli/src/server.mjs` is the
legacy presenter.

Source preparation may emit bounded progress through an output sink supplied by
the presenter. Lifecycle truth still comes only from Guardian control and
readiness probes; human progress or log text is never parsed as state.

## Machine-readable Contract

Top-level `up`, `down`, and `status` accept `--json`. Successful output uses:

```json
{
  "schemaVersion": 1,
  "command": "status",
  "ok": true,
  "result": {
    "status": {}
  }
}
```

Runtime failures after parsing use the same envelope on stderr:

```json
{
  "schemaVersion": 1,
  "command": "down",
  "ok": false,
  "error": {
    "code": "EOWNED",
    "message": "..."
  }
}
```

The nested normalized status retains Guardian transport/control compatibility,
lifecycle class, product version, provider identity, pending activation,
bounded uptime, selected home, sanitized owner, loopback Web endpoint,
component summary/detail, capabilities, and safe diagnostic detail.
`runtimeVersion` remains as a compatibility alias while `productVersion` is
the user-facing release identity. Status never includes lock tokens,
credentials, internal ports, or arbitrary environment values.

Exit behavior is:

- `0`: the requested action completed, including already-running `up`,
  already-absent `down`, or a successfully inspected non-running status;
- `1`: Runtime, control, readiness, browser, or other operational failure;
- `2`: invalid lifecycle syntax, option, shell name, or root command.

Scripts determine running versus absent from the status class, not from a
special nonzero `status` exit.

## Human Status

Human `status` reports:

- lifecycle class and selected complete home;
- running Runtime product version when available;
- owner surface and PID;
- verified advertised Web URL;
- Alice, UTA, and Connector state;
- source launch root and safe diagnostic detail when available.

Dev-owned Runtimes may be inspected and opened. A healthy local `dev` or
`cli-server` owner also advertises a verified loopback Web endpoint that
Electron can open in the default browser without takeover. `down` still
refuses both. Only a matching `cli-server` that advertises `runtime.stop`
accepts the stop transaction. The Electron browser handoff is documented in
[[docs/data-locations.md]].

Source dev and built Guardian entries publish the same private, local
`runtime.status` contract. In particular, `pnpm dev` advertises its owner PID,
source root, Vite Web endpoint, and Alice/UTA/Connector health. A second
process targeting that complete home therefore remains useful for read-only
`status`, Doctor, and `open` operations even though a second writer start still
exits with the existing-owner diagnostic. Dev owners never advertise
`runtime.stop`; stopping, takeover, and process-tree replacement stay with the
owning surface.

## Control Compatibility

Guardian control uses one local JSON-line request and response per connection.
The transport envelope remains `protocol: 1`. Compatible additions do not bump
that number: older clients ignore unknown result fields and newer clients
default missing additive metadata to control API 1.

Normalized status includes:

```json
{
  "protocol": 1,
  "control": {
    "apiVersion": 1,
    "minClientApiVersion": 1,
    "capabilities": ["runtime.status", "runtime.stop"]
  }
}
```

The CLI must check an advertised capability before requesting an optional
mutation. A future server whose `minClientApiVersion` is newer than the CLI is
reported as `incompatible`; the CLI does not guess at stop semantics. A
breaking framing or response-envelope change requires a transport protocol
bump. Cross-version fixtures preserve both directions: the current client
normalizes the legacy protocol-1 result, and a legacy request reads the
additive current result.

## Logs

`openalice logs` reads only regular `server.log` and `server.log.<rotation>`
files inside `<home>/logs`. Symlinked directories/files and unrelated names are
rejected or ignored. Reads are bounded to ten recent rotations, 256 KiB per
file, 1 MiB total, and 5,000 requested lines. It never follows arbitrary paths.

Before terminal or JSON output, the reader redacts common authorization,
token, API-key, password, private-key, sealing-key, and first-run admin-token
forms. Terminal control bytes are escaped. Redaction is a defense-in-depth
safety net; Runtime logs can still contain private product or trading context
and should not be published blindly.

The current command is a snapshot tail:

```bash
openalice logs --lines 200
openalice logs --lines 200 --json
```

The TUI projects that same bounded snapshot into a selectable Event stream and
Event Lens.
OpenAlice JSON log lines are rendered best-effort as severity, clock time,
message, then compact context so the useful event survives terminal clipping;
unrecognized and third-party lines remain plain text. The latest matching event
starts focused. Up/Down, Page Up/Page Down, Home/End, the mouse wheel, pointer
hover, and whole-row click share that focus model; the Lens follows it with the
source line, semantic severity, JSON/text format, projected message, and
sanitized raw content. Wide terminals split stream and Lens while 80-column and
narrow terminals stack the same information. End returns to the `LATEST` edge
and `l` reloads it. `f`, or its clickable footer keycap, cycles
All, Attention (warning plus error), and Errors views locally over that loaded
snapshot. Filtering retains the source line numbers and resets navigation to
the latest matching entry. When an event is focused, `y` and the complete
clickable `Copy event` shelf segment send its already redacted, terminal-safe
raw projection through an explicit OSC 52 clipboard request. The request is
capped at 24 KiB, never reads clipboard contents, and reports that it was sent
rather than claiming the terminal accepted it; terminal policy may disable OSC
52. Empty and filtered-empty lenses expose no Copy segment. Runtime events may
still contain private product or trading context, so the action is always
explicit. Unloaded, loaded-but-quiet, and filtered-empty snapshots share a
compact Runtime Lens. Its `STANDBY`, `QUIET`, or `CLEAR` state names the exact
condition alongside snapshot/lens and bounded/redacted context. The final
whole-segment `l` or `f` action is pointer-capable and emits the same existing
key as the footer; it performs no extra read and does not change the Logs
command contract. This is navigation
over a redacted snapshot, not an unbounded file follower. Follow, pause, and
component filtering remain later work and must reuse this bounded reader.
When the stream exceeds its responsive window, its final content column renders
a proportional `│` track and `█` thumb that follows the same selected window.
Hovering that Rail Navigator marks the exact track row with `◆` and previews
the proportional event. Left press jumps to that real event and begins a
rail-owned left-button drag; motion scrubs the bounded snapshot until release.
It never reloads Logs or invokes the selected event as an action.
At 100 columns and wider, a known terminal height turns Logs into an Operational
Canvas: the compact ten-event baseline expands only as far as the loaded,
filtered snapshot and available viewport permit. The Event stream, Lens height,
scroll rail, and pointer rows consume that same final window. A zero-event lens
has no evidence to expand, so it never inherits canvas height: its four-line
panel stays next to the Observatory and leaves honest breathing room above the
grounded action rails. Constrained and narrower terminals retain the same
compact layout.

## Doctor

`openalice doctor` is read-only. It performs no install, update discovery
network request, takeover, restart, configuration write, credential read, or
broker action. It checks:

- CLI product version, install source, and installed content identity;
- the execution engine: embedded Bun for a native CLI, or the Node.js minimum
  for a source-backed CLI;
- Guardian ownership, control compatibility, and lifecycle state;
- the advertised loopback Web endpoint with a bounded auth-status probe;
- Alice, UTA, and Connector state;
- source-provider version and required built artifacts, or advertised bundle
  content identity;
- recorded cached update metadata and its reported channel;
- safe Runtime log discovery.

Human output uses explicit PASS/WARN/FAIL rows. JSON uses the same versioned
root envelope as lifecycle commands. A completed Doctor run exits `1` when it
contains failures, `0` for healthy or warning-only results, and `2` for invalid
syntax.

The TUI presents that unchanged report as a selectable checklist plus an
Inspector for the selected check. Initial focus goes to the first failure, then
the first warning, then the first check. Up/Down wraps selection; Page Up/Page
Down and the mouse wheel move within the list bounds; Home/End select the first
or last check. Pointer hover highlights a complete row and click selects it.
At 100 columns and wider the checklist and Inspector render side by side;
narrower terminals stack the same complete regions. The Inspector separates the
check summary, existing Doctor evidence, and conservative status guidance. It
does not run a repair, invent a command, or issue another diagnostic request;
`d` remains the explicit read-only rerun action.
Before a report exists, the same page renders a responsive Diagnostic Radar
instead of a loose instruction line. `DOCTOR STANDBY` names the unrun state and
keeps read-only mode, inspection scope, and the zero-write guarantee visible.
A completed report with no checks uses the distinct `NO CHECKS` state rather
than claiming health. Both states expose a pointer-capable `d` action segment
that emits the existing Doctor key; neither performs a repair or introduces a
second diagnostic path.
An overflowing checklist uses the same proportional `│`/`█` rail as Event Lens
and Fleet. Hover marks a proportional check with `◆` and previews it; left
press selects that real check and begins a rail-owned left-button drag until
release. This Rail Navigator changes inspection selection only and never runs
Doctor or performs a repair.
At 100 columns and wider, a known terminal height applies the same Operational
Canvas rule independently to Doctor: the ten-check baseline may expand to show
more real checks, while the Inspector pads only to keep the two owning frames
aligned. `DOCTOR STANDBY` and `NO CHECKS` contain their surplus quiet region
inside the Radar frame and keep the existing `d` action on its lower edge.
No additional check, evidence, repair affordance, or write path is synthesized.

## Shell Completion

Completion is generated from the root command registry:

```bash
openalice completion bash
openalice completion zsh
openalice completion fish
openalice completion powershell
```

The command prints to stdout and never edits shell configuration. The root
commands and lifecycle option names share the same registry used by generated
completion; detailed shell installation remains user-owned.

## Load-bearing Files

- `packages/cli/bin/openalice.ts` and `packages/cli/src/main.ts` — TypeScript
  application entry and default-TUI/explicit-command dispatch.
- `packages/cli/src/launch-context.ts` — immutable launch precedence,
  provenance, AliceProject roots, and managed-Pi environment projection.
- `packages/cli/src/supervisor-config.ts` — versioned machine/AliceProject
  configuration parsing, atomic persistence, and stored-context resolution.
- `packages/cli/src/machine-registry.ts` — explicit SSH Machine registry,
  validation, additive-field preservation, and atomic private writes.
- `packages/cli/src/machine-inventory.ts` — secret-free local/remote aggregate
  AliceProject and Runtime inventory plus reachability classification.
- `packages/cli/src/machine-command.ts` — `machine` parsing, confirmation, and
  human/JSON presentation.
- `packages/cli/src/managed-source.ts` — local managed checkout identity,
  validation, collision safety, and atomic preparation.
- `packages/cli/src/supervisor-tui.ts` — `pi-tui` Supervisor application shell.
- `packages/cli/src/pi-tui-loader.ts` — workspace and installed managed-Pi TUI
  resolution.
- `packages/cli/bin/openalice.mjs` — transitional presenter for existing
  non-interactive commands while their source moves to TypeScript.
- `packages/cli/src/lifecycle.mjs` — presentation-neutral lifecycle.
- `packages/cli/src/lifecycle-command.mjs` — canonical command parsing and
  presentation.
- `packages/cli/src/logs.mjs` — bounded log discovery, tailing, control-byte
  escaping, and credential redaction.
- `packages/cli/src/doctor.mjs` — read-only structured diagnostic checks.
- `packages/cli/src/observability-command.mjs` — logs/Doctor parsing and
  human/JSON presentation.
- `packages/cli/src/server.mjs` — legacy `server` presenter.
- `packages/cli/src/server-control.mjs` — local control client and normalized
  status.
- `scripts/guardian/control-server.mjs` — Guardian control server.
- `packages/guardian-runtime/src/{control-server,runtime-status}.ts` — shared
  local discovery transport and status envelope for Guardian owners.
- `scripts/guardian/prod.mjs` — built Runtime owner/status source.
- `packages/cli/src/lifecycle{,-command}.spec.mjs` — lifecycle and presentation
  contracts.
- `packages/cli/src/server{,-control}.spec.mjs` — compatibility and control
  contracts.

## Verification

Run the repository's TypeScript CLI entry directly when developing or
dogfooding the Supervisor. Bare `pnpm cli` opens the real interactive TUI; any
following arguments are passed through to the same command surface:

```bash
pnpm cli
pnpm cli status --json
pnpm cli doctor
pnpm test:cli
```

This source entry does not install or copy a CLI payload. When `pnpm dev`
already owns the selected home, the TUI and read-only commands discover that
live Runtime rather than starting or replacing another owner.

For command-only changes:

```bash
pnpm -F @traderalice/openalice-cli test
npx tsc --noEmit
pnpm test
```

Config-recovery and in-TUI update work must keep the focused Supervisor config
and TUI specs green: parser preservation, distinct newer-schema errors, recovery
action gating, and confirmed update install dispatch.

For launcher ownership, takeover, or existing-owner browser handoff:

```bash
pnpm test:guardian-recovery
pnpm electron:smoke:existing-owner
```

For a distributed payload change:

```bash
pnpm test:install:docker
```

Manually use an isolated home and unused port to walk:

```bash
openalice up --home <temporary-home> --port <unused-port>
openalice status --home <temporary-home>
openalice status --home <temporary-home> --json
openalice open --home <temporary-home>
openalice down --home <temporary-home>
```

Verify the real `/api/auth/status` and root page after `up`, prove the Runtime
survives the starting shell, and prove `down` leaves no Guardian/Alice child.
When shared Runtime or dependency topology changes, add the matching Electron
PTY/package smoke even though this CLI does not own Electron.
