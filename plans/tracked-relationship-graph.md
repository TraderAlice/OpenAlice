# Tracked Relationship Graph

Status: Completed

Owner guides:

- [[../docs/project-structure.md]]
- [[../docs/ui-interaction-and-motion.md]]

## Problem

Tracked already uses deliberate entity anchors and Obsidian-style `[[name]]`
links, but exposes only a flat entity navigator and one entity's backlink list.
Users cannot see which research notes bridge several assets or topics, where
clusters form, or which tracked anchors have no supporting material.

## Decisions

1. The graph is a read-time projection of `EntityStore` plus the canonical
   backlink scan, never a second persisted relationship database.
2. Registered entities and source materials are distinct node types. One note
   that references multiple entities is one shared node and therefore a real
   bridge between them.
3. Tracked keeps one page shell with a persisted Detail/Graph view choice.
4. The global view remains the default graph scope; a selected entity can be
   reduced to its exact material neighborhood without traversing the entire
   connected component.
5. Source-node navigation reuses the existing Tracked file/Issue provenance.
6. Narrow canvases prioritize a readable window around the selected entity;
   the explicit Fit action retains a complete bird's-eye view.
7. Graph motion is contextual rather than ambient: nodes settle outward from
   the selected anchor in short waves, edges draw once, and pointer focus
   emphasizes only the hovered node's one-hop neighborhood. Motion tokens and
   reduced-motion preferences remain authoritative.
8. Material nodes use the same preview-first interaction as entities. Selecting
   a note or Issue keeps the graph in place, animates a compact inspector into
   view, and defers provenance navigation to the explicit Details action.
9. Pointer focus uses a fixed, native-button hit target. Only the centered node
   mark scales; labels stay outside that transform so long names cannot shift
   the hover boundary and cause edge jitter.
10. Workspace-owned Issues are first-class Tracked navigation anchors without
    being duplicated into `EntityStore`. The sidebar selects them by
    `workspaceId + issueId`; Tracked shows a document-like preview and complete
    Markdown body, while the explicit Details action switches to the canonical
    Issues work-item surface. Selection is mirrored into `/tracked` query
    parameters without changing the single-tab identity, so reload and browser
    Back can reconstruct the selected anchor.
11. Sidebar selection does not choose the page's presentation mode. In Graph
    mode, entity and Issue rows both focus their graph node and open the same
    preview-first inspector; only its explicit Details action enters the
    document or canonical Issue surface. The graph projects unlinked Issues as
    isolated material nodes so this rule applies to the complete Issue index.

## Work

- [x] Add a collision-safe graph HTTP contract derived from canonical entities
      and backlinks.
- [x] Add deterministic, theme-token-based SVG layout without persisted
      coordinates or a canvas-only accessibility boundary.
- [x] Add Detail/Graph switching, global/local scope, node filters, pan, zoom,
      fit, entity selection, and source navigation.
- [x] Mirror the contract in the demo surface and all shipped locales.
- [x] Add core, route, layout, component, page, and demo regressions.
- [x] Add token-based entrance and one-hop focus motion with reduced-motion
      handling and no continuous background animation.
- [x] Add animated material previews that preserve graph context until Details
      is explicitly requested.
- [x] Stabilize node-edge hover by separating hit testing, mark motion, and
      label geometry.
- [x] Add an Issues group to the Tracked sidebar with a lightweight shell,
      complete body rendering, and canonical Issues Details navigation.
- [x] Persist Tracked entity/Issue selection in the route while preserving the
      single Tracked tab and browser Back behavior.
- [x] Unify sidebar entity/Issue selection in Graph mode, including isolated
      graph nodes for Issues without entity backlinks.
- [x] Complete browser, full-suite, and packaged Electron verification.

## Verification

- `npx tsc --noEmit`
- `cd ui && npx tsc -b`
- focused core, route, layout, component, page, and demo suites, including
  sidebar Issue focus and unlinked-Issue graph projection
- `pnpm test` (484 files passed, 1 skipped; 3995 tests passed, 9 skipped)
- real `/tracked` route in Day and Auto color modes at desktop, tablet, and
  phone widths, including scope, filters, zoom, detail, source, and Back flows
- graph entrance and focus states in Day/Night modes and at phone width, with
  motion disabled by both the shared reduced-motion rule and zero-motion style
  profiles
- long-label node focus on the real `/tracked` route, confirming the fixed
  pointer target keeps an identical center and size before and after mark scale
- Issue and note previews at desktop and phone widths, including explicit
  Details navigation with the graph route preserved until activation
- real sidebar entity-to-Issue switching in Graph mode, followed by canonical
  Issue Details navigation and browser Back to the persisted graph selection
- `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron:smoke:workspace`

## Completion Criteria

Tracked can reveal clusters, shared research materials, and isolated anchors
without changing the underlying entity or backlink semantics; mouse, keyboard,
and touch-sized controls can select and navigate nodes; and detail/list behavior
remains available with the same provenance-preserving routes.
