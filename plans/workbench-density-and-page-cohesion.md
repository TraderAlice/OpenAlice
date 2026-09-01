# Workbench density and page cohesion

Status: Active

Related work: #1158, PR #1279

Owner guide: [`docs/ui-interaction-and-motion.md`](../docs/ui-interaction-and-motion.md)

Delivery: External proposal targeting `dev`

## Goal

Give every primary route one coherent workbench hierarchy. Shared page headers,
secondary navigation, settings sections, state surfaces, and motion own the
default visual grammar. Workspaces, Market, Connector Settings, and Agent
Runtime Settings receive focused density corrections at their existing data and
interaction boundaries.

## Interaction model

Three implementation paths were evaluated:

1. Independent page styling gives every route local control and repeats layout,
   state, and motion decisions.
2. Shared foundation corrections plus focused dense-route corrections establish
   one ownership boundary and preserve route-specific workflows.
3. A second appearance profile introduces another visual dialect and leaves the
   default workbench unchanged.

Path 2 owns this increment. Page data, commands, routing, and persistence remain
unchanged. Semantic health, unread, and running indicators remain visible.
Decorative markers and redundant separators are removed. Responsive layout uses
the existing sidebar and page primitives. Keyboard names, focus visibility,
touch targets, reduced motion, and narrow viewport access remain acceptance
criteria.

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
- [x] Verify primary routes, narrow layouts, both theme families, keyboard
  access, reduced motion, type checking, tests, and production build.
- [x] Publish current screenshots and update PR #1279 with the completed scope
  and verification evidence.

## Completion

The plan completes when the shared primitives and focused routes ship together,
all required checks pass, the screenshot set covers the affected desktop and
narrow states, and PR #1279 records the final behavior and evidence.
