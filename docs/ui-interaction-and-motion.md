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

The stable page hierarchy is:

1. global shell and activity rail;
2. page-owned navigator when the product area needs one;
3. one focused working view;
4. dialogs, drawers, and popovers for temporary decisions.

Avoid duplicating these layers inside the focused view. A page navigator should
not be restyled as a stack of cards, and a detail surface should not create a
second page shell inside itself.

Launch-surface example prompts are compact capability navigation, not generic
chatbot filler. Their visible titles should stay scannable while the inserted
prompt carries the evidence, freshness, persistence, and permission boundaries
needed for the real task. Prefer a small rotating set over a wall of commands.

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
- Shared split layouts use the checked-in shadcn Resizable primitive for their
  separator, pointer/touch capture, and keyboard resizing. Product adapters
  such as `PageSidebarLayout` continue to own route content, responsive mode,
  collapse affordances, and persisted preferences; they must not add a second
  visible border or parallel document-level drag listeners beside the shared
  separator. Responsive min/max values must be derived from the measured split
  group rather than the window: app-shell chrome sits outside that group. Keep
  the complete constraint set feasible at every supported width; when there is
  not enough room for both preferred minimums, preserve the navigator minimum
  and give the working view the measured remainder instead of sending mutually
  impossible hard minimums to the primitive. Treat the primitive's applied
  panel geometry as the authority for which expanded or collapsed surface is
  interactive; input-source bookkeeping may decide whether a settled width is
  persisted, but must never gate `aria-hidden`, `inert`, or collapse-state
  synchronization. Capture resize intent at the split-group boundary so the
  separator's enlarged fine/coarse pointer target behaves like its visible
  one-pixel rule. Persist keyboard changes from the settled layout map rather
  than a pre-paint DOM width, which can lag one key press behind. Direct pointer
  resizing must stay attached to the cursor above the navigator minimum. Below
  that minimum, keep the primitive layout and internal content measure fixed,
  show only a bounded damped overdrag, and spring back on release before the
  primitive's native collapsed-state midpoint. Arm the shared motion token as
  that midpoint is crossed so the 200px-to-44px commit retains spatial
  continuity without squeezing the navigator's controls or making ordinary
  width changes feel lazy. Do not toggle the primitive's `collapsible`
  metadata during an active pointer transaction; its native midpoint remains
  the single collapse boundary.
  Keep geometry transactions single-owner: native pointer and keyboard
  interactions settle through the primitive, while a product collapse or
  restore affordance issues exactly one imperative geometry call. Product
  effects may reconcile applied geometry with persisted intent, but must not
  repeat the same collapse/expand transaction. Because pixel constraint changes
  can re-register v4 Panels after the group's settled callback, validate both
  the settled layout and the final Panel ResizeObserver result; reject and
  repair one-panel `100%` layouts instead of persisting them. A spring cleanup
  timer begins only after release. When a new drag interrupts a returning
  spring, cancel that timer and freeze the currently painted edge before
  resuming direct manipulation so the handle never snaps away from the pointer.
  Registration inputs such as `defaultSize` must remain stable during a held
  pointer transaction; crossing a collapse midpoint is applied state, not a
  reason to unregister and rebuild the Panel. If the product tracks gesture
  state outside the primitive, capture that pointer at the split-group boundary
  so an out-of-bounds release cannot strand it. A final invariant observer must
  compare the painted navigator and content flex items, not only the primitive's
  internal size callback. If those surfaces diverge into an impossible
  `100%`/`0%` pair, rebuild one coherent group snapshot from the last valid
  preference; repeating an already-satisfied internal resize is not recovery.

The `@/` alias resolves to `ui/src` in Vite, TypeScript, and the UI Vitest
project. Backend tests keep their existing root `@` alias.

Motion tokens and primitives live in `ui/src/index.css`:

| Primitive | Intended use |
|---|---|
| `--motion-fast` | direct press/icon feedback |
| `--motion-standard` | page, disclosure, hover, and most state transitions |
| `--motion-slow` | dialogs and visually larger state changes |
| `.oa-pressable` | primary or bordered buttons that lift one pixel on hover |
| `.oa-icon-action` | compact icon/add/collapse controls |
| `.oa-nav-item` / `.oa-nav-row` | rail and secondary-sidebar navigation |
| `.oa-view-enter` | focused view entrance, owned by `TabHost` |
| `.oa-dialog-*` | shared dialog surface and backdrop entrance |
| `.oa-disclosure-enter` | newly expanded hierarchical content |
| `.oa-popover-enter` | menus and compact floating choices |
| `.oa-status-surface` | smooth health/setup card state changes |

Prefer these primitives over copying arbitrary `duration-*`, easing curves, or
keyframes into individual pages. A local animation is justified when it conveys
domain-specific state that the shared vocabulary cannot express.

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
