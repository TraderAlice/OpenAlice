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
`OPENALICE_TUI_MOUSE=0` keeps the full keyboard surface while disabling terminal
mouse reporting, and `OPENALICE_TUI_MOTION=0` replaces purposeful activity
animation with a stable glyph without changing its text or layout. Its ordinary
path is intentionally parameter-free:

- the default Overview page is an AliceProject Launchpad rather than a status
  report. Its hero presents the selected project, a semantic launch/live/
  attention intent strip, human guidance, and a full-row primary action.
  Pointer hover focuses that action anywhere across the row, and click routes
  through the same Enter lifecycle/refusal state machine as the keycap. The
  Launchpad is the sole primary-action surface on Overview: Enter starts and
  opens a stopped Runtime, opens a verified Web endpoint, or runs Runtime
  Doctor when neither action is truthfully available. Its
  Runtime Signal card keeps Home, Web endpoint, owner, provider identity,
  services, and uptime available without returning to the historical flat
  field dump. Overview promotes only fields with a truthful existing action:
  `⌂` AliceProject opens the Switchboard, `↗` Web opens an advertised verified
  endpoint, and `⑂` Provider opens Source while the Runtime is stopped. Hover
  changes the marker to `›`, highlights the complete responsive field, and
  previews its consequence in the fixed activity slot; click emits the same
  `i`, `o`, or `c` input as keyboard use. Owner, services, uptime, and unavailable
  Web/source states remain passive telemetry. From 72 through 99 columns it
  becomes a Signal Deck: the existing
  card composes a terminal-native `ALICE` mark and truthful Runtime state beside
  the complete telemetry without consuming another row. At 100 columns and
  wider the Launchpad and Runtime Signal become a two-column cockpit. The
  action-first Launchpad integrates the terminal-native `ALICE` mark beside its
  complete wrapped guidance instead of repeating AliceProject identity and
  Runtime state in a standalone hero card. Runtime telemetry remains an
  independent right-hand pane, while the bounded entrance/prism sweep styles
  the integrated mark. `NO_COLOR` keeps the wordmark and state legible, and
  terminals below 72 columns omit it entirely. Those narrow terminals fold the
  operational fields into the complete vertical flow instead of hiding them.
  The application divider follows the full terminal width, and an
  available-update notice is composed inside the responsive header instead of
  being appended beyond its clipping boundary;
- the Fleet page renders `Machine → AliceProject`: ordinary terminals use two
  bordered panes with a stable Selection inspector, while narrow terminals
  drill down from Machines to Projects;
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
- the top-level chrome is a three-row Mission Header: a framed brand/release
  masthead, the Overview/Fleet/Logs/Doctor/Help navigation, and a closing rail.
  It replaces the disconnected legacy title/divider/tab stack without taking
  another terminal row. The navigation accepts Tab, left/right, and `[`/`]`;
  its visible tabs are composed as a full-width segmented rail with a
  stable glyph, label, and optional status badge. Color terminals render the
  rail, selected chip, and hover chip as distinct surfaces; `NO_COLOR` keeps
  the selected label in brackets. Wide labels collapse through compact and
  minimal variants so all five destinations remain reachable at 46 columns.
  The renderer publishes the exact final segment geometry used for pointer
  hover and click, rather than reconstructing hit regions from labels. A View
  Beacon on the Mission Header's closing rail anchors the active destination;
  with motion enabled it travels between the old and new tab, while reduced
  motion places it immediately without changing the final frame.
  `↑`/`↓` move within the active Fleet pane and the mouse wheel moves the
  focused Fleet selection.
  Fleet and loaded Logs expose their available counts in the navigation rail;
  Doctor exposes `✓`, warning count, or failure count without relying on color.
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
  With only the local Machine, Fleet focus starts on its current AliceProject;
- the footer is a contextual Action Shelf, not a complete shortcut legend. It
  exposes a few relevant actions as chips on one full-width surface. On
  Overview these are supporting commands only because the Launchpad owns the
  sole primary action; other surfaces can expose their current primary action
  as a high-priority `◆` segment. Segments wrap atomically instead of clipping
  labels;
  `?` keeps the complete keyboard reference available without crowding every
  operational page. Each complete action segment derives a display-width-aware
  pointer target from the final responsive layout, so hover and click survive
  reflow and invoke the same input state machine as the corresponding key.
  Hover changes the leading `◆`/`·` or divider to `›`, preserving a visible
  focus signal even under `NO_COLOR`. Confirmation and refusal semantics
  therefore do not have a separate mouse-only path. The same parser recognizes
  Action Shelves framed inside overlays and confirmation modals: their complete
  Enter/Esc labels share hover/click semantics with the application footer,
  while activation still emits only the existing keyboard input. When a wide
  layout composes adjacent framed cards, theme decoration classifies each card
  column independently at the rendered gutter; a primary action in one card
  must not color fields, borders, or whitespace in its neighbor;
- wide split-pane content follows the same containment contract. Selection,
  pointer hover, diagnostic severity, and launch-intent styling own only the
  inner content of the framed column that carries that semantic state. The
  gutter, borders, and semantically neutral neighboring pane remain unchanged;
  independent semantic rows in both panes may still style themselves. Single-
  pane and `NO_COLOR` output retain their existing plain-text structure;
- at 100 columns and wider, Overview's paired Launchpad and Runtime cards may
  absorb available terminal height as one bounded mission stage. They extend
  equally with quiet interior rows, keep the primary action and Uptime aligned
  against their lower edge, and stop at 17 total rows so taller terminals still
  retain breathing room before the grounded Control Console. Compact and
  stacked layouts keep their natural density; no other panel inherits this
  Overview-only height policy;
- a persistent full-width Command Spine closes the application with `╰─`/`─╯`
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
  same solid affordance. Unicode input is preserved, Backspace removes one code
  point, Ctrl+U clears,
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
- asynchronous work and its result occupy one fixed full-width activity slot
  above the command bar. When no operation or persisted feedback owns it,
  hovering a Navigation, Action Shelf, or Command Spine target projects its
  consequence there as a `PREVIEW`; moving away restores the idle
  `CONTROL CONSOLE` label.
  Feedback therefore never inserts rows or moves action/ribbon pointer targets.
  Working wins over Error, which wins over Notice/Ready/Status, which wins over
  Preview. Busy, informational, successful, actionable-warning, failed, and
  preview states retain distinct glyph and text labels without depending on
  color; only the busy glyph animates. The slot is a presentation of existing
  Supervisor and pointer state and does not introduce a second lifecycle or
  error path. The Activity Slot is the Console's stateful top border, each
  responsive Action Shelf row is framed body content, and the Command Spine is
  its closing border. This OMP-composer-style Control Console uses the same
  number of rows as the former loose stack. When the terminal is taller than
  the current page,
  a single elastic blank stage appears above that console so its controls remain
  anchored to the terminal edge; short terminals retain the natural complete
  flow without clipping. Resize changes only that elastic stage and does not
  reset selection, focus, or action state. When that stage has at least two
  spare rows, one contextual `Tip:` Beacon teaches a useful interaction for the
  active view or Runtime state while preserving a blank row after page content.
  It disappears rather than consume a required row, has no pointer target or
  action path, and remains identical text under `NO_COLOR`;
- color-capable motion-enabled sessions play one bounded brand-color sweep on
  entry across the OpenAlice header and any visible brand mark. The header then
  settles while a visible Overview `ALICE` mark continues a slow six-phase
  prism at 240ms per phase. The ambient mark pauses whenever a focused overlay,
  confirmation, or busy operation owns attention and resumes after it closes;
  `NO_COLOR` and reduced motion remain completely static. A successfully refreshed
  running Runtime alternates `●`/`◉` as a low-frequency heartbeat in Overview
  and Fleet; the adjacent `RUNNING`/`running` text never changes, and failed
  probes still surface through the diagnostic rail rather than animation;
- Help is a responsive Control Atlas rather than a prose screen or static
  shortcut wall. Ordinary terminals split Navigation, Runtime, and
  AliceProject groups from the selected group's explanation and executable
  keycaps; narrower terminals stack the same focus model. Arrow/Home/End keys,
  wheel movement, and whole-row pointer hover/click share one selection.
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
  Lifecycle, managed-source, and update confirmations are focused centered
  compositor modals over an unchanged application frame. Each modal separates
  the question from an explicit Impact section, exposes distinct Enter/Esc
  Action Shelf segments, and routes complete-segment pointer hover/click through
  the same confirmation state machine. Acceptance closes the modal before work appears in the fixed
  activity slot; cancellation changes no Runtime or configuration state.
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
  loopback tunnel and browser. Detaching aborts only those tunnel processes;
  it never stops the local or remote Runtime. `s` on a stopped compatible
  remote AliceProject re-probes inventory and registration, then starts it
  through the registered SSH Machine. Remote stop, restart, logs, Doctor,
  Setup, source, and other configuration mutations remain refused;

- Enter starts the persistent Runtime and opens the verified Web endpoint when
  stopped, or opens the endpoint when already running;
- `s` starts the persistent Runtime in the background without opening a
  browser;
- `o` opens an advertised, verified Web endpoint;
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
the latest matching entry. Unloaded, loaded-but-quiet, and filtered-empty
snapshots share a responsive Event Signal Scope instead of collapsing to a
one-line message. Its `STANDBY`, `QUIET`, or `LENS CLEAR` rail states the exact
condition, then exposes snapshot, lens, and bounded/redacted safety context.
The final whole-segment `l` or `f` action is pointer-capable and emits the same
existing key as the footer; it performs no extra read and does not change the
Logs command contract. This is navigation
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
scroll rail, and pointer rows consume that same final window. A Signal Scope has
no events to invent, so it instead keeps its truthful rail and facts at the top
and anchors the existing `l` or `f` action at the bottom of the owned frame.
A centered, non-interactive state-glyph echo gives that quiet region a visual
focus without claiming an event, count, progress value, or additional control.
Constrained and narrower terminals retain the compact layout.

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
