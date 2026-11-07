# UI Interaction and Motion

This guide owns shared interaction feedback: clickable affordances, motion
tokens, entrances/disclosures, focus behavior, and reduced-motion policy.
Product routes own their layout and domain state; do not transcribe those
layouts into this guide.

## Interaction contract

OpenAlice is a dense working console. Motion must explain affordance,
continuity, state change, or genuine activity—not decorate empty space. Avoid
competing loops, scroll hijacking, long transitions in dense views, and
transforms that move controls away from the pointer.

Every interactive element needs explicit resting, hover, pressed,
focus-visible, disabled, and loading states where applicable. Required
information cannot be hover-only. Loading and failure feedback stays local to
the request owner and offers retry when recovery is possible.

Prefer native controls and disclosure semantics. Menus, popovers, dialogs, and
custom selects must support keyboard dismissal, predictable focus movement,
focus containment where modal, and focus return to their trigger. Closing an
overlay must not destroy an unrelated draft.

Clickable native and ARIA controls use a pointer cursor. Disabled controls keep
the default cursor and remain visibly disabled. Hover-only transforms are gated
to fine pointers so touch devices do not inherit sticky hover state.

Keyboard focus is not a motion effect. Controls require meaningful labels,
sensible tab order, and a clear `focus-visible` treatment independent of theme,
animation, or reduced-motion settings.

## Shared motion vocabulary

Motion tokens and primitives live in `ui/src/index.css`:

| Primitive | Intended use |
|---|---|
| `--motion-fast` | Direct press and icon feedback |
| `--motion-standard` | Page, disclosure, hover, and most state transitions |
| `--motion-slow` | Dialogs and larger state changes |
| `.oa-pressable` | Primary/bordered control hover and press feedback |
| `.oa-icon-action` | Compact icon, add, and collapse controls |
| `.oa-nav-item` / `.oa-nav-row` | Primary and secondary navigation |
| `.oa-view-enter` | Focused route or state entrance |
| `.oa-dialog-*` | Shared dialog surface and backdrop entrance |
| `.oa-disclosure-enter` | Newly expanded hierarchical content |
| `.oa-popover-enter` | Menus and compact floating choices |
| `.oa-status-surface` | Health and setup state transitions |

Reuse these instead of copying durations, easing curves, or keyframes into
pages. A local animation is justified only for domain-specific state that the
shared vocabulary cannot express.

Focus uses `--oa-focus-ring` and `--oa-focus-shadow`. `oa-field-control` owns
shared input/textarea/select border feedback; the same focus shadow covers
buttons, navigation, tabs, segmented controls, switches, and resize handles.
Accent color retains selection/action meaning rather than becoming a generic
status color.

Keep entrance distances small and durations below 300 ms. Animate `transform`
and `opacity` for movement; use short color, border, and shadow transitions for
feedback. Do not put permanent `will-change` on large lists or page containers.
Chart tooltips disable animation at their component boundary.

## Primitive ownership

Behavioral primitives live as reviewed source under `ui/src/components/ui/`.
They are initialized from shadcn Base UI recipes through `ui/components.json`,
then owned as OpenAlice code. Product compositions keep their domain APIs; the
primitive layer owns portals, focus containment, keyboard navigation, outside
dismissal, scroll locking, and focus return.

- Use an owned primitive before adding document-level listeners or another
  focus trap.
- Keep nested-overlay coordination in Base UI; do not add a parallel portal
  context or manually relocate descendant overlays.
- Regenerating a primitive must not replace semantic tokens, global CSS,
  typography, palette definitions, or product behavior.
- `data-slot` is the stable styling seam and `data-palette` the color axis.
  Runtime `data-ui-style` profiles may restyle owned primitives and shared
  shell/form seams, but must not fork behavior, primitives, or color systems.
- Selection indicators use `SelectionCheckIcon`; callers supply state, not a
  second optical treatment.
- Delete superseded Escape, outside-click, and focus-loop plumbing during
  migration rather than running it beside the primitive.

Shared resizable layouts use the checked-in Resizable primitive for pointer,
touch, and keyboard behavior. Derive constraints from the measured split group,
persist settled user widths rather than temporary responsive caps, and keep
panel registration stable during gestures. Do not add document-level drag
listeners or a second visible separator.

The `@/` alias resolves to `ui/src` in Vite, TypeScript, and UI Vitest. Backend
tests retain the root `@` alias.

## Navigation continuity

Continuity is a component-lifetime concern before animation. Views sharing one
product-area navigator declare the same `shell` in `ui/src/tabs/registry.tsx`;
`TabHost` keeps that shell mounted while replacing active-only content. Do not
remount a shared shell on every drill-in and hide it with a transition. Heavy
Session content remains active-only unless its lifecycle explicitly requires
otherwise.

The application has one global navigation rail. Exactly one visible desktop
expand/collapse control exists; activation transfers focus when its location
changes. Responsive compact mode is a default, not a lock, and explicit rail
preferences apply across product areas. Feature navigators belong to feature
content layouts, not a second global navigation layer.

Closing disclosures become inert and hidden from assistive technology
immediately, including during any exit animation. Selection, focus, and URL
state must not depend on whether motion ran.

## Reduced motion and accessibility

Every shared entrance, loop, and transform honors
`prefers-reduced-motion: reduce`. Reduced motion removes animation and transform
movement while preserving color, focus, status, and state information. No
workflow may require watching an animation to understand completion or failure.

Completion, Stop, unmount, and reduced-motion preference must flush visual text
reveal buffers. Animated content must not change authoritative snapshots,
runtime polling, selection, or navigation state.

Judge changes with realistic long names, errors, financial values, and dense
operational states. A polished empty fixture does not establish usability.
Responsive changes preserve primary identity, state, value, and next action;
they are information-hierarchy changes, not a scaled-down desktop screenshot.

## Review and verification

UI review must identify the interaction problem, reused tokens/primitives,
keyboard behavior, narrow/medium/wide behavior, and any new visual dialect.
Keep page-specific geometry and implementation detail in components and their
rendered checks.

For motion or shared-interaction changes:

1. Exercise the real route with pointer and keyboard.
2. Verify light/dark themes when elevation, focus, or shadows changed.
3. Check narrow layouts for clipping, focus loss, and inaccessible controls.
4. Enable OS/browser reduced motion and confirm equivalent state legibility.
5. Repeat navigation to detect unintended remounts or restarted background work.
6. Verify dialogs, menus, and disclosures return focus and do not leak drafts
   between request identities.

Motion requires the running UI; class names and screenshots alone cannot prove
timing, continuity, pointer feedback, or reduced-motion behavior. Select tests
and owning typechecks through [[docs/development-workflow.md]].
