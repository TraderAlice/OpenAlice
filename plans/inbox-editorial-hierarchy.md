# Inbox Editorial Hierarchy

## Scope

Polish the real `/inbox` split view so a busy Inbox is fast to scan and a
selected report is comfortable to read. Preserve the existing data model,
per-push selection, time/workspace modes, attachments, replies, and provenance.

Owner guide: [UI interaction and motion](../docs/ui-interaction-and-motion.md).

## Design decision

### A. Editorial Inbox — selected

- Treat the navigator as an index: a concise subject, restrained provenance,
  unread state, and time.
- Treat the detail pane as one continuous reading surface, using typography,
  measure, and separators rather than nested cards.
- Give assistive technology the same concise identity visible in the index;
  never use a complete report body as a row's accessible name.
- Keep the existing responsive drawer hierarchy and touch targets.

This preserves OpenAlice's warm, information-dense workstation language and
keeps long reports readable without hiding their source or actions.

### B. Message cards — rejected

Wrapping message, attachments, provenance, and replies in separate cards makes
each region locally obvious, but fragments long reports and recreates the
nested-card visual debt that the product is removing elsewhere.

## Work

- [x] Introduce a single tested presentation helper for concise Inbox subjects
      and accessible row labels, including long single-line reports, Markdown,
      attachment-only pushes, Unicode, and empty content.
- [x] Refine time and workspace rows around subject/provenance hierarchy without
      changing selection, read state, search, grouping, or keyboard navigation.
- [x] Refine the selected report's reading measure, lead identity, prose rhythm,
      attachment transition, and reply transition without adding cards.
- [x] Verify desktop, narrow/tablet, long text, attachment, and overlay states
      on the real `/inbox` route.
- [x] Run focused tests, `npx tsc --noEmit`, `pnpm test`, and
      `cd ui && npx tsc -b`.

## Acceptance

- The navigator communicates what changed, where it came from, and when, at a
  glance; its accessible name remains short even for a multi-paragraph report.
- A selected long report reads as a durable document instead of an unbroken UI
  blob, while its exact content is unchanged.
- Attachments and replies remain discoverable and keyboard reachable.
- Existing time/workspace modes, search, j/k navigation, read state, deletion,
  provenance navigation, and attachment actions retain their behavior.
- No feature-local portal, focus, transport, or polling implementation is added.
