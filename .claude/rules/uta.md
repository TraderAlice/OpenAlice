---
paths:
  - "services/uta/**"
---

# UTA rules (loaded when touching services/uta/**)

- **All broker / git-state / FX / snapshot logic lives here** (`services/uta/src/domain/trading/`), never in Alice's `src/`. `packages/ibkr` is UTA-owned — do not import it from `src/`.
- The ONLY shape that crosses the Alice↔UTA process line is `@traderalice/uta-protocol` (wire types + zod schemas + client SDK). Alice reaches UTA via `src/services/uta-client/` SDKs and BFF-proxied `/api/trading/*` routes — never import UTA internals directly.
- **No hot reload**: config changes that affect UTA go through the flag-file restart protocol (`data/control/restart-uta.flag`, watched by Guardian). Startup path == restart path; anything you add to bootstrap must be restart-safe.
- Use `decimal.js` for all financial math. Order ids are STRINGS end-to-end — never let them touch float.
- Standalone `pnpm -F @traderalice/uta-service typecheck` has known errors (ANG-65, ctx-type leak from Alice's EngineContext) — don't use it as a gate until fixed. `npx tsc --noEmit` from root + `pnpm test` are the gates.
- After ANY change to trading paths, run the relevant scenarios from the `uta-test-scenarios` skill (S1–S12) on demo accounts. New broker integration = full catalog + acceptance checklist. Demo accounts only; leave accounts flat.
- Venue quirks you discover go in the venue's `exchanges/<name>.ts` override file — that file is the canonical home for every quirk.
