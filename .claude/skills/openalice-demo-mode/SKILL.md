---
name: openalice-demo-mode
description: Keep the demo-mode MSW handlers in sync when changing any /api/* surface in OpenAlice UI. Use when adding/modifying endpoints, response shapes, UI pages, or sidebar items. Triggers: "demo mode", "MSW handlers", "demo handlers", "Vercel demo".
---

# Demo mode — handler sync procedure

`ui/src/demo/` (MSW handlers + fixtures) is deployed to Vercel as the marketing demo. Three crashes (PRs #235, #238, #240) came from the same pattern: a refactor changed what production code returns/expects, but the demo handler kept the old (or an ad-hoc) shape — and `pnpm test` didn't catch it because esbuild doesn't enforce types.

## When this applies

Any change to a frontend surface that uses `/api/*`:
- new endpoint / modified response shape
- new UI page / new sidebar item
- retired surface

## Procedure

1. Identify the corresponding `ui/src/demo/handlers/<domain>.ts` and check it still matches the production contract.
2. When writing a demo handler, **import the canonical type from `ui/src/api/types.ts`** (or wherever the contract lives) — never inline an ad-hoc shape.
3. Verify before declaring the refactor done:

```bash
pnpm -F open-alice-ui dev:demo
```

Walk the affected surface:
- The `[demo] unmocked …` catchAll `console.warn` log surfaces endpoints you added but didn't mock.
- Visible crashes surface shape mismatches.

4. Retired surfaces: remove their handlers and fixtures too — dead mocks hide real gaps.
