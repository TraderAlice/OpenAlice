# Unified page top bar

Status: implemented and locally verified on `codex/ui-usability-followup`; maintainer visual acceptance pending.
Related issues: none.
Owner guide: [[docs/ui-interaction-and-motion.md]].

## Scope and decisions

- Maintainer approved global adoption rather than a Portfolio-only pilot.
- Share a 40px desktop / touch-sized mobile toolbar between navigator and content.
- Layout owns the fixed content header. Pages
  supply identity/actions without duplicating shell markup or losing React context.
- Secondary description/live metadata sits below the toolbar, separate from
  the compact identity/action row. Large action groups wrap in constrained panes.
- Maintainer clarified the boundary during implementation: one global rail;
  the secondary navigator belongs to the current feature's content layout.
- The only desktop global toggle sits beside OpenAlice when expanded, and
  moves to the leading edge of the right-hand area's first top bar when compact.
  Activation transfers keyboard focus to its new location. A static feature navigator consumes it and masks it
  from its content; otherwise the content bar consumes it. Phone primary
  navigation remains in the existing MobileContextBar.
- Remove the generic secondary collapse/restore, strip, persisted-collapse
  read, and overdrag gesture. Preserve resize geometry, saved widths, keyboard
  resizing, and feature drawers. Features may still own internal panel controls.
- Responsive rail compactness is a default, not a prohibition on expansion.
  Explicit preferences win; Chat/Quant/Prediction no longer force a compact rail.
- Reuse theme, button, tooltip, and Resizable primitives. No backend, trading,
  route, or backend data-model changes.
- Keep the branch for interactive acceptance; no PR or merge this iteration.

## Checklist

- [x] Add shared toolbar and fixed content-header composition.
- [x] Adopt the single global toggle and remove generic secondary collapse.
- [x] Migrate standard and bespoke page headers; preserve domain controls.
- [x] Add/update layout, responsive, portal lifecycle, and accessibility tests.
- [x] Run UI typecheck and complete UI owner tests.
- [x] Inspect real routes at wide, 913px, and phone widths; dark/light;
      primary toggle, resizing, navigation, keyboard, scrolling, long actions.
- [x] Record evidence and outstanding acceptance; update owner documentation.

## Acceptance evidence and limits

- Workspace footer refinement: remove only the Manager menu entry; move New
  workspace beneath the existing-workspace list in a shared submenu. Retain
  Manager routes and the existing create dialog. Workspace list scrolls
  independently of the create item. Verified mouse and ArrowRight/ArrowLeft,
  Escape/focus return, and opening/canceling creation on the real Chat route.
- Follow-up placement refinement: expanded control beside OpenAlice, compact
  control in the content-side toolbar. Real 913px Market verified Enter/Space
  round-trip, one visible control and focus handoff. UI typecheck plus the five
  affected navigation/header spec files passed (23 tests).
- `pnpm test:owner:ui`: 283 files / 1670 tests passed. UI typecheck
  (`pnpm --dir ui exec tsc -b`) and `git diff --check` passed. Earlier failures
  were missing full-title tooltip coverage (fixed) and obsolete expectations
  for the removed secondary-collapse buttons (updated to assert resizing).
- Real UI: `http://127.0.0.1:5173`, home `/Users/ame/.openalice-ui-dev`.
  Portfolio, Chat/new chat/paused session, Inbox, Market, and Settings inspected.
  Confirmed 40px aligned desktop headers and touch-sized phone toolbar.
- Explicit rail expansion works at 913px and remains expanded after entering
  Chat. One button changes its accessible label/state without losing focus.
  Keyboard Home on Trading's separator stops at 200px; ArrowRight widens it.
- Separate MSW preview checked account actions at 390px/913px, WebPi, terminal
  placeholder, Files open/close at 390px, and Studio failure/actions. The QA
  server/tab was stopped/closed; viewport overrides were reset. Real runtime
  remains running, with Portfolio open for maintainer review.
- No trading writes, credential changes, live agent launches, or live Studio
  installation were performed. Terminal connection and Harness lifecycle code
  were not changed; demo visual evidence does not certify live PTY/Studio startup.

## Completion

One coherent toolbar contract, no duplicate page titlebars/restore controls,
all existing actions reachable, passing owner checks, and maintainer acceptance
of the rendered result. Live broker operations are not part of acceptance.
