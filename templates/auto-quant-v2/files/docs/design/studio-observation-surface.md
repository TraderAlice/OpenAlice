# Studio observation surface

Status: V1 implemented.

Related: [[docs/ARCHITECTURE]], [[docs/CLI]], [[docs/PROJECT_FORMAT]],
[[docs/design/agent-cli-contract]], [[docs/design/research-session-loop]],
[[docs/design/external-researcher-driver]],
[[docs/design/research-intake-and-dataset-snapshots]],
[[docs/design/request-bound-portfolio-mandates]],
[[docs/design/portfolio-risk-governor]],
[[docs/design/executed-book-risk-compliance]],
[[docs/design/portfolio-liquidity-capacity]],
[[docs/design/reported-position-book-risk]], and
[[docs/design/quant-research-lifecycle]].

## Scope

This document owns the Studio snapshot, read-only HTTP boundary, standalone or
host-assigned launch authority, presentation responsibilities, and the
distinction between immutable evidence and mutable execution progress.

It does not own research decisions, evaluation, source mutation, promotion,
remote hosting, authentication, or cloud persistence.

## Ownership

Studio has three layers:

```text
AutoQuant Core loaders
→ versioned Studio snapshot
→ CLI JSON or local read-only HTTP
→ packaged browser presentation
```

Core loaders remain authoritative for Project confinement, Study identity, Run
and Experiment integrity, Session authority, and Campaign hashes. The snapshot
normalizes those verified objects for observation. The HTTP server and browser
must not reimplement validators or inspect arbitrary Project files.

The browser may sort, filter, select, render, and copy an exact Core-generated
CLI command. It cannot create metrics, change verdicts, execute commands,
publish Reports, or write Project state. Clipboard copy grants no new
authority.

## Snapshot contract

One snapshot represents either:

- every immediate Project in a Workspace; or
- one direct Project.

It records its schema version, generation time, source scope, Workspace
identity when present, and ordered Project observations. Each Project contains:

- identity, description, research program, and validation diagnostics;
- verified pre-Session request intake, dataset snapshot, and exact
  Session-start command when present;
- latest verified baseline decision metrics, with selection versus visible
  audit/stress roles preserved rather than collapsed into one score;
- verified Portfolio Mandate direction, construction, complete asset-role
  vector, authorized/context-only assets, long/short side limits, cash/cap,
  benchmark, and fixed identity when available;
- latest verified governed RL baseline, fold/seed, training, action, and
  implementation projection when available;
- latest verified reported-position Book Risk projection when available,
  including its explicit unauthenticated-position boundary;
- verified Study and Run summaries;
- verified Session snapshots and Experiment histories;
- verified delegated requests and derived Research Briefs;
- verified terminal Campaign summaries;
- verified immutable Research Report summaries;
- verified frozen-holdout source/later evidence and immutable Agent Assessment
  summaries, with `completed` and `assessed` kept distinct;
- explicitly mutable active Campaign progress;
- exact CLI commands for copy-only human/Agent handoff;
- counts and a normalized recent-evidence timeline derived from those objects.

Failure to verify one evidence category never turns unverified bytes into
display data. The category returns no claims plus structured diagnostics, while
other independently verified categories remain observable.

## Mutable Researcher progress

Terminal Runs, Experiments, Campaigns, and Research Reports are immutable
evidence. A Report remains valid when its Session later adds evidence because
it freezes a verified chronological prefix. A currently executing external
Researcher needs a different contract.

Before invoking a Researcher turn, Campaign execution writes a strict
`progress.json` inside the hidden Campaign staging directory. It records:

- Campaign and Session identity;
- `running` status and current phase;
- start/update timestamps and current turn;
- declared turn, wall-clock, and per-turn budgets;
- completed Experiment ids and verdict counts;
- only the hash of the external command.

Progress is mutable operational telemetry and is always labelled as such.
Studio reads it through a strict Research module loader. It never uses progress
to infer a verdict or completed Campaign. On terminal publication the final
progress file becomes manifest-pinned Campaign evidence.

A stale hidden staging directory may represent an interrupted process. V1
shows its last update rather than claiming liveness.

## Local HTTP boundary

`aq studio serve` binds to `127.0.0.1` by default. It exposes only:

- the packaged application shell and fixed CSS/JavaScript assets;
- a health response;
- the versioned snapshot response.

There is no arbitrary path, artifact download, mutation, command, or shell
endpoint. Standalone responses set a restrictive Content Security Policy,
disable sniffing and framing, set `X-Frame-Options: DENY`, and retain
same-origin resource policy. Binding to a non-loopback address is an explicit
operator choice and V1 has no authentication.

## Harness capability launch

The repository-root `harness.json` is the host discovery surface. Its manifest
protocol version is distinct from the AutoQuant product version. The one
declared `studio` capability executes `uv run --frozen --no-sync aq studio
serve . --no-open` from the Workspace root, requests a named `http` port, and
uses `/api/v1/health` for readiness. The source Workspace is independently
prepared with `uv sync --frozen`; capability launch selects that owned
environment without activating `.venv`, changing `PATH`, modifying the lock,
or synchronizing dependencies. Missing preparation is an explicit startup
failure. The health route returns HTTP 200 only after the server is listening
and identifies `service: autoquant-studio`.

`HARNESS_CAPABILITY=studio` alone activates managed launch resolution. In that
mode, `HARNESS_HOST` is required and `HARNESS_PORTS` must be an unambiguous
JSON object whose names match the manifest exactly: one integer `http` value
in `1..65535`, with no missing or extra name. The injected host must be exact
`localhost` (case-insensitive) or a canonical IPv4 loopback literal in
`127.0.0.0/8`. Wildcard, interface/public, arbitrary hostname, IPv6,
whitespace, and malformed authority fail before server construction.
AutoQuant binds exactly the accepted host and port. It never probes or
increments another port. An explicitly supplied `--host` or `--port` may
repeat injected authority but cannot conflict with it. Port bind failure
remains a process startup failure. `HARNESS_NO_OPEN=1` forces browser
suppression.

The resolved `managed` state is passed explicitly from launch resolution
through CLI, server construction, and response-header generation. Managed
responses omit `X-Frame-Options` and same-origin
`Cross-Origin-Resource-Policy`; their CSP admits only `app:`, loopback HTTP,
`localhost`, and localhost-subdomain ancestors. It never uses unrestricted
`frame-ancestors *`. Standalone responses keep the original strict policy.
The server never infers mode from `Host`, origin, or bind address.

When the capability value is absent or anything other than `studio`, every
Harness capability variable is irrelevant to Studio. The standalone command
retains `127.0.0.1:8765`, explicit `--host`/`--port`, port `0` OS allocation,
and ordinary browser behavior. Former vendor-specific environment names also
have no launch authority. This narrow adapter changes no snapshot, research,
or evidence semantics and requires no OpenAlice or supervisor SDK.

## Web origin and proxy boundary

Studio serves its document at `/`. Its packaged HTML uses same-origin root
paths for CSS, JavaScript, snapshot JSON, and the optional direct JSON link;
JavaScript polls `/api/v1/snapshot`. It contains no fixed localhost origin,
internal-port redirect, cookie, Authorization, CSRF, SSE, or WebSocket
dependency. A compatible supervisor may therefore route the entry listener
behind an opaque public origin such as an `oa-surface-*.localhost` host without
teaching AutoQuant that origin.

Studio currently has no SSE or WebSocket route. If either becomes a real
product requirement, it must remain same-origin, derive `ws` versus `wss` from
the current page where applicable, and receive its own streaming-capable proxy
acceptance test. V1 does not add an unused transport or public-origin field.

## Presentation priorities

The first viewport answers:

1. Which research Projects exist?
2. Which Sessions are active, and what is each current leader?
3. Are external Researchers running, stopped, failed, or budget-exhausted?
4. Which hypotheses were kept, reverted, or crashed?
5. What did the caller ask, is its dataset content-locked, and are the lane
   Reports and Project Dossier ready?
6. What exact headless command advances or inspects the work?
7. What verified evidence changed most recently?

The visual system is a dense quant research desk rather than a generic admin
dashboard or a static report. The persistent rail names the current
Workspace → Project → Study → Run context and provides section navigation
through the long evidence surface. It supports keyboard focus, narrow screens,
reduced motion, empty Projects, invalid evidence diagnostics, manual refresh,
and bounded automatic refresh.

Before a delegated Session exists, the first viewport prioritizes mandate,
requested assets versus research universe, dataset authority, immutable
baseline evidence, and the exact next headless action. Generic object counts
must not displace available quantitative evidence. Sign alone is not a
promotion threshold: the browser may mark negative return/risk evidence as
adverse, but it must not colour a positive factor or portfolio value as
successful unless Core exposes an explicit verified pass decision.

A frozen target remains visibly unfinished after its one-shot Runs publish.
Studio renders the Core-verified source/later comparison, then routes to the
Agent-authored Assessment. Only `assessed` is the terminal research handoff;
`completed` means the evidence exists but the caller's question has not yet
received a durable interpretation. The browser displays declared overall and
lane judgments as Agent analysis, never as a Core threshold, promotion, or
trading decision.

For a multi-Study Quant Research Program, the Project viewport is a research
cockpit rather than the report page of whichever Run happens to be selected.
It presents the current evidence chain in causal order:

1. validation rank IC asks whether the candidate factor predicts;
2. costed validation net Sharpe asks whether the mechanical portfolio preserves
   useful evidence after implementation; and
3. validation advantage versus the Judge-selected baseline asks whether the RL
   policy adds value beyond simpler fixed or contextual policies.

Those values remain descriptive projections of verified Run evidence. Browser
code may state exact relationships such as negative IC or trailing a baseline
and may visually mark them adverse. It cannot infer that a positive sign
passes uncertainty, robustness, minimum-improvement, or promotion gates. The
recommended lane and CLI action come from the verified Research Program status,
not from a browser-side workflow decision.

The cockpit shows all program lanes together, then exposes one complete bounded
Factor, Portfolio, or RL explorer at a time. Lane selection changes only
presentation and the accessibility tree; it does not select a model, Run,
baseline, validation split, or Judge outcome. An unbound collaboration handoff
is compact, while a caller-bound intake or delegated Session retains the full
request → evidence → report surface.

A standalone Book Risk Study appears as its own evidence lane rather than as
historical model-target Portfolio evidence. Studio shows effective risk bets,
first-PC share, component-risk HHI, lookback stability, contributor and
standardized-reduction rankings, correlations, rolling context, fixed
static-weight drawdown/equity evidence when emitted by the Run, and any
caller-supplied complete-book comparisons from the strict Core projection.
Pre-`0.8.19` Runs remain inspectable with drawdown explicitly unavailable.
Scenario rows show same-window deltas and primary-window per-asset
weight/risk-share changes; JavaScript does not calculate or rank them. The
current Workspace → Project → Study → Run rail must recognize this descriptive
Run even though it has no Factor/Portfolio/RL metric layer. Every Book Risk
view states that reported and hypothetical weights are unauthenticated and
that reduction/scenario evidence is neither optimization nor an order.
The intake Handoff path is `REQUEST → DATASET → FIXED RUN → REVIEW`; a
successful Book Risk Run never advertises Session creation. Below 680px, the
scenario and contribution comparisons become labeled cards rather than
compressing six evidence columns into unreadable table cells.

A standalone Book Path Stress Study is a separate fixed evidence lane. Studio
shows the total complete-window population, selected non-overlapping episodes,
terminal and worst-interim losses, dominant holdings, and exact terminal
contribution ledger from Core's strict `book-path-stress-diagnostics` read
model. It never derives ranking, path returns, overlap, or attribution in
JavaScript and never relabels Book Risk's constant-weight drawdown as this
fixed-unit method. The handoff path is
`REQUEST → DATASET → FIXED PATH STRESS RUN → REVIEW`, with no Session,
forecast, account, optimization, Order, or trading authority.

Selecting an evidence lane also selects that lane's latest Session in the
Inspector so the visible Run, Report, and Session remain semantically aligned.
The Portfolio and RL explorers disclose the same fixed mandate. Context-only
assets are visibly distinct and may never appear as current positions. The
Portfolio explorer also shows the annualized ceiling, validation activation
rate, current governor status/scale, pre/post forecast, and raw-to-governed
target transition. Separately, Portfolio and governed-RL explorers expose the
final post-drift book's risk-forecast coverage, pretrade breaches, risk-only
rebalance overrides, executed breaches, current ceiling, and execution reason.
The Portfolio explorer also shows the validation 1% capacity p10, trade-date
coverage, and latest rebalance binding asset from the verified causal
dollar-volume ledger. These are historical research weights and diagnostics,
not live account risk, impact, or fill evidence.

Before the performance path, the Portfolio explorer presents the latest
verified decision in the same order as the mechanical policy: signal state,
target plus covariance scaling, portfolio execution gate, and final historical
book. Its per-asset table shows every state transition still permitted by the
Mandate, the current percentile-point buffer to each boundary, raw/governed
target, drifted/executed weight, and actual reason. The browser only formats
Core's reconciled object. The buffer is explicitly not a price target or
probability, and the panel is labelled `RESEARCH WEIGHTS · NO ORDER AUTHORITY`.

For a request-driven canonical Program, the collaboration surface composes no
evidence in the browser. Core supplies Dossier readiness, lane Report
currentness, explicit optional omissions, blockers, latest immutable summary,
and exact next command. The visible flow is
`request → lane Reports → Project Dossier → reviewer or collaborating Agent`.
A selected Session may change the evidence Inspector, but it does not demote
the overall delivery state back to a single-lane Report.

## Invariants

1. Studio never bypasses a Core loader for completed evidence.
2. Immutable and mutable states are visually and structurally distinct.
3. Snapshot and HTTP output are versioned and deterministic apart from
   generation time and current progress.
4. One invalid category cannot silently corrupt another category's claims.
5. Browser presentation performs no Project writes or command execution.
6. Server routes are fixed and read-only.
7. The packaged application has no network or CDN dependency.
8. CLI and HTTP expose the same snapshot builder.
9. Cross-lane cockpit labels describe verified relationships and never create
   a pass, rejection, KEEP, or promotion verdict.
10. Evidence-lane selection hides presentation detail only; every claim still
    comes from the same Core-projected snapshot.
11. Evidence lane and Inspector Session stay aligned; browser selection cannot
    combine one lane's explorer with another lane's Report.
12. Studio projects executed-book risk only from Core-reconciled immutable
    rows and never treats a risk override as trading permission.
13. Managed launch consumes the exact manifest-matched host-assigned ports or
    fails; standalone launch is unaffected unless the generic Studio
    capability marker is exact.
14. Only explicit managed state relaxes framing, and only to the fixed Harness
    ancestor allowlist; standalone anti-frame protection never depends on a
    request header or guessed origin.

## Known gaps

- There is no progress event stream; the browser polls the bounded snapshot.
- Progress does not prove the originating process is still alive.
- Portfolio, Factor, and governed RL Runs have artifact-specific bounded
  explorers.
- Studio operations remain read-only.
- Remote and multi-user serving are not supported.
