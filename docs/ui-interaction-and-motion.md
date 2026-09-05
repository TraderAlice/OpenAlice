# UI Interaction and Motion

This guide owns OpenAlice interaction feedback: clickable affordances, motion
tokens, entrance/disclosure behavior, and reduced-motion policy. It complements
the component conventions in `ui/src/index.css` and the shared shell components
under `ui/src/components/`.

## Product Intent

OpenAlice is a working console, not a static report. Motion should make the
interface feel responsive and help the eye retain context without turning live
trading surfaces into ambient animation.

## Visual Language: Warm Editorial Workstation

OpenAlice should feel like a calm, paper-like professional desk: warm,
information-dense, precise, and operational. It is neither a generic admin
dashboard nor a decorative consumer-finance app.

Build hierarchy with typography, spacing, alignment, and thin separators before
adding another container. One dominant surface should own a task; supporting
information should recede without becoming illegible.

- Use warm neutral surfaces and the existing theme tokens. Do not introduce
  isolated hard-coded palettes.
- Reserve blue for interaction and selection. Reserve green and red for
  financial or safety meaning, and amber for warnings. Do not use semantic
  colors as decoration.
- Prefer restrained radii, borders, and tonal changes over nested cards,
  floating glass panels, gradients, neon effects, or large ambient shadows.
- Use tabular numerals for quantities, prices, percentages, and timestamps.
  Use monospace selectively for identifiers, symbols, commands, and machine
  output rather than for ordinary prose.
- Keep copy direct and operational. Lead with the state or object, then the
  explanation and next action.

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

The stable page hierarchy is:

1. global shell and activity rail;
2. page-owned navigator when the product area needs one;
3. one focused working view;
4. dialogs, drawers, and popovers for temporary decisions.

The activity rail's items, groups, and visibility are user-arranged from
Settings → Activity bar and stored in `data/ui-layout.json`. The rail only
renders the joined result. Deep links to a hidden surface still adopt.
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

### Background execution surfaces

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

The Harness footer identity opens the current Workspace's details in the same
Harness shell (`/<harness>/workspaces/:wsId/details`); the adjacent chevron is an
independent Workspace switcher. Keep configuration and conversation browsing
as separate actions below it. Do not make the identity click switch Workspaces,
open agent configuration, or navigate to the global Workspace catalog.

Details distinguish the Workspace-owned README and recorded applied/source
versions from the current catalog's Harness guide. Catalog documentation is
reference material, not proof of the installed version or current Workspace
configuration. Keep document loading/errors independent, retain the sessions
sidebar, and use the shared reading renderer rather than a new Markdown stack.

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
  Responsive compact mode is a default, never a lock. Chat, Quant, and
  Prediction default compact and share a temporary expansion override while
  inside that workbench group. Leaving the group clears the override and
  restores the saved global preference; workbench toggles never rewrite it.
- `TopBar` owns compact header geometry (40px desktop, at least 48px on phone).
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

Motion tokens and primitives live in `ui/src/index.css`:

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

The application body establishes a 14px type size with 20px leading. Explicit
display, heading, control, caption, and data roles build from that stable
reading baseline.

The compact activity rail retains its static Alice mark. Its expansion action
lives in the content-side top bar, not in a brand-hover affordance. Small
desktop windows still permit explicit expansion. The shell owns effective
rail state so its toggle and the rendered rail always agree.

Dense market panels use `oa-data-surface` for the shared border and canvas and
`oa-data-surface-header` for section hierarchy. Data components retain their
domain-owned layout and use the shared surfaces to align cards, charts, quote
summaries, and launch actions. Recharts tooltips set `isAnimationActive={false}`
at the component boundary, and the shared chart class owns their visual material.

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

Market directory headings are independent disclosure controls: News, Markets,
Macro and Watchlist fold without navigating; child rows navigate.
Their local open state survives view changes inside the mounted market shell.
Hidden descendants remain mounted but are excluded from focus and accessibility
navigation by the native hidden attribute. No new persisted preference is added.

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
