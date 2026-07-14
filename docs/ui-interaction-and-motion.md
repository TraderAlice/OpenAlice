# UI Interaction and Motion

This guide owns OpenAlice interaction feedback: clickable affordances, motion
tokens, entrance/disclosure behavior, and reduced-motion policy. It complements
the component conventions in `ui/src/index.css` and the shared shell components
under `ui/src/components/`.

## Product Intent

OpenAlice is a working console, not a static report. Motion should make the
interface feel responsive and help the eye retain context without turning live
trading surfaces into ambient animation.

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

Keyboard focus is not a motion effect. Interactive controls still require a
clear `focus-visible` treatment, meaningful labels, and sensible tab order.

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
