# UI Interaction and Motion

This guide owns OpenAlice interaction feedback: clickable affordances, motion
tokens, entrance/disclosure behavior, and reduced-motion policy. It complements
the component conventions in `ui/src/index.css` and the shared shell components
under `ui/src/components/`.

## Product Intent

OpenAlice presents working state, the next available action, and precise feedback.
Shared components own visual geometry, interaction states, and motion.

## Visual Language

The workbench follows the compact layout of the current Codex desktop app.
`ui/src/index.css` owns shared density and typography. `theme/palette.css` owns
colors, and `theme/style-profiles.css` owns selectable component appearance.
Product state and workflow contracts remain owned by their feature modules.

- The platform font stack uses Apple system fonts on macOS, Segoe UI on Windows,
  and locale-aware CJK fallbacks. Navigation, labels, menu choices, and desktop
  fields use 14px type with 20px leading. Reading content and touch fields retain
  16px. Page and dialog titles share the 18px heading role with 24px leading.
- `--oa-nav-height` owns 32px desktop navigation rows with 16px icons, an 8px
  label gap, and an 8px selected radius. Primary rails use 240px expanded,
  220px intermediate, and 64px compact widths. Native macOS chrome reserves
  an 88px compact rail. Harness children use a 24px desktop inset.
- `--oa-control-height` owns 36px desktop fields and standard buttons. Small
  buttons and menu choices use 32px. Page headers share a 44px band.
  `--oa-panel-inset` owns 16px card padding; `--page-inset` owns 24px desktop
  and 16px narrow-screen page padding. Touch targets retain a 44px minimum.
- `--oa-row-gap` owns the 4px separation between adjacent navigation and choice
  surfaces. Hierarchy boundaries keep their larger spacing. Focus rings remain
  inside navigation rows. Palette previews retain their own visual geometry.
- Hero metrics use 28px, card metrics use 20px, and secondary metrics use 16px.
  Launch headings use 24–28px. Prices, percentages, counts, and timestamps use
  tabular numerals; identifiers and commands retain monospace.
- `--action` owns filled controls and `--primary` owns links and text. Floating
  surfaces remain opaque. Information, success, errors, and attention retain
  dedicated semantic colors. Selection glyphs use neutral foreground ink.
  The Graphite palette keeps neutral gray canvas, sidebar, and card surfaces.
- Copy names the object, state, or operation. Extended guidance belongs in
  contextual help. Errors, consent, and recovery actions remain visible at their
  action boundary. Manager shortcuts show concise operation names and expose
  full editable prompts through pointer and keyboard guidance.

Overview owns language selection; existing language URLs and saved tabs open
Overview. `SettingsArea` keeps its navigator mounted across category changes,
preserving width, scroll position, and focus. Color mode leads appearance
settings; palette editing and interface styles use disclosures. Saved palette
identifiers remain stable. Runtime checks live in runtime detail panels.

The web demo notice keeps its identity and installation action in a fixed row.
Its recorded-data explanation lives in contextual help. Inbox rows show the
subject, timestamp, and unread count. Connection and runtime states pair an
icon with a localized label; mode chips remain separate.

News rows in `ui/src/pages/NewsPage.tsx` form a local-calendar-day timeline.
Time stays in the left gutter. The headline is a separate, prominent block above
the summary, which previews up to three lines. Editorial images align with the
headline on the right, with the source below; narrow screens place this image
and source beneath the text. Bordered market/topic labels and a compact
disclosure arrow follow the summary; expanding never hides the image. Flags
identify the supplied market classification, not a company's domicile or the
country mentioned in a headline. The local flag assets retain their license
under `ui/public/market/flags/`; unknown tags remain text. The current news
contract has no structured related-company identity or company-logo field.

The news scroller reveals already-fetched results in batches of 40 when its
bottom sentinel approaches the viewport. Appending keeps the reading position;
changing a filter resets the batch and scroll position. This is not server
pagination: the existing query limit and refresh cadence remain unchanged.

Market navigation keeps News first, followed by Markets (market overview and
an expandable watchlist), Analytics (movers, sector rotation, term structure),
and Macro boards. Section headings are static; only news categories and the
watchlist disclose child items. The watchlist uses the shared Collapsible
primitive and keeps pinned entries intact when closed.

The stable page hierarchy is:

1. global shell and activity rail;
2. page-owned navigator when the product area needs one;
3. one focused working view;
4. dialogs, drawers, and popovers for temporary decisions.

On macOS Electron, native traffic lights share a 44px row with the primary
navigation and page title. The desktop rail header replaces the wordmark with
native-control space; its compact width is 88px. Below 768px the mobile context
bar reserves that same left inset, and the navigation drawer reserves 44px at
the top. Header whitespace is draggable; controls remain interactive. The
preload's read-only `windowChrome.platform` selects this shell treatment.
Windows Electron uses native Window Controls Overlay in the same 44px header
band. `useWindowsChrome` measures the shared page, navigation, work-panel and
banner rows against the overlay's reported CSS-pixel rectangle; only rows
intersecting native controls reserve horizontal space. Geometry changes cover
resize, display scaling, maximization and fullscreen, without imitating native
caption buttons or Snap Layouts. Very narrow split toolbars move below the
caption band instead of overflowing into its controls. Loading and disconnected
screens retain a draggable caption region without mounting the authenticated
App. App palette/surface colors update the native
overlay through a validated color-only preload bridge. Edge drawers reserve
the caption band's height, and header controls remain non-draggable.
Browser and Linux retain their existing window chrome. Windows native visual
and Snap/high-DPI acceptance requires a Windows runtime; Mac geometry tests
and browser layout checks do not replace that gate.

The activity rail's utility items, groups, and visibility are user-arranged from
Settings → Activity bar and stored in `data/ui-layout.json`. The three Harnesses
are a fixed work section below those utilities; their visibility follows the
same saved entry settings. Deep links to a hidden surface still adopt.
The former Beta navigation group is flattened into the primary list, including
in the layout editor. Saved Beta items retain their order after primary items;
custom groups, hidden entries, and feature gates remain unchanged. Beta feature
availability is independent of navigation grouping.

Quick Start (`/quick-start`) is the default general landing shortcut. Its Harness
selector reuses Chat, Auto Quant, and Auto Prediction landing/setup flows and
keeps per-Harness drafts while switching. It owns no Workspace or Session history.
The saved primary `chat` layout slot now labels this shortcut; it remains pinned.
Chat (`/chat`) and all existing Harness deep links retain their own route identity.
Quick Start selection never marks a Harness current until navigation enters it.
Below the utility list, Chat,
Quant, and Prediction each show up to three sessions from their current Workspace
(retaining an active older row), a new-session landing shortcut, and the shared
Workspace options menu. More conversations remain available in the browser
dialog. These are feature rows with their own icons, not collapsible folders or
a labeled Harness tree. Recent sessions stay visible with a shallow indent. Session, Studio, and all-conversation entries share the same icon, label, and trailing-count columns. The all-conversation entry keeps the complete count visible and opens the existing browser.
Trailing actions place options first and new-session last. The header owns the
single new-session action; empty lists do not repeat a New chat/research row.
These actions appear on header hover, keyboard focus,
or while the menu is open; touch devices keep them visible. Clicking a primary
navigation Session row enters its working surface: running Sessions open directly,
paused resumable Sessions restore through the existing runtime action. A pending
restore shows a spinner and rejects repeated clicks; failures stay on the row
and allow retry. Headless occupancy still opens the single-writer explanation.
The primary row has no separate play/stop target; settings, stop and archive live
in its options menu. Archive stays available on a running interactive Session.
Confirming the dialog stops that Session, then files it in the archive. Headless
occupancy still blocks Archive because that turn is not pauseable from this menu. Direct links and history browsers use the same activation contract: an idle
Session opens its saved TUI/Web surface without a paused-session interstitial.
Activation checks the Session Directory for background occupancy before
requesting a runtime; the server remains the final concurrency authority.
Failures show the concrete cause and an explicit retry. Hidden Workspace tabs
do not auto-start, and losing/disconnecting an already-open interactive surface
does not automatically reclaim it. The former decorative terminal backdrop and
Resume CTA are removed.
In expanded navigation, a selected Session or Studio does not also select its
Harness header. The compact rail retains the Harness selection because Session rows
are hidden there; returning to the Harness landing selects its header.
Quant/Prediction retain their explicit default
Workspace readiness gates before exposing sessions and Studio. The navigation
distinguishes setup, existing-Workspace selection, loading, and
retryable errors. Without a Workspace, only the Harness header remains: clicking
it opens the existing setup landing flow, without creating or selecting a
Workspace. Do not repeat setup copy or a second setup button below it. Before
readiness, the new-research shortcut is hidden.
Studio is a quiet, borderless child navigation row aligned with Sessions, with
route-owned selection. Its arrow appears on hover or keyboard focus and remains
visible on touch devices; Quant and Prediction share its presentation.
`SidebarChildRow` and `SidebarChildRowButton` own Harness child geometry for
both Studio and Sessions: a 16px icon slot, 8px label gap, shared selection and
keyboard focus, and sibling action controls. Expanded fine-pointer desktop rows
are 32px tall with no additional per-destination vertical padding; other surfaces
retain the existing Session row density. Keep runtime behavior in the caller.
Harness working views use one content top bar, not a second conversation sidebar.
TerminalView has no card/canvas mode: its header always uses PageTopBar and its
single grid row fills the remaining height. Do not reserve a local header row
for portaled content; xterm's FitAddon measures the padding-free terminal host.
A compact rail keeps distinct Harness icons; mobile uses the same groups inside the global
drawer. Quick Start hands new Sessions to their existing Harness-owned routes,
not a second conversation hierarchy.
The Settings editor reorders live: the list opens a gap under the pointer
while the lifted row follows it. Sibling rows FLIP-animate into that slot.
`prefers-reduced-motion: reduce` skips the sibling motion; the overlay still
tracks the pointer.

Avoid duplicating these layers inside the focused view. A page navigator should
not be restyled as a stack of cards, and a detail surface should not create a
second page shell inside itself.

Launch-surface example prompts are compact capability navigation, not generic
chatbot filler. Their visible titles should stay scannable while the inserted
prompt carries the evidence, freshness, persistence, and permission boundaries
needed for the real task. Prefer a small rotating set over a wall of commands.

### Issue list

The global Issues list uses compact 44px rows and 36px status disclosure bars.
Its toolbar separates Active / Backlog / All issues from filter and display
popovers. Filters combine text, status, priority, Workspace, assignment policy,
and schedule presence; display preferences control grouping, ordering, completed
visibility, and six optional properties. Display preferences persist locally;
filters reset on remount. Shared Popover, DropdownMenu, Button, and Switch own
keyboard/focus behavior. The toolbar wraps and popovers scroll within short or
narrow viewports. Unsupported subscription and sub-issue options are omitted.
Priority, the stable Issue ID in a 64px truncated slot, status icon, and title occupy the leading edge;
Workspace display name and next scheduled time sit on the right. Execution
health is a small dot on the Assignee control, with localized status in its
accessible name and hover description; the popover shows the full health message. Long titles and IDs truncate without increasing row height. Execution
configuration remains in the Issue detail. Each row has an independent Assignee
button using the shared Popover primitive. Unassigned uses a dashed person avatar;
bound Sessions and human responsibility use solid neutral avatars. New-Session
policies use dashed plus/repeat avatars, with the exact responsibility in the
hover description and accessible description. Assignment confirmation updates
the avatar immediately from the server response. Its upper section reads the
authoritative Issue owner on demand, shows Session runtime parameters, and
opens that Session through the existing conversation activation path. The
lower section reuses `IssueAssigneeEditor`, also used by the detail inspector,
including its search, eligibility filtering, and confirmation dialog. Missing
owners cannot open a conversation; assignment policies explain Session creation. Health messages,
last-fire time, and full cadence remain available as hover descriptions.
Below 1024px the Workspace chip hides; below 640px IDs and schedule metadata
hide so the title and Assignee health indicator remain readable. Priority and status are independent shared-menu triggers with current-value
checks, keyboard navigation, and numeric selection. Writes apply the returned
Issue immediately so status changes move rows into the matching group; failures
keep the menu open with an error. The title opens detail through a sibling
button rather than nesting controls. Collapsed groups leave the tab order.

### Issue detail

Issue detail follows a reading-first layout: a compact Issues / ID breadcrumb,
a 28–32px title, flush editable Markdown, then Activity and operational Runs.
The desktop grid reserves 256px for a borderless property rail. Status and
priority reuse the board's labeled menu triggers; assignment reuses the shared
picker and avatar states. Properties, Agent, and Schedule are equal, visible
sections with consistent spacing. Agent contains assignment, runtime, AI model
selection and comment behavior as quiet property rows. Execution health is a
dot on the assignee avatar; its explanation and an available owner conversation
link live in the existing assignment dialog. Schedule exposes a clickable
cadence summary, next run and secondary run/history actions. Catch-up policy
stays in the schedule dialog. Running health suppresses a duplicate Run now action.
No nested rail scroll container competes with the page. Below 1024px the rail
stacks before the body with the existing section navigation. Editing, scheduling,
confirmation, and server-error semantics stay in their existing owners.

### Background execution surfaces

The bottom Your Alice application menu uses the static Alice portrait and a
text label when expanded, or only the portrait when compact. The brand header
keeps the OpenAlice wordmark without a second portrait. Its trailing ellipsis
appears on hover, keyboard focus, or while open; touch keeps it visible. The
trigger highlights for interaction, not because a Settings or Connectors page
is active. Settings remains an item inside this application menu.
Project Workspace preparation failures reuse its blue indicator and the Settings
Overview breadcrumb. Loading and normal preparation never raise a banner or an
error badge. Overview names the failing Harness preparation, shows its concrete
cause, and offers the existing project-setup retry, including before a Workspace
ID exists. Preparation has its own count rather than claiming an available
update. One project-scoped setup provider shares polling and retries across
Settings and Harness entry points; successful reads clear transport errors and
successful preparation refreshes Workspace inventory and default selections.
Settings and Developer use the same page-owned secondary navigator as Inbox
and Market from 768px upward. At 768–959px, entering Settings temporarily
collapses the activity rail so the category navigator and content fit together;
manual expansion is allowed and leaving Settings restores the user's saved rail
preference. Below 768px, the category navigator remains a drawer.

Connectors is accessed from the bottom Your Alice menu, alongside Settings and
above Appearance, not from the primary activity list or its layout editor.
The existing Connectors route and setup flows remain unchanged. Connector
health warnings appear on the Your Alice trigger and the Connectors menu item.

The Automation activity entry and its dedicated navigator are retired. Runs
and API remain unchanged under Settings → Developer, at
`/settings/developer/runs` and `/settings/developer/api`. Old Automation links
and saved tabs use this Settings destination; saved activity layouts cannot
restore the retired entry. Developer expands for either page and uses the
existing Settings scroll and mobile navigation behavior. This is an entry-point
move, not a change to scheduling, run ownership, or an additional Issues view.

### Current Workspace details

The global Workspaces activity, overview, template catalog, and management
navigator are retired. Saved layout entries cannot restore them. Old inventory
links return to Ask Alice; legacy Session/file links resolve the Workspace's
actual Harness and preserve their target identity without mounting a global
Workspace interface. Missing or unsupported membership is an explicit recovery
state, not permission to guess a Harness from a tag or show the old manager.

The Harness options menu identity opens the current Workspace's details in the same
Harness shell (`/<harness>/workspaces/:wsId/details`); the adjacent chevron is an
independent Workspace switcher. Keep configuration and conversation browsing
as separate actions below it. Do not make the identity click switch Workspaces,
open agent configuration, or navigate to the global Workspace catalog.

Details distinguish the Workspace-owned README and recorded applied/source
versions from the current catalog's Harness guide. Catalog documentation is
reference material, not proof of the installed version or current Workspace
configuration. Keep document loading/errors independent, retain the sessions
sidebar, and use the shared reading renderer rather than a new Markdown stack.

### Agent conversation presentation

`components/conversation/` owns the adapter-neutral browser conversation view,
content/activity rendering and `ChatComposer` input/actions. `AgentChatComposer`
composes that primitive with the shared provider/model/effort selector for both
Start and GUI. Start retains runtime/surface selection in its composer context
tray. In an existing GUI Session, the fixed runtime icon/name lives in the top
bar beside the TUI action; narrow screens show the icon with its accessible
name and tooltip. The GUI composer has no runtime tray. One compact
button shows the provider icon, model and effort, with submenus for each choice.
The AI Provider submenu and native account option use the matching provider or
runtime icon; the full provider name remains available in the button tooltip.
Narrow layouts truncate this summary without wrapping it onto multiple rows.
The Start composer follows sidebar Workspace selection and has no Workspace picker. Existing `oa-harness-composer-*` styling seams
remain the shared visual material. Messages and composer use a 46rem reading
measure, with local scrolling for wide output and wrapping toolbar controls.
User messages use a quiet, borderless bubble; assistant prose sits directly on
the canvas. Execution summaries are lightweight disclosure rows, with an inset
rail for individual actions rather than nested activity cards. Preserve the
shared Markdown table scroll wrapper instead of overriding table display.
Completed text has a copy action that copies only the displayed message, not
reasoning or tool payloads. Older actions reveal on hover or keyboard focus;
the latest message and touch surfaces keep them visible. Clipboard failures
are actionable, and interrupted tools must say incomplete rather than completed.

The normalized types in this folder are ephemeral presentation data, not a new
persisted transcript or execution protocol. An adapter converts wire messages
before rendering and supplies only supported send/stop actions. Missing actions
do not produce fake controls. Reasoning, tool input/output, failed operations,
and unknown payloads remain inspectable; failures expand their activity details.
Presentation must not import runtime APIs, parse provider event discriminators,
or fetch Workspace data. The backend already projects every runtime wire (Pi
RPC, ACP, Claude stream-json, Codex app-server) into one neutral message list;
`web-presentation.ts` converts that list, `useWebConversation` owns
polling/commands, and `WebSessionView` composes the adapter for any runtime
whose `capabilities.web` is declared. Runtime identity is a presentation fact
(placeholder, stop label, wire tooltip), never a branch on the protocol.

Runtime requests (tool permissions, file-change approvals, questions) render in
`ConversationRequestCard`, pinned above the composer in the `status` slot
rather than inline in the transcript, so the pending decision cannot scroll
away while it is the only way forward. Options come verbatim from the runtime
and answer with one option id; `allow`/`deny`/`neutral` tones map to the shared
button variants. While a request is pending the phase is `awaiting-input`: the
composer stays in stop mode, the card is the primary action, and further
requests are counted rather than stacked. Answer failures keep the card and
surface the error inline. `notice` items are neutral system remarks between
turns (stopped turn, mode change), not assistant prose.

Launch affordances (Resume CTA "Open in Web", the Workspace header surface
toggle, Manager Quick Start) gate on `agentSupportsWeb(agents, agent)`; a
runtime without a structured protocol keeps its terminal without a dead button,
and an unloaded runtime list hides the affordance rather than guessing.

Pending sends keep and lock their draft until acknowledgement, reject repeated
submission, and preserve the draft on failure. Enter respects IME composition;
Shift+Enter inserts a newline. Session identity changes remount local composition
state and ignore prior requests. New revisions follow the tail only while the
reader is already there; Jump to latest is explicit and honors reduced motion.
Idle needs no top-bar badge; busy and failure states remain visible. GUI Sessions
use the shared composer for capability-supported AI access, model, and effort
controls. Changes persist through idle Session reconfiguration; busy/pending
sends lock configuration, and an unsaved or failed change blocks sending until
saved or retried. Unsupported controls stay hidden rather than implying an
adapter can apply them.

### Long-form Markdown

`MarkdownContent` owns one parser and interaction contract with two deliberate
presentation densities. The default variant stays compact for chat, comments,
runtime output, and small previews. Durable reports and Issue documents use the
`reading` variant: a restrained reading measure, stronger heading hierarchy,
more paragraph rhythm, and document-owned horizontal scrolling for wide tables.

Route Markdown files through `FileContentView` so Tracked artifacts, Inbox
attachments, and Workspace file views retain the same reading treatment. Do not
fork Markdown parsing or recreate feature-local heading, list, table, quote, and
code styles. Long documents remain the dominant page surface rather than being
wrapped in a decorative card; surrounding shell chrome supplies the context.

Treat the generated Markdown body as a stable DOM island. Live Workspace,
Manager, Inbox, and provenance state may update the surrounding interaction
layer, but an unchanged HTML string must preserve the existing report nodes so
selection, browser translation, find-in-page, and extension annotations remain
intact. Polling stores must reconcile identical JSON snapshots before
publication, and content renderers that only need a Workspace action should use
the action-only hook instead of subscribing to the complete Workspace state.

### Responsive Behavior

Narrow layouts are a change in information hierarchy, not a compressed desktop.
Keep the primary identity, state, value, and next action visible. Move secondary
metadata into disclosure rows, detail views, or drawers.

Long, task-oriented dialogs may use the complete phone work area while remaining
centered cards at wider breakpoints. Keep their identity and primary actions in
fixed header/footer regions, make the content body the only vertical scroll
owner, and carry `min-height: 0` through every intervening flex child. Compact
confirmations should remain dialogs rather than expanding into full-screen
forms. When a dialog has multiple navigation levels, keep each mobile level to
one touch-sized row and let secondary choices scroll horizontally instead of
stacking enough chrome to hide the form.

Do not make a desktop comparison table fit a phone by shrinking its type or
requiring routine horizontal scrolling. Preserve the dense table at widths
where comparison is useful and provide a scan-first representation below that
breakpoint.

Hidden surfaces must also be absent from keyboard and assistive-technology
navigation. Drawers and collapsed panels should use the shared `aria-hidden`
and `inert` contract while they are not interactive.

### Interaction States

Every interactive element needs an explicit resting, hover, pressed,
focus-visible, disabled, and loading state where applicable. Do not hide required
information behind hover. Loading and failure feedback should stay local to the
surface that owns the request and provide a retry when the user can recover.

Prefer native controls and disclosure semantics. Menus, popovers, and custom
selects must support keyboard dismissal, predictable focus movement, and focus
return to their trigger.

Use motion for four jobs:

1. **Affordance** — buttons and clickable rows visibly respond to hover/press.
2. **Continuity** — a newly focused view or expanded hierarchy arrives from the
   direction implied by the interaction.
3. **State change** — health/setup surfaces blend between states instead of
   flashing to unrelated colors.
4. **Activity** — looping motion is reserved for genuine loading, live data, or
   work in progress.

Do not animate merely to decorate empty space. Avoid long transitions on dense
tables, competing loops, scroll hijacking, and transforms that move controls
away from the pointer.

## Shared Vocabulary

### Component primitive ownership

`ui/src/theme/motion.css` owns 110ms direct feedback, 160ms state changes, and
250ms larger transitions. Popup and button transitions target CSS `scale`;
drawers target `translate`. Keyboard-focused controls update immediately.
Frequent page navigation preserves the shell and updates content immediately.

| Owner | Contract |
|---|---|
| `SelectionCheckIcon` | Fixed 16px neutral selection glyph; selected state stays on the owning control. |
| `CountBadge` | Reminder and item counts from existing state owners, with full count and meaning in the accessible name. |
| `ContextHelp` | Shared Popover with selectable guidance, 250ms hover delay, 100ms departure grace, and click and keyboard activation. `ConfigSection.help` and `PageHeader.help` reuse it. |
| `SegmentedControl` | Base UI ToggleGroup single selection and roving focus. Arrow keys move focus; Enter and Space select. Repeated activation retains selection. |
| `Collapsible` | Base UI measurement and mounted exit lifetime, shared height and opacity timing, immediate keyboard and reduced-motion updates. |
| `CollapsibleDetailsTrigger`, `DetailsSummary` | Shared disclosure row with a trailing 16px chevron and 44px target. The 8px surface inset extends beyond the content edge, keeping labels aligned in every state. Native details keep HTML disclosure behavior. |
| `ui/select.tsx` | Predefined string-valued fields with native form participation. Empty-string options retain their labels; numeric conversion belongs to the form. |
| `ui/autocomplete.tsx` | Free-entry suggestions with shared input callbacks, keyboard navigation, dismissal, focus, and portal positioning. Selection retains explicit form submission. |
| `ui/choice-styles.ts` | Popup and option geometry shared by fields, suggestions, and action menus. |
| `Checkbox` | Native form semantics, a 44px target, and the shared selection glyph. |
| `Toggle` | Shared switch feedback; pending persistence retains focus and exposes a read-only control. |
| `StatusIndicator` | Loading, completion, and failure feedback used by `StateViews` and `SaveIndicator`. |
| `LoadingImage` | Decoding and stable-size reveal for `ConversationImagePreview`, with an explicit retry after failure. |

Choice popups use a neutral border, 6px inner padding, 10px option insets, and a
fixed 16px trailing check or submenu rail. Form popups follow the anchor width;
compact suggestions use content width with a 32rem limit. Action menus use a
224px minimum and 448px maximum. Every popup keeps 16px viewport clearance and
owns its scrolling. Submenus account for the parent's inset in their anchor
offset; Base UI resolves viewport collisions. Long option labels wrap, and
single-line triggers expose their complete selected label.

Inference menus share a four-column row: a 20px icon, label, wrapping value,
and 16px chevron. The trigger shows manufacturer identity and model name.
Effort remains in its dedicated menu. Model lists scroll inside their fixed
header and footer. Workspace switching has a full labeled row.

Buttons and segmented options use a short 97% press scale with stationary
keyboard feedback. Switch thumbs stretch toward their destination on a pointer
press. Reduced motion retains focus and semantic state with immediate updates.
Tooltips use 14px text, a 250ms initial delay, immediate transfer within the
provider window, and a 110ms exit.

Tool search opens matching groups, retains disclosure control, and reports the
matching count. Each group owns one continuous rounded surface; its header and
rows share the label inset and trailing switch rail. Separators remain inside
the surface. Long identifiers wrap at camel-case and delimiter boundaries.
Sibling groups retain an 8px gap. Narrow search toolbars reserve a save-status
row, and `SaveIndicator` retains its idle slot. Failed settings writes expose a
recoverable error beside the control. Trading mode descriptions remain visible.

Landing suggestions retain layout space as the draft changes, keeping the
heading and composer anchored. Keyboard input updates immediately. Market
shortcuts reuse one shared component.

Behavioral UI primitives live as source under `ui/src/components/ui/`. They are
initialized from shadcn's Base UI recipes through `ui/components.json`, then
owned and reviewed as OpenAlice code. Product components such as
`PageSidebarLayout`, `ConfirmDialog`, and the UTA `Dialog` wrapper retain their
domain API and composition; the lower layer owns portals, focus containment,
keyboard navigation, outside dismissal, scroll locking, and focus return.

- Use an existing owned primitive before adding document-level listeners or a
  new focus trap for a dialog, sheet, popover, menu, or tooltip.
- Keep the shared primitives aligned with the official `base-nova` registry
  output. Base UI owns modal and nested-overlay coordination; do not add an
  OpenAlice portal-boundary context or manually move descendant overlays into
  Dialog, AlertDialog, or Sheet content.
- Keep generated primitives bound to semantic tokens. Running the shadcn CLI
  must not replace `ui/src/index.css`, palette definitions, typography, or the
  current default visual hierarchy.
- Prefer the official Base UI package required by the checked-in primitives.
  Do not add a second primitive base, third-party registry, or generic shadcn
  block when a product composition already exists.
- Treat `data-slot` as the stable styling seam. Future selectable UI styles
  may vary geometry, elevation, density, typography, and motion through that
  seam; `data-palette` remains the color axis.
- Selection indicators use the shared `SelectionCheckIcon`. The primitive owns
  fixed optical geometry and neutral foreground ink. Menu callers supply the
  selected state and retain no visual override surface.
- Runtime-selectable component appearance is published as `data-ui-style` on
  the document root. Profiles may restyle owned `data-slot` primitives and
  shared `oa-*` shell/form seams, but must not branch product behavior, fork a
  primitive, hard-code a second color system, or recolor terminal ANSI output.
  Keep the current workstation as the compatibility default and gate compact
  desktop density behind both sufficient width and a fine pointer so a visual
  profile never reduces touch usability.
- A style profile may declare an optional recommended day/night palette pair.
  Selecting the style must never apply that pair automatically. Settings shows
  an explicit preview and opt-in; the resulting style-scoped override must not
  rewrite the saved Day/Night colors, and leaving that style restores them.
- Repeated navigation rows remain rows under every style profile. A profile may
  restyle the row and its compact trailing actions, but must not give the row's
  primary label its own card or command-button chrome.
- Delete superseded event plumbing during migration. A component is not
  migrated if its old global Escape/outside-click/focus-loop implementation is
  still running beside the primitive.
- The app has one global navigation rail. When expanded, its desktop collapse
  control sits to the right of the OpenAlice brand. When compact, the expand
  control moves to the leading edge of the right-hand area's top bar. Only one
  copy is mounted; activation transfers keyboard focus to the new location.
  Responsive compact mode is a default, never a lock. Entering Chat, Quant, or
  Prediction no longer auto-collapses the rail: it owns their session lists.
  Explicit expanded/collapsed preferences apply across all product areas.
- `TopBar` owns compact header geometry (44px desktop, at least 48px on phone).
  `PageContentLayout` owns a fixed header slot; `PageTopBar` portals a page's
  title and actions into it without copying business state or callbacks.
  `PageHeader` adds description/live metadata below this bar. Keep large
  onboarding prompts in the content rather than enlarging the global chrome.
  Pages with dense actions wrap them and keep contextual metadata out of the
  primary action row. Preserve full-title hints when labels truncate.
- `PrimaryNavigationContext` supplies the expand control only while compact. A desktop
  `PageSidebarLayout` consumes it in the navigator's top bar and masks it from
  the content header. Without a static navigator, the content header consumes
  it. There must be exactly one visible desktop primary-navigation toggle.
  Phone navigation remains in `MobileContextBar`; feature drawers keep their
  own labeled controls and shared Sheet focus/dismissal behavior.
- A secondary navigator belongs to the feature's content layout, not to a
  second global navigation layer. `PageSidebarLayout` keeps desktop resizing
  but offers no generic collapse/restore, collapsed strip, or overdrag gesture.
  Old saved secondary-collapse preferences are ignored; width preferences stay
  intact. This does not prohibit a feature from owning collapsible internal
  panels or a narrow-screen drawer where its workflow needs them.
- Shared split layouts use the checked-in shadcn Resizable primitive for
  separator geometry, pointer/touch capture, and keyboard resizing. Do not add
  a second visible border or parallel document-level drag listeners.
  Derive feasible min/max constraints from the measured split group, not the
  window. When there is not enough room for preferred minimums, preserve the
  navigator's 200px minimum and give content the measured remainder.
  Capture intent at the group boundary so enlarged fine/coarse targets behave
  like the visible separator, including an out-of-bounds pointer release.
  Persist settled user widths, not temporary responsive caps; keyboard widths
  come from the settled layout map rather than a pre-paint DOM measurement.
  Keep Panel registration defaults stable during a gesture.
  Because pixel constraint changes can re-register v4 Panels after a settled
  callback, validate both the layout and painted navigator/content flex items.
  Repair impossible `100%`/`0%` geometry with one coherent group snapshot from
  the last valid preference; an already-satisfied internal resize is not
  recovery.

The `@/` alias resolves to `ui/src` in Vite, TypeScript, and the UI Vitest
project. Backend tests keep their existing root `@` alias.

Motion tokens live in `ui/src/theme/motion.css`; shared class rules live in
`ui/src/index.css`:

| Primitive | Intended use |
|---|---|
| `--motion-fast` | direct press/icon feedback |
| `--motion-standard` | page, disclosure, hover, and most state transitions |
| `--motion-slow` | dialogs and visually larger state changes |
| `.oa-pressable` | primary or bordered controls with tonal hover and compact press feedback |
| `.oa-icon-action` | compact icon/add/collapse controls |
| `.oa-nav-item` / `.oa-nav-row` | rail and secondary-sidebar navigation |
| `.oa-view-enter` | focused route or state entrance, currently used by `AuthGate` |
| `.oa-dialog-*` | shared dialog surface and backdrop entrance |
| `.oa-disclosure-enter` | newly expanded hierarchical content |
| `.oa-popover-enter` | menus and compact floating choices |
| `.oa-status-surface` | smooth health/setup card state changes |

Prefer these primitives over copying arbitrary `duration-*`, easing curves, or
keyframes into individual pages. A local animation is justified when it conveys
domain-specific state that the shared vocabulary cannot express.

Keyboard focus uses the neutral `--oa-focus-ring` and `--oa-focus-shadow`
tokens. `oa-field-control` owns the shared input, textarea, and select border
transition. The same shadow token covers buttons, navigation rows, tabs,
segmented controls, switches, and resizable handles. Product accent color keeps
its selection and action meaning.

The application body establishes a 16px type size with 24px leading. Compact
controls use 14px type with 20px leading. Display, heading, caption, and data
roles use their shared tokens.

The compact activity rail keeps its static Alice mark in the bottom application
menu. Its expansion action
lives in the content-side top bar, not in a brand-hover affordance. Small
desktop windows still permit explicit expansion. The shell owns effective
rail state so its toggle and the rendered rail always agree.

Dense market panels use `oa-data-surface` for the shared border and canvas and
`oa-data-surface-header` for section hierarchy. Data components retain their
domain-owned layout and use the shared surfaces to align cards, charts, quote
summaries, and launch actions. Recharts tooltips set `isAnimationActive={false}`
at the component boundary, and the shared chart class owns their visual material.

### Chart and account lifecycle

`MeasuredChartFrame` retains its last positive size through hidden layouts and
ignores unchanged integer dimensions. K-line charts retain their instance and
visible range across palette changes. New symbol, source, interval, and
timeframe queries fit their first loaded data; periodic updates preserve the
chosen viewport. Price geometry and crosshair feedback update immediately.
Axes use 14px text, locale-aware dates, and the snapshot's native currency.
Recharts measures value-axis width. Sparkline gradient IDs remain stable across
empty and populated states.

Equity chart help occupies a permanent title-row slot. Account and range
controls remain mounted through loading, empty, and historical states. Account
selection owns its request sequence and chart loading state; portfolio summary
refresh has an independent lifecycle. Point inspection uses the current event
index and opens the latest stored snapshot at that time in a shared dialog.
Closing inspection preserves chart position and returns focus.

Account summaries and curves share card padding and stretch to their grid row.
Wallet selection remains inside the summary card. Pending reads retain the
card height and disable position-close actions. Derivatives wallets keep their
margin row across selections. Summary definition lists align labels and values;
financial tables keep values together within their own scroll region. FX detail
panels follow the main column until their container supports a side panel.
Broker support rows keep account, status, and recovery actions visible, with
installation scope and diagnostics in contextual help.

Settings version rows reserve identity, version, status, and action columns in
wide containers. Their disclosure controls reuse the shared geometry. Page
headings, configuration sections, and financial cards consume their owning
inset tokens, including bounded-width settings sections and embedded dialogs.

Clickable native and ARIA controls receive a pointer cursor globally. Disabled
controls keep the default cursor and must remain visually disabled. Hover-only
transforms are gated to fine pointers, so touch devices do not inherit a fake
hover state.

## Accessibility and Performance

Every shared entrance, loop, and transform honors
`prefers-reduced-motion: reduce`. Reduced motion removes animation and transform
movement while preserving color, focus, and state information.

Keep entrance distances small (roughly 4–8 px) and durations below 300 ms.
Animate `transform` and `opacity` for movement; use short color/border/box-shadow
transitions for feedback. Do not add permanent `will-change` to large lists or
page containers.

Navigation continuity is a component-lifetime concern before it is an animation
concern. Views that belong to one product area and share a local navigator must
declare the same `shell` in `ui/src/tabs/registry.tsx`; `TabHost` keeps that
shell mounted while replacing the active-only view content. Do not wrap every
drill-in in a fresh copy of the same shell or mask the resulting remount with a
transition. Session terminals and other heavy page content remain active-only
unless their own lifecycle explicitly requires otherwise.

Market's quotes, news, boards, rotation and instrument views share the
`market` shell. News contributes content only; its grouped categories live
inside MarketSidebar and use SidebarRow rather than feature-colored buttons.
Category and news-view selection use separate URL parameters, so selecting an
importance or sentiment view does not discard the current category. Existing
source-tag matching is unchanged by this navigation and theme integration.
News category/view selections are adopted into one news tab and projected back
to the URL, including on a fresh load. Changing a selection does not create
another tab. Narrow screens use the same news directory in the Market drawer.
News initially mounts forty stories and reveals more on demand. Selection
changes reset the visible batch; full story text remains expandable. Polling
waits for an outstanding request instead of repeatedly replacing a slow load,
while explicit refresh, query changes and unmount cancel superseded requests.

Market directory headings (News, Markets, Macro, Watchlist) are static captions.
Parent headings use the shared hierarchy variant with medium weight, and
each child navigation level adds a 12px inset. Clickable categories and leaf
rows share the 14px navigation role and foreground color; gray is reserved for
secondary summaries and chevrons. Only News category groups disclose children,
with trailing chevrons. Only destination rows receive page selection
styling; a collapsed category group shows the selected category as a plain
summary. Restoring a News selection reveals its group, while users can still
collapse it manually. Search results appear immediately below the search field.
The shared Base UI Collapsible owns keyboard/ARIA and measured panel lifetime;
its shared state transition updates immediately with reduced motion. Closing
panels become inert and aria-hidden immediately, including during animation.
The same directory and touch-sized controls serve the narrow-screen drawer.
No new persisted preference is added.

Keyboard focus is not a motion effect. Interactive controls still require a
clear `focus-visible` treatment, meaningful labels, and sensible tab order.

## UI Change Review

Every UI PR should answer these questions in its description or review:

1. What visual or interaction noise does this remove?
2. Which information hierarchy becomes clearer?
3. Is the next action more obvious?
4. What happens at narrow, medium, and wide widths?
5. Which existing tokens or shared primitives does it reuse?
6. Does it introduce a new visual dialect? If so, why is that necessary?

Judge improvements against the real route and realistic data. A polished empty
fixture does not prove that long names, errors, financial values, and dense
operational states remain usable.

## Verification

For motion changes:

1. exercise the real route with a mouse/trackpad and keyboard;
2. verify light and dark themes where elevation or shadows changed;
3. verify a narrow layout so transforms do not cause clipping;
4. enable reduced motion at the OS/browser level and confirm state remains
   legible without animation;
5. check that repeated navigation does not restart expensive background work or
   remount a surface that intentionally stays alive.

Motion should be judged in the running UI. A class name or screenshot alone
cannot prove timing, continuity, or pointer feedback.

Text wrapping and block height are owned by the semantic DOM. Development
checks run after `document.fonts.ready` and cover long Latin labels, CJK text,
mixed scripts, unbroken identifiers, narrow widths, and text-spacing overrides.
Measurements stay at the verification boundary. Platform-font product text
uses browser layout throughout.

```bash
pnpm -F @traderalice/connector-protocol build
pnpm --filter @traderalice/update-lifecycle... build
pnpm -F open-alice-ui exec tsc -b
CI=1 NODE_ENV=test pnpm test:owner:ui
pnpm -F open-alice-ui build:demo
```

Browser checks include persistence, repeated input, focus return, loading,
empty states, and failure recovery. Continuous feedback pauses offscreen and
in hidden pages. Static screenshots record layout and visible state; running
controls provide the timing and continuity evidence.

Web question cards keep the existing composer status placement. Text-capable
questions show a labeled shared Textarea and an explicit Send answer button;
offered options stay available above it. Secret questions use a masked field.
The layout stacks vertically at narrow widths and does not steal focus.
Permission cards remain option-only. A failed submission retains the draft,
while a new request ID mounts a fresh card so answers do not leak between
questions. This is owned by the shared ConversationRequestCard, not a
runtime-specific presenter.

## Harness work panel

The application remains primary navigation plus content. `ChatPageShell` owns
an internal `HarnessWorkbench` split for Chat, AutoQuant and Auto Prediction;
it is not an application-level third rail. The conversation is one pane and a
resizable tabbed work panel is the other. File browsing opens read-only file
tabs in this panel. Existing Studio routes open managed Studio beside the last
visited Session in that Workspace, or the new-conversation composer when none was visited.
The split spans one continuous top bar: conversation title on the left and
individually closable tabs on the right. There is no enclosing panel title bar.
The plus button follows the last tab until the tab strip fills the available
width; overflow scrolls inside the strip while add and collapse stay reachable.
The plus menu opens Files, Browser or Studio. Studio supplies its managed URL
and readiness state to the same BrowserPane used by ordinary browser tabs.
The address bar contains reload and separate-open controls; Studio restart and
logs live in its overflow menu. Web frames respect host embedding restrictions;
address history tracks submitted URLs, not cross-origin in-page navigation.

Workspace-keyed runtime view state retains open tabs, selected tab, width and
last Session. Mounted file/Studio tabs survive disclosure and Session changes;
closing a tab releases its view without stopping the managed Studio process.
Reload resets this transient view state. At phone viewport widths below 768px,
the panel replaces the conversation region while the shared header and explicit
collapse/return action remain available. At 768–1279px it stays beside the
conversation and opening it collapses the activity rail. These are viewport
media-query boundaries, not a 720px content-width container query. Base UI Tabs
and the shared resizable primitive own keyboard selection and splitter behavior.

Harness headers expose a single icon-only work-panel disclosure with a tooltip
and accessible expanded state. Workspace configuration stays in the existing
sidebar menu. Web/TUI switching is available from the panel menu. Disclosure
uses the shared 250ms ease-out curve for the resizable outer panels, with a
subtle content fade/translation. Pointer and keyboard resizing remain immediate;
reduced-motion mode disables the transitions. Content width is held during the
short disclosure to avoid repeatedly wrapping file and Studio content.

### Session header and tablet work panels

Running TUI Sessions expose GUI switching in their shared top bar whenever the
runtime supports the Web surface; GUI Sessions expose the reverse TUI action.
The Harness shell must not hide this action behind the work-panel menu.
At 768–1279px, opening the right work panel collapses the left activity rail
and keeps the conversation visible beside the panel. Only phone viewports
below 768px replace the conversation with the work panel.

Start keeps Suggested workflows in the shared Collapsible panel. Typing closes
its measured height and fades it; clearing the draft reverses the transition.
Closed content becomes inert and aria-hidden immediately. The shared reduced
motion rule removes the transition.

First submission renders the submitted user message on the same conversation
canvas with a live startup status while the request is pending. The composer
stays mounted, clears visually and locks until launch settles; a failed launch
restores the retained draft. GUI navigation carries one transient, identity-keyed
prompt preview into useWebConversation until its first authoritative snapshot.
It never persists or resends this preview. No artificial startup delay is added;
the short message entrance honors reduced motion. TUI launches share the pending
feedback, then hand over to the terminal normally.


### Background Session inspection

Each current-Workspace Harness navigation group has a collapsed `n running`
disclosure for background occupancy, below Studio (Chat: directly below its heading, before conversations).
The disclosure and its entries reuse the ordinary Session child-row primitives
for matching height, inset, icon spacing, and text size.
When a running headless execution reports a start time, its child row shows a
compact live elapsed time beside the title; unknown start times stay unlabeled.
On hover or keyboard focus, the timer fades to reveal the standard Session
overflow action, whose Details entry opens the shared inspection dialog.
This projection includes headless-born and Issue-attached Sessions independently
of ordinary conversation roster preferences, including hidden background workers;
retired identities are excluded. Idle interactive processes do not count. Occupied rows are excluded
from the recent interactive workset to avoid duplicate entries.

Selecting a background row opens the shared transient Session dialog without
changing the right-hand view, URL, or tab inventory. It shows task provenance,
timing, refresh errors and diagnostic identifiers. Completion removes the row
from the disclosure but leaves an open dialog available with an explicit Open
conversation action. Existing background deep links surrender their Session tab
and open the same dialog over the previous view (or Harness landing when no tab
remains). Inspection never starts or takes over a runtime.
The dialog leads with Session identity and current state, then elapsed time and
provenance; a moving line signals activity without claiming a completion
percentage. Metadata stays compact, diagnostic IDs stay behind a disclosure,
and refresh/interruption controls remain visible in the footer. The right-click
Details dialog uses the same identity, status and control hierarchy while its
history and configuration scroll within the body. On narrow screens, metadata
stacks and the status badge shortens so it does not displace the Session name.
Interrupting from either dialog first confirms the target Session, immediate
stop, retained conversation history, and configured restart cooldown.
The shared control footer enters an inline confirmation state rather than
opening a second dialog. Cancel or Escape returns focus to the interrupt action;
the execution stays untouched until the explicit confirmation.


Session row menus expose Details independently of activation and distinguish
Archive (file for later) from Delete (dismiss from normal conversation lists).
Delete uses the existing presence transition, stops an interactive runtime,
and removes saved terminal scrollback; it does not erase Workspace files,
retained provenance, or native CLI history. Background-owned rows do not expose
this destructive action. Details reads the exact Session identity, current
Issue assignments and execution history through one domain hook. Creation,
last start, last end and last activity remain separate fields; unknown values
and partial-fetch failures are explicit. Inspection does not launch a runtime.

### Session takeover requests

A single domain provider polls takeover requests across Workspaces. New requests
open the shared Dialog; the content topbar retains a small pending-count bubble
when the Dialog is dismissed. The Dialog separates origin, entry point, time,
server-derived idle countdown and the two explicit actions: keep using or hand
over. Its timing disclosure and Harness Settings edit the same global interval.
The countdown bar respects reduced motion; it is not a live-announced timer.
Narrow screens use the same scrollable Dialog, with wrapping action buttons.
Session-local keyboard, input, pointer and wheel interaction renew inactivity;
interactions with takeover controls themselves do not renew it.

Already-open GUI conversations retain their mounted transcript and draft while
handed over. A lightweight status strip names the background source; input is
read-only. Completion offers explicit return to conversation instead of an
automatic process restart. A cold background deep link keeps the existing busy
Dialog behavior. Demo `?takeover=preview` seeds an isolated, simulated request for
the AI-power conversation, including approval, idle timeout and completion.

## Compact activity notifications

The shared Sonner layer uses readable 352px pop-out cards, the shared UI font,
semantic popover colors, internal close controls, bounded previews and actions
below copy. News may include a 64×48 feed image, validated at the producer and
renderer; missing/failed media collapses without a placeholder. Article identity,
headline and image always update as one tuple. Old events remain text-only.

The display queue keeps three expanded cards; pending cards start their lifetime
only when admitted. An error preempts the lowest-priority non-error card, which
returns to the queue and receives its full lifetime when redisplayed. FIFO holds
within severity. News groups by source and Inbox by publishing Session/Workspace
for a fixed four-second arrival window; queued groups continue collecting until
admission. Repeated identical local errors (with optional caller scope) share a
fixed 30-second window. Group updates do not restart the timer. Sonner owns
hover/focus pause, swipe, positioning and reduced-motion behavior.

Current global eligibility stays narrow: non-human Agent conversation requests,
agent-originated non-manual Inbox delivery, News and explicit developer probes.
The initial successful snapshot is silent. Request lifecycle uses one operation
card; completion is green, interruption/pause neutral, rejection amber and
launch/terminal failure red. A correlated Inbox result updates that request's
card without a redundant completion popup. An error-report delivery must never
replace a known failed execution with success. Raw tool/text/recoverable errors
remain detail in their existing surfaces, not independent global notifications.

Dismissal hides only UI feedback; it neither cancels work nor deletes content.
Running progress cannot reopen its dismissed bubble, but a new terminal result
may appear once. News/Inbox actions retain their whole-page destinations; Agent
inspection opens the existing read-only Session details when available, Office
otherwise. No notification action automatically retries or takes over a runtime.
