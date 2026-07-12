# OpenAlice Long-Term Roadmap

**Vision: the best-in-class autonomous AI operating system for markets** — the
substrate where human and AI agents share workspaces, memory, tools, and an
approval-gated path to real accounts.

This is the forward-looking **planning surface**, not an owner guide: nothing
here is committed work, and current code always overrides this prose. It is
grounded in the architectural audit ([[docs/architecture.md]]) and a code-level
gap analysis (2026-07). Every idea respects the three architectural invariants:

1. **No in-process model loop** — native CLIs own it; autonomy = headless
   Workspace dispatch.
2. **Trading writes live only in UTA** — Alice proxies.
3. **New capabilities ship as templates, skills, or satellites** — not engine
   machinery in `src/`.

**Legend.** Impact / Difficulty: 🔴 High · 🟡 Medium · 🟢 Low. Time is focused
engineering effort (d = days, w = weeks). "Deps" are prerequisite ideas by ID or
external facts.

---

## 1. Situation Analysis

### Strengths (protect these)

- **Right core bet.** Mapping trading onto the coding-agent substrate (git,
  issues, markdown, PTYs) is a durable differentiator no chat-wrapper product
  has.
- **Clean process boundaries.** Guardian/Alice/UTA separation, single-writer
  locks, loopback-only tool plane, sealed credentials — a security-first
  topology that most "AI OS" projects lack.
- **Two-registry tool system** with identity-by-URL (zero forgery surface) is
  genuinely elegant and extensible.
- **Adapter seam** (`CliAdapter`) cleanly abstracts 4 agent CLIs + shell; the
  credential vault's "wire capabilities" model handles the messy multi-provider
  reality well.
- **File-backed everything** — inspectable, backupable, migration-framework
  governed; excellent test discipline (2,500 specs, golden specs, smoke suites).
- **Docs culture.** Owner guides with a maintenance rule are rare and valuable.

### Weaknesses (verified in code)

- **No lint/format tooling anywhere** — no ESLint/Biome/Prettier config exists;
  style consistency is convention-only.
- **Logging is split-brained**: pino is a dependency and UTA/launcher use
  structured logs, but `src/` has ~75 raw `console.*` calls and no universal
  sink, no levels, no rotation.
- **God-files** breach the repo's own 800-line rule: `routes/workspaces.ts`
  (~1.6k), `workspaces/service.ts` (~1.4k), `core/config.ts` (~1.1k),
  `tool/trading.ts` (~0.9k).
- **Memory is shallow**: entity search is case-insensitive substring only; no
  embeddings, no ranking, no recall into agent context beyond skills/persona.
- **Single-identity auth**: one admin token, "no user concept" (by design
  today, a ceiling tomorrow).
- **No observability**: no metrics, no traces, no health dashboard beyond
  `/__uta/health`.
- **Hand-synced enums** (`WireShape` ×2) and a cross-plugin ref-box null window
  are latent-bug shapes.
- **Windows flake** (`headless-task-registry.spec.ts` ENOTEMPTY) erodes trust
  in CI signal.

### Missing (category-defining gaps)

- Plugin/extension system beyond templates+skills (no manifest, no lifecycle,
  no marketplace).
- GitHub/webhook/n8n/external-event integration — zero today (the event bus was
  deliberately retired; the gap is *inbound triggers*, not an internal bus).
- Multi-agent coordination primitives (agents can read peers' files via
  `workspace_path`, but there is no review/hand-off/consensus protocol).
- Backtesting/paper-trading evaluation loop that grades agent output.
- Mobile/remote access story (admin token exists; no first-class remote UX).
- Vector/semantic layer over entities, inbox, news archive, and transcripts.

### Scalability / Maintainability / Usability / DX (summary)

| Axis | Today | Ceiling risk |
|---|---|---|
| Scalability | one host, 8 concurrent headless, file-backed | fine for 1 user; multi-workspace fan-out and news archive growth need indexing + retention jobs |
| Maintainability | strong tests, strict TS; but god-files, no lint, console logging | refactor + tooling debt compounds with contributor growth |
| Usability | powerful but expert-shaped; onboarding depends on CLI auth + terminal literacy | guided onboarding, health panel, and mobile remote are the gaps |
| DX | good scripts/smokes/docs; no lint, no pre-commit, Windows quirks | first-PR time is dominated by environment + conventions discovery |

---

## 2. Improvement Catalog (112 ideas)

### 2.1 AI (8)

| ID | Idea | Impact | Diff | Time | Deps | Benefit |
|---|---|---|---|---|---|---|
| AI-1 | Model-routing policy per task class (flagship for theses, cheap for scans) via credential `lastModel` + issue frontmatter `model:` | 🔴 | 🟡 | 1w | — | Big subscription-quota/cost savings on scheduled runs |
| AI-2 | Structured-output contract for headless runs (JSON schema in issue → validated by runner, retry on mismatch) | 🔴 | 🟡 | 1.5w | — | Reliable machine-readable agent results; unlocks pipelines |
| AI-3 | Per-run token/cost accounting parsed from CLI stream-json events, surfaced in Inbox entries | 🔴 | 🟡 | 1w | — | Visibility into spend per issue/schedule |
| AI-4 | Prompt-pack versioning: templates' `instruction.md` gets semver + changelog, injected version recorded on runs | 🟡 | 🟢 | 3d | — | Reproducibility; A/B prompt evolution |
| AI-5 | Readiness probe cache + background refresh (45s probe currently on-demand) | 🟡 | 🟢 | 3d | — | Snappier launch UX; fewer cold-probe stalls |
| AI-6 | Add Gemini CLI adapter (5th agent runtime) behind `CliAdapter` | 🟡 | 🟡 | 1.5w | — | Provider diversity; free-tier onboarding path |
| AI-7 | Evaluation harness: replay a fixed market scenario, grade agent reports (rubric agent) — "agent regression tests" | 🔴 | 🔴 | 3w | AI-2 | Quantified prompt/model regressions before release |
| AI-8 | Context budget advisor: warn when injected skills+persona+issue exceed a size threshold per CLI | 🟢 | 🟢 | 2d | — | Prevents silent context bloat degrading runs |

### 2.2 Agents (8)

| ID | Idea | Impact | Diff | Time | Deps | Benefit |
|---|---|---|---|---|---|---|
| AG-1 | Agent "roles" as first-class template metadata (researcher/reviewer/executor) with matching skill bundles | 🔴 | 🟡 | 1w | — | Clear division of labor; foundation for multi-agent |
| AG-2 | Run timeout + heartbeat for headless tasks (kill runaway CLI, mark run failed with tail-of-log) | 🔴 | 🟢 | 4d | — | No zombie runs; trustworthy automation |
| AG-3 | Retry policy on headless failure (n retries, backoff, dedup marker) declared in issue frontmatter | 🔴 | 🟡 | 1w | AG-2 | Scheduled scans survive transient CLI/auth blips |
| AG-4 | Interactive → headless hand-off ("continue this session as a scheduled issue" one-click) | 🟡 | 🟡 | 1w | — | Smooth path from exploration to automation |
| AG-5 | Per-workspace agent permission profiles (which tool groups the CLI gateway serves per wsId) | 🔴 | 🟡 | 1.5w | — | Least-privilege agents; research ws can't touch trading |
| AG-6 | Session outcome classification (success/blocked/error) auto-derived from stream-json + inbox_push presence | 🟡 | 🟢 | 4d | AI-2 | Board/inbox show run health at a glance |
| AG-7 | Managed runtime for source installs (optional auto-download of Pi like the packaged desktop) | 🟡 | 🔴 | 2w | — | Zero-CLI onboarding on Linux/Windows source path |
| AG-8 | Agent scratchpad convention (`.alice/scratch/` gitignored per workspace) taught by a skill | 🟢 | 🟢 | 2d | — | Keeps repos clean; less noise in diffs/commits |

### 2.3 Memory (7)

| ID | Idea | Impact | Diff | Time | Deps | Benefit |
|---|---|---|---|---|---|---|
| ME-1 | Embeddings index over entities + inbox + issue bodies (local ONNX/bge-small; SQLite-vec or LanceDB file-backed) | 🔴 | 🔴 | 3w | — | Semantic recall; the single biggest memory upgrade |
| ME-2 | `memory_recall` workspace tool: top-k relevant entities/inbox items injected on demand | 🔴 | 🟡 | 1w | ME-1 | Agents stop re-deriving known context |
| ME-3 | Entity relations become typed edges (supports/contradicts/owns/competes) instead of bare wikilinks | 🟡 | 🟡 | 1.5w | — | Graph queries: "what contradicts this thesis?" |
| ME-4 | Thesis lifecycle states (draft→active→invalidated→closed) with review-by dates surfacing in Inbox | 🔴 | 🟡 | 1w | ME-3 | Theses stop rotting silently; core trader value |
| ME-5 | Auto-entity extraction pass over inbox_push content (suggest new tickers/topics; human confirms) | 🟡 | 🟡 | 1.5w | ME-1 | Memory graph grows without manual curation |
| ME-6 | Memory retention/compaction job (archive stale entities, dedupe near-identical, size caps) | 🟡 | 🟡 | 1w | ME-1 | Long-run store health; bounded recall noise |
| ME-7 | Cross-session "what changed since I last looked" digest per entity (event-sourced from writes) | 🟡 | 🟡 | 1.5w | ME-3 | Instant catch-up on any tracked name |

### 2.4 UI (8)

| ID | Idea | Impact | Diff | Time | Deps | Benefit |
|---|---|---|---|---|---|---|
| UI-1 | System health panel (Guardian/Alice/UTA/agents/ports/locks in one view, with repair hints) | 🔴 | 🟡 | 1.5w | — | Kills the #1 support class ("is it running?") |
| UI-2 | Global command palette (⌘K: jump to workspace/issue/entity/tool) | 🔴 | 🟡 | 1w | — | Expert speed; discoverability for novices |
| UI-3 | Run timeline view per issue (schedule fires → runs → inbox reports, one vertical history) | 🔴 | 🟡 | 1.5w | — | Automation becomes legible; trust grows |
| UI-4 | Entity graph visualization (force-directed wikilink/relation explorer) | 🟡 | 🟡 | 2w | ME-3 | Memory becomes explorable, demo-able |
| UI-5 | Notification center + optional desktop notifications for Inbox arrivals and failed runs | 🟡 | 🟢 | 4d | — | Users stop polling the Inbox |
| UI-6 | Mobile-responsive read-only mode (Inbox, board, portfolio) | 🟡 | 🟡 | 2w | SE-2 | Check the system from a phone safely |
| UI-7 | Onboarding checklist wizard (CLI detected→logged in→first workspace→first issue→first report) | 🔴 | 🟡 | 1w | — | Cuts time-to-first-value drastically |
| UI-8 | Diff/approval UI polish for Trading-as-Git (side-by-side staged vs account state, one-click reject reasons) | 🔴 | 🟡 | 1.5w | — | The trust-critical surface deserves the best UX |

### 2.5 Performance (6)

| ID | Idea | Impact | Diff | Time | Deps | Benefit |
|---|---|---|---|---|---|---|
| PF-1 | News archive indexing + retention compaction (search currently scans files) | 🟡 | 🟡 | 1w | — | Archive stays fast at months of feeds |
| PF-2 | Scrollback store size caps + lazy hydration for long-lived PTYs | 🟡 | 🟢 | 3d | — | Memory stays flat with many sessions |
| PF-3 | Config read caching with file-watch invalidation (several stores re-read JSON per request) | 🟡 | 🟢 | 4d | — | Fewer disk hits on hot paths |
| PF-4 | Parallelize Alice boot (market-data clients + symbol index load concurrently) | 🟢 | 🟢 | 2d | — | Faster `pnpm dev` inner loop |
| PF-5 | Bar/quote response cache with TTL per vendor (respect rate limits, dedupe fan-out) | 🟡 | 🟡 | 1w | — | Fewer vendor calls; dodge rate-limit bans |
| PF-6 | UI bundle code-splitting per tab (single SPA chunk today) | 🟢 | 🟢 | 3d | — | Faster first paint, esp. packaged app |

### 2.6 Security (8)

| ID | Idea | Impact | Diff | Time | Deps | Benefit |
|---|---|---|---|---|---|---|
| SE-1 | Rate limiting + brute-force lockout on the web auth endpoint | 🔴 | 🟢 | 3d | — | Basic hardening for any non-localhost bind |
| SE-2 | Scoped API tokens (read-only / trading-approve / admin) replacing the single admin token | 🔴 | 🟡 | 2w | — | Safe remote/mobile access; least privilege |
| SE-3 | Audit log for every trading approval/push/reject (append-only, signed hash chain) | 🔴 | 🟡 | 1.5w | — | Forensic trail for money-capable actions |
| SE-4 | Secret-scanning pre-commit + CI job (gitleaks) tuned for broker/provider key shapes | 🔴 | 🟢 | 2d | DX-2 | Stops the worst class of leak at the door |
| SE-5 | Dependency audit gate in CI (pnpm audit + osv-scanner, fail on high) | 🟡 | 🟢 | 2d | — | Supply-chain baseline for a trading app |
| SE-6 | Workspace sandbox tightening: document + optionally enforce egress/env policy per template | 🟡 | 🔴 | 3w | AG-5 | Untrusted templates can't exfiltrate keys |
| SE-7 | Sealing-key rotation command + re-seal migration | 🟡 | 🟡 | 1w | — | Recover cleanly from suspected key exposure |
| SE-8 | Per-UTA trading limits (max order value/day, symbol allowlist) enforced in UTA, not Alice | 🔴 | 🟡 | 2w | — | Hard blast-radius cap under any agent bug |

### 2.7 Automation (7)

| ID | Idea | Impact | Diff | Time | Deps | Benefit |
|---|---|---|---|---|---|---|
| AU-1 | Inbound webhook trigger endpoint (`/api/hooks/:token` → dispatch named issue) | 🔴 | 🟡 | 1w | SE-2 | External events (TradingView alerts, CI, n8n) start runs |
| AU-2 | Market-event triggers (price cross, % move, earnings date) evaluated by a lightweight watcher → issue dispatch | 🔴 | 🔴 | 3w | AU-1 | "Wake the agent when it matters", not just cron |
| AU-3 | Run-chaining: issue A's completion (with success class) can enqueue issue B | 🔴 | 🟡 | 1.5w | AG-6 | Multi-step pipelines without a workflow engine |
| AU-4 | Quiet hours + market-calendar-aware scheduling (skip weekends/holidays per exchange) | 🟡 | 🟢 | 4d | — | Scheduled scans stop wasting runs |
| AU-5 | Concurrency groups for headless runs (per-workspace serial lanes; global cap stays) | 🟡 | 🟡 | 1w | — | No self-competing runs in one workspace |
| AU-6 | Outbound notification channels (Telegram/Slack/email) for Inbox pushes, config-gated | 🔴 | 🟡 | 1.5w | — | Reports reach users where they live |
| AU-7 | Dry-run mode for schedules (simulate next 7 days of fires without executing) | 🟢 | 🟢 | 3d | — | Debug schedule declarations safely |

### 2.8 Developer Experience (7)

| ID | Idea | Impact | Diff | Time | Deps | Benefit |
|---|---|---|---|---|---|---|
| DX-1 | Adopt a linter+formatter (Biome recommended: single tool, fast, TS-native) + `pnpm lint` in CI | 🔴 | 🟡 | 1w | — | Ends convention-by-vigilance; PR noise drops |
| DX-2 | Pre-commit hooks (lint, typecheck-changed, secret-scan) via lefthook | 🟡 | 🟢 | 2d | DX-1 | Fast local feedback; cleaner CI |
| DX-3 | Structured logging unification: pino sink in Alice main process, level env var, pretty dev transport | 🔴 | 🟡 | 1.5w | — | Debuggability across all three processes |
| DX-4 | `pnpm doctor` — one command validating node/pnpm/CLIs/auth/ports/locks with fixes | 🔴 | 🟡 | 1w | — | Self-service environment repair (esp. Windows) |
| DX-5 | Devcontainer + Codespaces config (Electron-skip preconfigured) | 🟡 | 🟢 | 3d | — | One-click contributor environment |
| DX-6 | Kill hand-synced `WireShape` duplication (shared `packages/` type or codegen) | 🟡 | 🟢 | 2d | — | Removes a latent drift bug |
| DX-7 | Split the four god-files along documented seams (routes/workspaces.ts first) | 🟡 | 🟡 | 2w | DX-1 | Reviewability; honors repo's own size rule |

### 2.9 Documentation (5)

| ID | Idea | Impact | Diff | Time | Deps | Benefit |
|---|---|---|---|---|---|---|
| DO-1 | Cookbook: 10 end-to-end recipes (earnings scanner, thesis tracker, sector rotation report…) | 🔴 | 🟡 | 1.5w | — | Converts curious users into daily users |
| DO-2 | Auto-generated tool-surface reference from ToolCenter inventory (build step → docs page) | 🟡 | 🟢 | 4d | — | Always-true tool docs; zero drift |
| DO-3 | Architecture Decision Records (ADR) directory seeded with the big five (no-loop, UTA split, loopback plane, file-backed, adapters) | 🟡 | 🟢 | 3d | — | Rationale survives contributor turnover |
| DO-4 | Video/gif walkthroughs embedded in README + docs site quick start | 🟡 | 🟢 | 4d | DO-1 | Show-don't-tell onboarding |
| DO-5 | Versioned public docs site pipeline (docs/ → openalice.ai/docs sync + version selector) | 🟡 | 🟡 | 1w | — | Docs match the release users actually run |

### 2.10 Infrastructure (6)

| ID | Idea | Impact | Diff | Time | Deps | Benefit |
|---|---|---|---|---|---|---|
| IN-1 | Metrics endpoint (Prometheus text format: runs, tool calls, UTA health, queue depths) | 🔴 | 🟡 | 1w | DX-3 | Observability foundation for everything else |
| IN-2 | Crash reporting opt-in (local ring buffer + user-initiated bundle export) | 🟡 | 🟢 | 4d | DX-3 | Actionable bug reports without telemetry creep |
| IN-3 | Backup/restore command (`alice backup` → tar of data/ with manifest; restore with migration replay) | 🔴 | 🟡 | 1w | — | Users trust the system with real state |
| IN-4 | Headless server profile hardening (systemd unit, Docker healthchecks, graceful-restart docs) | 🟡 | 🟢 | 4d | — | Always-on deployments become first-class |
| IN-5 | Auto-update channel discipline for desktop (stable/beta with staged rollout %) | 🟡 | 🟡 | 1w | — | Safe releases to a growing user base |
| IN-6 | State-size dashboard + retention jobs (news, scrollback, tool-call log, backups) | 🟡 | 🟢 | 4d | IN-1 | Disk usage stays predictable long-term |

### 2.11 Testing (7)

| ID | Idea | Impact | Diff | Time | Deps | Benefit |
|---|---|---|---|---|---|---|
| TE-1 | Fix Windows temp-dir flake (retry-rm helper in test utils) — restore 100% green CI trust | 🔴 | 🟢 | 1d | — | CI signal integrity |
| TE-2 | Coverage reporting + ratchet (fail PR if coverage drops; no fixed 80% cliff) | 🟡 | 🟢 | 3d | — | Sustainable coverage without gaming |
| TE-3 | Contract tests for `/api/*` ↔ `ui/src/demo/` handlers (schema-diff, fail on drift) | 🔴 | 🟡 | 1.5w | — | The demo surface stops silently lying |
| TE-4 | Broker-sim scenario suite (MockBroker scripted fills/partials/rejects) run in CI | 🔴 | 🟡 | 2w | — | Trading semantics regression-proof without live creds |
| TE-5 | Playwright E2E for the 5 golden paths (onboard, chat, issue+schedule, inbox, approve trade) | 🔴 | 🟡 | 2w | — | UI regressions caught pre-release |
| TE-6 | Property-based tests for money math (decimal.js paths in UTA) | 🟡 | 🟡 | 1w | — | Rounding/precision bugs die early |
| TE-7 | Nightly long-haul soak (24h dev stack under scheduled runs; leak/lock detection) | 🟡 | 🟡 | 1w | IN-1 | Stability confidence for always-on use |

### 2.12 Plugin System (6)

| ID | Idea | Impact | Diff | Time | Deps | Benefit |
|---|---|---|---|---|---|---|
| PL-1 | Formal extension manifest (`alice-extension.json`: templates+skills+tool-CLI decls, semver, permissions) | 🔴 | 🔴 | 3w | — | The contract everything else plugs into |
| PL-2 | Extension installer (`alice ext install <git-url>` → validated copy into OPENALICE_HOME, listed in UI) | 🔴 | 🟡 | 2w | PL-1 | Community can ship capabilities as satellites (invariant #3) |
| PL-3 | Template catalog UI backed by a community index repo (curated JSON) | 🟡 | 🟡 | 1.5w | PL-2 | Discoverability; ecosystem flywheel |
| PL-4 | Permission prompts per extension (which tool groups / trading access it may teach) | 🔴 | 🟡 | 1.5w | PL-1, AG-5 | Safe third-party ecosystem for a money-adjacent app |
| PL-5 | Extension update/pinning + lockfile (`extensions.lock.json`) | 🟡 | 🟡 | 1w | PL-2 | Reproducible installs; no surprise updates |
| PL-6 | Signed extensions (author key, verify on install; unsigned = loud warning) | 🟡 | 🔴 | 2w | PL-2 | Trust chain before any marketplace ambitions |

### 2.13 MCP (6)

| ID | Idea | Impact | Diff | Time | Deps | Benefit |
|---|---|---|---|---|---|---|
| MC-1 | Outbound MCP client: workspaces can declare external MCP servers in template manifest (validated, env-substituted) | 🔴 | 🟡 | 2w | PL-1 | Agents reach the whole MCP ecosystem safely |
| MC-2 | MCP resources support (expose entities/inbox/issues as MCP *resources*, not just tools) | 🟡 | 🟡 | 1w | — | Standards-aligned context loading for capable clients |
| MC-3 | MCP prompts support (ship reusable prompt templates per workspace surface) | 🟢 | 🟢 | 4d | — | One more standard surface; cheap |
| MC-4 | Authenticated remote-MCP profile (token-gated, TLS, explicitly opt-in — separate from the loopback plane, which stays untouched) | 🟡 | 🔴 | 2w | SE-2 | Claude.ai / remote clients can use OpenAlice tools |
| MC-5 | MCP conformance test suite pinned to protocol releases | 🟡 | 🟢 | 4d | — | Upgrades stop being scary |
| MC-6 | Tool result streaming for long operations (progress notifications) | 🟢 | 🟡 | 1w | — | Better agent UX on slow market queries |

### 2.14 n8n (5)

*(All external-bridge by design — invariant #3 forbids an embedded workflow engine.)*

| ID | Idea | Impact | Diff | Time | Deps | Benefit |
|---|---|---|---|---|---|---|
| N8-1 | Publish an n8n community node ("OpenAlice") wrapping the REST surface: dispatch issue, read inbox, list entities | 🔴 | 🟡 | 2w | AU-1, SE-2 | The whole n8n ecosystem becomes OpenAlice's I/O |
| N8-2 | Webhook-out on Inbox events (n8n-consumable JSON payloads, HMAC-signed) | 🔴 | 🟢 | 4d | AU-6 | Agent reports flow into any downstream automation |
| N8-3 | Recipe pack: 5 shipped n8n workflow JSONs (alert→issue, report→email, digest→Notion…) | 🟡 | 🟢 | 3d | N8-1 | Instant value demo; copy-paste adoption |
| N8-4 | n8n docker-compose profile beside OpenAlice's (one command, co-deployed) | 🟢 | 🟢 | 2d | N8-1 | Zero-friction pairing for self-hosters |
| N8-5 | Credential handshake doc + scoped-token flow for n8n (never the admin token) | 🟡 | 🟢 | 2d | SE-2 | Safe-by-default integration posture |

### 2.15 GitHub (6)

| ID | Idea | Impact | Diff | Time | Deps | Benefit |
|---|---|---|---|---|---|---|
| GH-1 | Workspace→GitHub remote sync (optional push of workspace repos to private remotes) | 🔴 | 🟡 | 1.5w | — | Off-host backup + review of agent work in familiar UI |
| GH-2 | GitHub-issue bridge (import labeled issues as workspace issues; status sync back) | 🟡 | 🟡 | 2w | AU-1 | Teams coordinate agent work where they already work |
| GH-3 | PR-review workspace template (agent reviews a PR diff, reports to Inbox) | 🟡 | 🟢 | 4d | — | Dogfood + a non-trading use case that widens audience |
| GH-4 | GitHub Actions trigger recipe (repo event → webhook → issue dispatch) | 🟡 | 🟢 | 2d | AU-1 | CI events become agent triggers |
| GH-5 | Release-notes agent (reads merged PRs since last tag, drafts CHANGELOG via cliff conventions) | 🟢 | 🟢 | 3d | — | Maintainer time saved every release |
| GH-6 | Gist/repo publishing tool for reports (share an Inbox report as a gist with one action) | 🟢 | 🟢 | 3d | GH-1 | Frictionless sharing of agent output |

### 2.16 Multi-agent (6)

| ID | Idea | Impact | Diff | Time | Deps | Benefit |
|---|---|---|---|---|---|---|
| MA-1 | Reviewer pattern: issue can declare `reviewer:` agent; run output goes to a second headless run before Inbox | 🔴 | 🟡 | 2w | AI-2, AG-1 | Adversarial checking of theses/trades — quality moat |
| MA-2 | Agent-to-agent task handoff tool (`issue_create` targeting a peer workspace, provenance-stamped) | 🔴 | 🟡 | 1.5w | AG-5 | Decomposition without a central orchestrator |
| MA-3 | Shared blackboard entity type (structured claim/evidence records multiple agents append to) | 🟡 | 🟡 | 1.5w | ME-3 | Debate/consensus substrate on the memory graph |
| MA-4 | Fan-out issue type (one issue → N parameterized runs, e.g. per-ticker; aggregated report) | 🔴 | 🟡 | 2w | AU-3, AU-5 | Portfolio-wide scans become one declaration |
| MA-5 | Committee approval for trades (N-of-M agent + human sign-offs recorded in the approval gate, enforced in UTA) | 🟡 | 🔴 | 3w | SE-3, MA-1 | Highest-trust execution path in the category |
| MA-6 | Cross-CLI ensembles (same issue run by claude+codex, diff report highlighting disagreement) | 🟡 | 🟡 | 1.5w | MA-4 | Model disagreement = signal; unique differentiator |

### 2.17 Knowledge Base (6)

| ID | Idea | Impact | Diff | Time | Deps | Benefit |
|---|---|---|---|---|---|---|
| KB-1 | Document ingestion pipeline (PDF/HTML filings → markdown → entity-linked notes) | 🔴 | 🔴 | 3w | ME-1 | Filings/research become agent-usable memory |
| KB-2 | News→entity auto-linking (archive items tagged to tracked entities at collection time) | 🔴 | 🟡 | 1.5w | ME-1 | "All news about my holdings" becomes a query |
| KB-3 | Obsidian-vault interop mode (open the entity store as a valid vault; respect its frontmatter) | 🟡 | 🟡 | 1.5w | — | Power users bring existing PKM habits |
| KB-4 | Daily/weekly digest generator (scheduled agent summarizing deltas across the KB) | 🟡 | 🟢 | 4d | ME-7 | Compounding value from accumulated memory |
| KB-5 | Source citation contract (inbox reports carry structured source URLs; UI renders provenance) | 🔴 | 🟡 | 1w | AI-2 | Trustable research; the anti-hallucination surface |
| KB-6 | KB export/import bundles (share a curated sector graph as a package) | 🟢 | 🟡 | 1w | PL-1 | Community knowledge exchange |

---

## 3. Phased Roadmap

Sequencing logic: **(1)** make the signal trustworthy and the platform safe,
**(2)** deepen the product loop (memory + automation) that makes daily use
compound, **(3)** open the ecosystem once contracts are stable, **(4)** scale
trust and scope. Each phase's items unblock the next; IDs in *italics* are the
critical path.

### Phase 1 — Foundations & Trust (0–3 months)

Theme: every later phase builds on green CI, structured logs, scoped auth, and
enforced conventions. Cheap, compounding, mostly parallelizable.

| Order | Items | Why now |
|---|---|---|
| 1 | *TE-1*, *DX-1*, DX-2, SE-4, SE-5 | CI signal + conventions + supply-chain gate — everything else reviews faster |
| 2 | *DX-3*, IN-1, IN-2, DX-6 | Observability spine; kill the enum drift while small |
| 3 | *SE-1*, *SE-2*, SE-3, SE-8 | Auth scoping + audit + blast-radius caps precede ANY remote/integration work |
| 4 | AG-2, AG-3, AG-6, AU-4, AU-7 | Automation reliability: timeouts, retries, outcome classes |
| 5 | DX-4, DX-5, UI-1, UI-7, TE-2, TE-3 | Onboarding + health surface + contract tests |
| 6 | AI-4, AI-5, AI-8, AG-8, DO-3, PF-4 | Small wins batched behind the big rocks |

**Exit criteria:** CI 100% green on all OSes; zero `console.*` in `src/`;
scoped tokens shipped; headless runs never zombie; a new contributor lints,
commits, and boots with `pnpm doctor` alone.

### Phase 2 — Product Depth: Memory & Automation (3–6 months)

Theme: the compounding loop — richer memory, event-driven automation, legible
runs. This is where daily-use value bends upward.

| Order | Items | Why now |
|---|---|---|
| 1 | *ME-1*, *ME-2*, ME-3, ME-4 | Semantic memory is the platform bet of this phase |
| 2 | *AU-1*, AU-3, AU-5, AU-6, N8-2 | Inbound triggers + chaining + outbound notify = real automation |
| 3 | *AI-2*, AI-3, AI-1, AG-1, AG-5 | Structured outputs + cost visibility + roles/permissions |
| 4 | UI-3, UI-2, UI-5, UI-8, KB-5 | Legibility: timelines, palette, provenance, approval UX |
| 5 | KB-2, ME-5, ME-6, PF-1, PF-3, PF-5, IN-3, IN-6 | KB auto-linking + store health + perf hygiene |
| 6 | TE-4, TE-5, TE-6, DO-1, DO-2, DX-7 | Trading-sim suite, golden-path E2E, cookbook; split god-files as they're touched |

**Exit criteria:** an external event can trigger an agent whose structured,
cited report lands in a notification channel; "what do we know about X?"
answers semantically; trading approvals show full provenance.

### Phase 3 — Ecosystem & Integration (6–12 months)

Theme: open the contracts. Extensions, MCP both directions, n8n, GitHub,
first multi-agent patterns. Requires Phase 1 security + Phase 2 structured
outputs.

| Order | Items | Why now |
|---|---|---|
| 1 | *PL-1*, *PL-2*, PL-4, PL-5 | The extension contract precedes everything third-party |
| 2 | *MC-1*, MC-2, MC-3, MC-5 | Outbound MCP makes every ecosystem tool an agent capability |
| 3 | *N8-1*, N8-3, N8-4, N8-5, GH-4 | n8n node + recipes = distribution channel, not just a feature |
| 4 | GH-1, GH-2, GH-3, GH-5, GH-6 | GitHub as backup/review/trigger surface |
| 5 | *MA-1*, MA-2, MA-4, AG-4, MA-6 | Reviewer, handoff, fan-out — multi-agent on stable rails |
| 6 | AI-6, AI-7, KB-1, KB-3, KB-4, UI-4, PL-3, DO-4, DO-5, IN-4, TE-7, MC-6, PF-2, PF-6 | Adapter breadth, eval harness, ingestion, graph UI, catalog, soak |

**Exit criteria:** a third party ships a working extension without touching
`src/`; an n8n workflow drives OpenAlice end-to-end; reviewer-gated runs are
the default for thesis issues.

### Phase 4 — Scale, Trust & Frontier (12+ months)

Theme: the highest-trust autonomous system in the category, reachable from
anywhere, extensible by a community.

| Order | Items | Why now |
|---|---|---|
| 1 | MA-5, SE-6, SE-7, PL-6 | Committee trades, sandbox enforcement, key rotation, signed extensions |
| 2 | MC-4, UI-6, IN-5, AG-7 | Authenticated remote MCP + mobile + staged desktop rollout + managed runtimes |
| 3 | ME-7, MA-3, KB-6, AU-2, IN-6 | Digest memory, blackboards, KB exchange, market-event triggers at scale |
| 4 | Frontier (new investigation): hosted TraderHub seam expansion, multi-user workspaces, portfolio-level agent P&L attribution, backtest-graded agent leaderboards | Only after the trust substrate above exists |

**Exit criteria:** a real-money trade can require N-of-M sign-off with a signed
audit chain; the system is safely operable from a phone; the extension index
has external contributors.

---

## 4. Ideal Implementation Order (critical path)

```
TE-1 → DX-1/DX-2 → DX-3 → IN-1 → SE-1/SE-2 → AG-2/AG-3 → UI-1/UI-7
  → ME-1 → ME-2/ME-3/ME-4 → AI-2 → AU-1 → AU-3/AU-6 → KB-5/KB-2
  → PL-1 → PL-2/PL-4 → MC-1 → N8-1 → GH-1/GH-2 → MA-1 → MA-4
  → MA-5 → MC-4/UI-6 → frontier
```

Rules of thumb while executing:

- **Never let integration outrun security**: SE-2 before AU-1/N8-1/MC-4;
  AG-5/PL-4 before any third-party extension runs.
- **Structured outputs (AI-2) are the hinge** between "agents write prose" and
  every pipeline/multi-agent/eval idea — do not defer it past Phase 2.
- **Refactors ride features** (DX-7 splits god-files as their surfaces are
  touched), never as standalone rewrites.
- **Everything stays inside the three invariants.** If an idea seems to need an
  in-process loop, an Alice-side trading write, or new engine machinery — the
  design is wrong, not the invariant.
