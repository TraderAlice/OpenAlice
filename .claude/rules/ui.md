---
paths:
  - "ui/**"
---

# UI rules (loaded when touching ui/**)

- **Strict typecheck for UI is separate**: `cd ui && npx tsc -b`. `pnpm build` catches UI type errors (proper `tsc -b`), but `pnpm test` does NOT (Vitest transpiles via esbuild — behavior only, no type drift). Run `tsc -b` whenever you touch `ui/`.
- **Demo-handler duty**: any change to a surface that uses `/api/*` (new endpoint, changed response shape, new page, new sidebar item, retired surface) requires checking `ui/src/demo/handlers/<domain>.ts` still matches. Import canonical types from `ui/src/api/types.ts`, never inline ad-hoc shapes. Verify with `pnpm -F open-alice-ui dev:demo` — see the `openalice-demo-mode` skill for the full procedure. (PRs #235/#238/#240 all crashed from skipping this.)
- `ui/auth/` holds the login gate and ships separately from `src/` — don't fold it into Alice.
- Trading routes in the UI hit Alice's BFF (`/api/trading/*` proxied to UTA) — the UI never talks to UTA directly.
