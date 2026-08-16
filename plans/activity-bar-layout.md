# Activity Bar personalization

Status: in progress
Owner guides: [[docs/data-locations.md]], [[docs/ui-interaction-and-motion.md]]

## Scope

Users can hide, reorder, and regroup the left Activity Bar, including
creating new groups. The document lives at
`<OPENALICE_HOME>/data/ui-layout.json`. Drag-and-drop editing happens only
on Settings → Activity bar; the rail only renders the joined result.

## Decisions

- Catalog + overlay. `NAV_SECTIONS` stays the code catalog. The JSON stores
  group ids, custom labels, item order, and a hidden set.
- Default document hides `dev`. `/dev` still adopts. Settings cannot be hidden.
- Nano product and Office beta still apply after join.
- Settings-page drag is a pointer sortable: the list reorders under the
  pointer and leaves a gap for the lifted row. Hit-testing uses last
  committed layout boxes, not live transformed rects. Save happens on
  drop, not while the pointer is down. No new UI dependency.

## Checklist

- [x] Schema, default document, file read/write, `GET`/`PUT /api/ui-layout`
- [x] `joinNavLayout` + `useUiLayout` + ActivityBar wiring
- [x] Settings category and editor (visibility, groups, reset, drag)
- [x] Demo handler, i18n, owner guides, specs

## Verification

- `npx tsc --noEmit`
- `cd ui && npx tsc -b`
- `pnpm test`
- Walk `/settings/activity-bar` on the real route and in `dev:demo`
