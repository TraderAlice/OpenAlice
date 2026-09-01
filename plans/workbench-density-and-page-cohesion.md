# Workbench density and page cohesion

Status: Complete

Related work: #1158, PR #1279

Owner guide: [`docs/ui-interaction-and-motion.md`](../docs/ui-interaction-and-motion.md)

Delivery: External proposal targeting `dev`

## Goal

Give every registered frontend route one coherent workbench design system.
Shared tokens and primitives own typography, descriptions, controls, cards,
menus, popovers, dialogs, drawers, state surfaces, empty states, feedback, and
motion. Existing information architecture, route composition, domain behavior,
and primary layout remain stable. Page-level work removes duplicated chrome,
ornamental copy, arbitrary corner scales, nested cards, and local interaction
dialects.

## Interaction model

Three implementation paths were evaluated:

1. Independent page styling gives every route local control and repeats layout,
   state, and motion decisions.
2. Shared foundation corrections followed by route-family sweeps establish one
   ownership boundary and preserve route-specific workflows.
3. A new shell composition changes navigation and page layout together with the
   component system.

Path 2 owns this initiative. It gives every route the same defaults and keeps
the requested layout boundary intact. Page data, commands, routing, and
persistence remain stable. Semantic health, unread, and running indicators
remain visible. Decorative markers, repeated descriptions, and redundant
separators are removed. Responsive layout uses the existing sidebar and page
primitives. Keyboard names, focus visibility, touch targets, reduced motion,
and narrow viewport access remain acceptance criteria.

## Ordered work

- [x] Audit every registered primary route at desktop width for overflow,
  accessible control names, content density, nested surfaces, and repeated
  motion patterns.
- [x] Compact shared page, navigation, settings, state, and button primitives.
- [x] Reduce repeated containers and preview density in Workspaces.
- [x] Convert the Market overview to a quieter data-first hierarchy.
- [x] Compact Connector and Agent Runtime settings through shared section and
  list ownership.
- [x] Replace generic Connector glyph tiles with official transparent brand
  marks and normalize Connector card, badge, action, and session-menu geometry.
- [x] Verify the first route set, narrow layouts, both theme families, keyboard
  access, reduced motion, type checking, tests, and production build.
- [x] Publish first-route screenshots and update PR #1279 with the implemented
  scope and verification evidence.
- [x] Define the final shared geometry, type, color, elevation, interaction, and
  motion contract from current OpenAlice behavior, OLo, Base UI, and current
  reference evidence.
- [x] Converge Button, form, selection, tabs, menu, popover, tooltip, dialog,
  drawer, toast, state, empty-state, and loading primitives on that contract.
- [x] Sweep Chat, Inbox, Workspaces, Issues, Tracked, Office, and Automation
  routes through the shared system.
- [x] Sweep Market, News, Portfolio, Simulator, UTA, and trading routes through
  the shared system.
- [x] Sweep every Settings category and Connector configuration route through
  the shared system.
- [x] Sweep onboarding, templates, file viewers, developer tools, logs, and
  secondary workbench routes through the shared system.
- [x] Tighten English, Simplified Chinese, Traditional Chinese, and Japanese
  descriptions at their owning surface and remove copy that repeats controls or
  headings.
- [x] Verify every registered route at 1512x900 and 390x844 across Paper and
  Graphite, then verify keyboard, pointer, touch, reduced motion, type checking,
  tests, and production build.
- [x] Publish the final route-family screenshot set and update PR #1279 with the
  full system contract and verification evidence.

## Completion

The plan completes when shared primitives and every registered frontend route
use one system, all required checks pass, the screenshot set covers each route
family at desktop and narrow widths, and PR #1279 records the final behavior and
evidence.
