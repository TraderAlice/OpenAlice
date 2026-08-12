# Endpoint Inventory

The HTTP attack surface, organized by mount prefix. **Auth column reflects
intent** — today, none of these check auth. After auth implementation, each
route should require a valid session unless marked otherwise.

Source of truth: `src/webui/plugin.ts` and the route files it imports.

## Endpoints on Alice (`localhost:47331`)

### Public (no auth required after impl)
| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/login` | (PLANNED) accept admin token, set session cookie |
| `POST` | `/api/auth/logout` | (PLANNED) invalidate current session |
| `GET` | `/api/version` | build version + update check (harmless) |
| `GET` | `/login` | (PLANNED) login page HTML |
| `GET` | `/favicon.ico`, `/assets/*` | static assets from `ui/dist/` |

### Authenticated (all of these should require valid session)

#### Chat & sessions
| Method | Path | Purpose |
|---|---|---|
| `GET/POST` | `/api/chat/*` | session-aware chat (multiple sub-routes) |
| `GET/POST` | `/api/channels/*` | sub-channel SSE / subscriptions |
| `GET` | `/api/media/:id` | attachment retrieval |

#### Config (broker + AI + connectors)
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/config` | read merged config |
| `PUT/POST` | `/api/config/*` | mutate config (AI provider, connectors) |
| `GET` | `/api/trading/config` | UTA accounts list |
| `POST` | `/api/trading/config/uta` | create UTA |
| `PUT` | `/api/trading/config/uta/:id` | edit UTA |
| `DELETE` | `/api/trading/config/uta/:id` | delete UTA |
| `POST` | `/api/trading/config/test-connection` | BFF → UTA test-connection |
| `GET` | `/api/trading/config/broker-presets` | preset catalog |

#### Trading domain (BFF proxy → UTA)
All of these are forwarded to UTA verbatim by `src/webui/routes/trading-proxy.ts`.
On UTA they correspond to `services/uta/src/http/routes-trading.ts`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/trading/uta` | list registered UTAs |
| `GET` | `/api/trading/equity` | aggregated USD equity |
| `GET` | `/api/trading/contracts/search` | broker contract search |
| `POST` | `/api/trading/test-connection` | broker probe |
| `GET` | `/api/trading/fx-rates` | FX rate table |
| `POST` | `/api/trading/uta/:id/sync` | force broker sync |
| `POST` | `/api/trading/uta/:id/simulate-price` | hypothetical PnL |
| `POST` | `/api/trading/uta/:id/contracts/details` | drill contract |
| `POST` | `/api/trading/uta/:id/reconnect` | reconnect single UTA |
| `GET` | `/api/trading/uta/:id/account` | account info |
| `GET` | `/api/trading/uta/:id/positions` | open positions |
| `GET` | `/api/trading/uta/:id/orders` | open / specified orders |
| `GET` | `/api/trading/uta/:id/market-clock` | market open/close |
| `GET` | `/api/trading/uta/:id/quote/:symbol` | quote by symbol |
| `POST` | `/api/trading/uta/:id/quote` | quote by Contract+aliceId |
| `GET` | `/api/trading/uta/:id/wallet/log` | git log |
| `GET` | `/api/trading/uta/:id/wallet/show/:hash` | git show |
| `GET` | `/api/trading/uta/:id/wallet/status` | git status |
| `POST` | `/api/trading/uta/:id/wallet/commit` | commit stage |
| `POST` | `/api/trading/uta/:id/wallet/push` | execute (broker-side write) |
| `POST` | `/api/trading/uta/:id/wallet/reject` | reject pending |
| `POST` | `/api/trading/uta/:id/wallet/stage-place-order` | stage a buy/sell |
| `POST` | `/api/trading/uta/:id/wallet/stage-modify-order` | modify stage |
| `POST` | `/api/trading/uta/:id/wallet/stage-close-position` | close stage |
| `POST` | `/api/trading/uta/:id/wallet/stage-cancel-order` | cancel stage |
| `POST` | `/api/trading/uta/:id/wallet/place-order` | one-shot stage+commit+push |
| `POST` | `/api/trading/uta/:id/wallet/close-position` | one-shot |
| `POST` | `/api/trading/uta/:id/wallet/cancel-order` | one-shot |
| `GET` | `/api/trading/uta/:id/snapshots` | snapshot list |
| `DELETE` | `/api/trading/uta/:id/snapshots` | wipe snapshots |
| `GET` | `/api/trading/snapshots/equity-curve` | curve aggregator |

⚠️ The `POST /api/trading/uta/:id/wallet/push` route is the **highest-value
attack target** — it sends real orders to brokers.

#### Simulator (BFF → UTA)
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/simulator/utas` | list MockBroker UTAs |
| `GET` | `/api/simulator/uta/:id/state` | mock state snapshot |
| `POST` | `/api/simulator/uta/:id/mark-price` | set mark price (matching) |
| `POST` | `/api/simulator/uta/:id/tick-price` | percent move |
| `POST` | `/api/simulator/uta/:id/orders/:orderId/fill` | manual fill |
| `POST` | `/api/simulator/uta/:id/orders/:orderId/cancel` | cancel |
| `POST` | `/api/simulator/uta/:id/external-deposit` | sim deposit |
| `POST` | `/api/simulator/uta/:id/external-withdraw` | sim withdraw |
| `POST` | `/api/simulator/uta/:id/external-trade` | sim external order |

#### Other workspace + infra
| Method | Path | Purpose |
|---|---|---|
| `GET/POST` | `/api/workspaces/*` | workspace launcher (PTY, MCP) |
| `GET/POST` | `/api/events/*` | event log + producer |
| `GET` | `/api/topology` | listener registry inspection |
| `GET/POST` | `/api/cron/*` | cron job CRUD |
| `GET/POST` | `/api/heartbeat/*` | heartbeat schedule |
| `GET` | `/api/dev/*` | dev-only utility endpoints |
| `GET` | `/api/tools` | tool registry inspection |
| `GET` | `/api/agent-status/*` | running agent state |
| `GET` | `/api/news/*` | news archive |
| `GET` | `/api/market/*` | aggregator market search |
| `GET` | `/api/notifications` | notifications store |
| `GET/POST` | `/api/inbox/*` | workspace inbox |
| `GET/POST` | `/api/market-data/*` | market data wrapper |

#### MCP
| Method | Path | Purpose |
|---|---|---|
| `*` | `/mcp` | global MCP server (full tool catalog) |
| `*` | `/mcp/:wsId` | per-workspace MCP server |

## Endpoints on UTA (`127.0.0.1:47333`)

UTA isn't directly reachable from outside the host. **But** a successful
attack on Alice gives you access to UTA via BFF proxy. So the attack
target is "what does UTA serve" — knowing it tells you what's downstream.

UTA mounts:

- `/api/trading/*` — see above
- `/api/simulator/*` — see above
- `/__uta/health` — process health + accounts count (informational)

## Health / probe endpoints

| Path | Process | Auth needed? |
|---|---|---|
| `/api/version` | Alice | No (intentional — for update check) |
| `/__uta/health` | UTA | No (intentional — Guardian polls this) |

These are explicitly designed to be unauthenticated. They reveal version
strings and account counts but no secrets.

## What's NOT here

- No `/admin`, `/console`, `/debug` magic endpoints
- No raw filesystem browser
- No SQL — there's no DB
- No file upload endpoint that writes outside workspace dirs

## Attack-priority ranking

If you have limited time, prioritize:

1. **`POST /api/trading/uta/:id/wallet/push`** — real broker side effects
2. **`POST /api/trading/config/test-connection`** — feeds broker credentials
3. **`POST /api/config/*`** — modifies global config including AI provider keys
4. **`POST /api/workspaces/*`** — file-system write, PTY spawn
5. **`/api/auth/login`** — auth surface itself (post-impl)
6. **`POST /api/trading/uta/:id/wallet/reject`** — disrupts pending state
7. Everything else
