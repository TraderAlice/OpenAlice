# Architecture (for the red-team agent)

This file gives you enough of OpenAlice's runtime shape to attack it
intelligently. For positioning/marketing, read the root `README.md` — this
file is technical-only.

## Process layout

Three long-lived processes on the operator's machine:

```
[Guardian supervisor (scripts/guardian/dev.ts or prod.mjs)]
       │
       │ spawns + supervises
       │
       ├─→ [UTA process]    bind 127.0.0.1:47333
       │       services/uta/src/main.ts
       │       Holds: broker connections, Trading-as-Git state, FX, snapshots
       │
       └─→ [Alice process]  bind by config (default localhost:47331)
               src/main.ts
               Holds: agent runtime, UI server, BFF to UTA, all user-facing surfaces

   (dev only) [Vite dev server]  bind 0.0.0.0:5173
                  ui/ vite + proxy /api/* → Alice
```

In prod (Docker), Vite is absent — Alice serves the pre-built UI from
`ui/dist/`. UTA stays the same.

## Trust boundaries

| Caller → Callee | Trust assumption |
|---|---|
| Browser → Vite | Vite is dev-mode only, exposes everything |
| Browser → Alice (`:47331`) | **THIS is the auth boundary we care about** |
| Alice → UTA (`127.0.0.1:47333`) | Today: full trust (same-host, same-user) |
| Alice → MCP (`localhost:47332`) | Same as UTA — full trust |
| Workspace agent CLI → MCP | Full trust (loopback) |
| Anything → `data/` dir | Full trust (host filesystem perms only) |

The interesting attack frontier today is the **Browser → Alice** edge,
because that's the only one exposed when bind is non-localhost.

## Where auth would be enforced (when implemented)

The auth gate is planned to live in `src/webui/plugin.ts` as Hono
middleware, mounted before all the `app.route(...)` calls. As of
2026-05-23, no such middleware exists — see `findings/2026-05-23-pre-implementation.md`.

Routes mounted in `src/webui/plugin.ts` (browsing for endpoints):

```
/api/chat              chat sessions, message history
/api/channels          sub-channel subscriptions
/api/media             attachment storage
/api/config            broker config, AI provider config, connectors
/api/market-data       research-side market data
/api/events            event log
/api/topology          listener registry topology
/api/cron              cron jobs config
/api/heartbeat         heartbeat scheduler
/api/trading/config    broker setup wizard CRUD + test-connection
/api/trading/*         BFF proxy → UTA's /api/trading/* routes
/api/simulator/*       BFF proxy → UTA's /api/simulator/* routes
/api/dev               dev-only utility endpoints
/api/tools             tool registry inspection
/api/agent-status      ongoing agent run status
/api/news              news archive
/api/market            market search aggregator
/api/notifications     notifications store
/api/inbox             workspace inbox
/api/version           build version + update check
/api/workspaces        workspace launcher (PTY, lifecycle)
/mcp                   MCP server (workspace-scoped at /mcp/:wsId)
```

See `endpoints.md` for a per-route inventory.

## UTA process — what it owns

UTA (`services/uta/src/main.ts`) holds:

- `UTAManager` — registry of broker connections (CcxtBroker, AlpacaBroker, etc.)
- `UnifiedTradingAccount` — one per UTA, wraps broker + git state machine
- `FxService` — FX rate cache for cross-currency math
- `SnapshotService` + scheduler — periodic equity-curve snapshots
- 24 + simulator + new auth-impl-supporting routes mounted under `/api/trading/*` and `/api/simulator/*`
- Health endpoint: `/__uta/health`

UTA binds **only** 127.0.0.1:47333 (or the next free port if conflict).
No reverse proxy or BFF can change this — by design, only Alice (same host,
same user) can reach UTA.

## Alice ↔ UTA wire

Alice talks to UTA via `UTAManagerSDK` (`src/services/uta-client/UTAManagerSDK.ts`)
which uses `createUTAClient({baseUrl: process.env.OPENALICE_UTA_URL})`
under the hood. All requests are HTTP to `127.0.0.1:47333`.

The BFF proxy (`src/webui/routes/trading-proxy.ts`) handles HTTP requests
hitting Alice's `/api/trading/*` and forwards them as-is to UTA. So
attacking `localhost:47331/api/trading/uta` is functionally equivalent to
attacking UTA directly (if you could reach UTA — but you can't from
outside the host).

## Guardian supervisor

Guardian (`scripts/guardian/`) is the L2 in OpenAlice's
[port-architecture-3-layers](../../docs) model. It:

- Probes free ports (47331, 47332, 47333)
- Spawns UTA first, polls `/__uta/health`, then Alice
- Watches `data/control/restart-uta.flag` (debounced 100ms) → SIGTERM + respawn UTA
- Cascades shutdown on signal or unexpected child exit

Guardian itself isn't network-exposed. It only writes/reads files and
spawns processes.

## Filesystem state

```
data/
  config/
    accounts.json           # broker UTA configs
    ai-provider-manager.json
    connectors.json
    cron/jobs.json
    snapshot.json
    heartbeat.json
    auth.json               # (NOT YET) admin token hash
    sessions.json           # (NOT YET) active session list
  trading/
    <utaId>/
      commit.json           # git-like trading history
      snapshots/*.json      # equity snapshots
  control/
    restart-uta.flag        # Guardian watches this
  workspaces/
    workspaces.json         # workspace registry
    <wsId>/                 # per-workspace scratch dir
```

`data/` is intentionally writable by the Alice and UTA processes. There's
no per-process isolation today.

## Session expectations (forward-looking)

When auth is implemented, sessions will be stored in
`data/config/sessions.json` and the cookie name will be `alice_session`
(planned). The file permissions need to be `600` (owner-only) so a sibling
non-root account can't read it.

## What's NOT in the architecture (worth knowing)

- No database (Postgres, SQLite, Redis) — everything is JSON files
- No password hashing today (no password concept exists)
- No CSRF middleware today
- No rate limiter today
- No CORS allowlist today (Hono default is permissive)
- No CSP / security headers configured today

This is a fresh canvas — your attacks today should all succeed. That's the
baseline. After auth lands, the canvas should be different.
