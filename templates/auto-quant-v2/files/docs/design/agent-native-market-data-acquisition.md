# Agent-native market-data acquisition

Status: accepted at `0.8.31`; demand-led completion hardened for `0.9.6`.

Related: [[docs/design/research-intake-and-dataset-snapshots]],
[[docs/design/workspace-project-boundaries]],
`docs/market-data-acquisition-field-trials`, and
`plans/market-data-acquisition-skills`.

## Purpose

AutoQuant turns market-data acquisition into a discoverable coding-Agent
procedure while keeping provider networking outside Core. The same installed
Harness supplies a small market router, narrow provider Skills, and a common
packaging Skill to every initialized Workspace.

```text
research question
→ acquire-market-ohlcv
→ one market reference
→ two suitable provider Skills
→ retained raw bytes and provider audits
→ same-semantics numerical or cross-semantics coverage comparison
→ package-autoquant-ohlcv
→ optional explicit calendar-derived V4 daily → V5 close-time materialization
→ optional complete compatible V5 packages → V6 multi-source composition
→ strict Project intake
→ content-locked Project snapshot
```

Core starts at the dataset-package boundary. It validates paths, schemas,
OHLCV invariants, market clocks, interval semantics, and content identity. It
does not authenticate a provider's venue, adjustment, volume, calendar,
terms, or redistribution claim.

## Demand-led dataset principle

Available local data never defines the research question. The caller's
question first determines the complete universe, context assets, interval,
history, market clock, and adjustment contract; acquisition then supplies one
internally coherent snapshot for that exact need.

Previously staged bytes are only a possible input source. An Agent must still
verify that they satisfy the complete current contract. It must not shrink a
universe, shorten a horizon, omit context, mix incompatible vintages, or
otherwise reshape research around local inventory. When coverage is partial
or alignment is uncertain, acquiring or completing the task-specific package
is preferable to preserving download reuse.

Task-local duplication is acceptable evidence isolation. Deduplication may be
added later as a transparent storage optimization, but it must never become
research authority, automatic dataset selection, or a reason to constrain the
caller's question.

The reusable Workbench assets are provider-selection knowledge, acquisition
Skills, audit procedures, packaging rules, and immutable dataset identity—not
a centrally curated stock of supposedly universal market data. This keeps
research demand-led while preserving exact evidence for each Run.

## Canonical Skill bundle

Canonical Skill bytes live under `autoquant/workspace_skills/` and ship in the
wheel. Workspace creation transactionally materializes the same bytes under
`.agents/skills/` and `.claude/skills/`, then records every file hash in
`autoquant-skills.json`. Generated discovery copies are not edited by hand.

`acquire-market-ohlcv` is the only regional catalogue an Agent needs to read
first. It loads one relevant market reference, then invokes exact provider and
packaging Skills. Provider scripts are bounded, parameterized procedures, not
a stable downloader SDK or a Core compatibility promise.

Every bundled Python procedure is invoked through `aq-python`. This small
runtime bridge executes the script with the interpreter that owns the current
AutoQuant installation, so a coding Agent cannot accidentally select a system
Python merely because its command shell reset `PATH`. Skill instructions must
not ask an Agent to repair that mismatch by installing packages globally or
into a user site. `aq-python` does not turn acquisition into Core or hide the
script: the script path, arguments, provider bytes, and audit remain explicit.

## Source-diversity rule

Every accepted market or explicitly named venue has at least two
independently executable sources. The routes are peers selected by the
research need, not a hard-coded primary/fallback chain. Selection considers:

- venue authority and symbol identity;
- completed-session freshness and history;
- raw, split-adjusted, or split-and-dividend-adjusted price meaning;
- volume unit and trade-scope evidence;
- missing and suspended observations;
- credentials, rate limits, access behavior, and terms;
- retained response and transformation audit quality.

An official route is listed first when it is practically accessible. Taiwan,
for example, begins with official TWSE; FinMind is an independently executable
aggregator route, and Yahoo is a broad split-adjusted route.

Source plurality is not semantic equivalence. Raw and adjusted packages are
never relabelled to permit comparison. When contracts match, the common
comparison tool records date overlap, OHLC tolerances, volume ratios, missing
rows, and exact package hashes. When adjustment contracts differ, its explicit
`coverage-only` mode records row/date overlap, first/last observations,
freshness, and zero-volume counts while emitting no numerical price or volume
comparison. Default numerical mode still fails closed on the mismatch.

Mainland raw Skills accept caller-verified listed `equity` and `fund` assets.
They preserve every asset's class and summarize a mixed package truthfully;
provider codes and prefixes never infer instrument class.

## Evidence and lifecycle

Acquisition writes to explicit Workspace staging, never directly into a
Project. A package may later become either initial Project authority or one
Study's independently owned authority:

```text
workspace/
├── staging/market-data/<dataset-id>/
│   ├── raw/
│   ├── normalized CSVs
│   ├── provider-audit.json
│   └── dataset-package.json
└── projects/<project-id>/data/ohlcv/
    ├── normalized content-locked inputs
    └── snapshot.json

# Same-Project distinct question:
projects/<project-id>/data/studies/<study-id>/ohlcv/
├── normalized content-locked inputs
└── snapshot.json
```

The provider audit retains request URIs, observed retrieval time, raw hashes,
response metadata, conversions, dropped placeholders, anomalies, and
limitations. Staging remains caller/host-owned working evidence. A package
becomes quantitative input authority only after strict `aq project intake`
creates the Project-root normalized snapshot, or
`aq study create --request ... --dataset ...` creates a Study-owned snapshot,
and Project validation passes.

Provider-shape rejection remains the default. A narrow provider Skill may
offer an explicit audited observation-drop policy for isolated impossible OHLC
geometry caused by provider rounding after adjustment. Such a policy preserves
the exact raw response and removed date/OHLCV, never clamps or reconstructs a
price, applies a small hard quality bound, and records the resulting aligned
panel loss. It is a caller/research-contract choice, not a silent fallback;
Core's packaged OHLCV invariants remain strict.

The same fail-closed rule applies to a short temporary provider scale island:
a large entry discontinuity followed within a few observations by its inverse
and recovery near the original scale. This is distinct from an ordinary large
return or a persistent corporate-action regime. A provider Skill may expose a
separate explicit bounded observation-drop policy only when it keeps exact raw
rows and boundary ratios, never rescales prices, enumerates every affected
asset in its top-level audit, and discloses common-panel loss. Persistent scale
changes still require independent corporate-action/provider evidence rather
than automatic repair.

Historical intraday provider labels are also not assumed to be AutoQuant bar
closes. The Yahoo XNYS `1h` route preserves its bucket-start timestamps, maps
only exact expected starts to the pinned calendar's completed close (including
the short terminal bucket), and emits V3 only after every requested asset has
the full aligned session panel. It requests a one-hour warmup because starting
exactly on the first provider bucket was observed to zero its volume; that
warmup counts against the provider's trailing 730-day range.

An HTTP-successful intraday response may still be only failure evidence. Null
expected rows, early-close close markers, ordinary gaps, duplicates,
off-grid/in-session extras, or a single deficient asset create
`provider-failure.json`, retain raw response hashes, return nonzero, and create
no package. The procedure does not delete a session, reconstruct a terminal
bar, change interval, or fall back to observed-only semantics. A daily peer
does not become independent hourly confirmation merely because it names the
same asset.

Date-only daily rows are also not exact completed-close authority. For a
cross-market Factor question, a provider route may first retain one V4
observed-only package whose per-asset session dates came from the provider's
returned exchange timezones. Its top-level mixed-market claim is the neutral
`provider-observed`/UTC container; it must not pretend every asset follows one
named exchange calendar.

The packaging Skill supplies the canonical conversion from that V4 surface to
close-time-aware V5. The caller/Agent authors one strict authority manifest
that binds the exact source package hash, pins the installed
`exchange_calendars` version, and names every asset's canonical calendar,
timezone, and volume semantics. The bundled
`materialize_daily_close_time.py` maps each observed date to that calendar's
scheduled regular close, preserves all OHLCV and absent rows, and publishes a
transactional V5 package plus a transformation audit. The audit records source
and output hashes, observed-date and scheduled-timestamp hashes, real UTC close
transitions, and explicit limitations.

Unknown calendars, alias names, timezone or inventory mismatches, non-session
dates, unsafe paths, source-contract drift, or an occupied output fail before
the output directory is published. The procedure never infers authority from
a symbol or venue, appends a fixed nominal clock, aligns markets, fills
absence, drops rows, or authenticates an exchange. Core still begins at the
generated V5 package boundary and does not load the transformation audit as
hidden runtime authority.

When the exact question needs different provider routes for different assets,
each route remains a complete independently audited V5 package. The packaging
Skill's `compose_observed_packages.py` binds at least two exact source-manifest
hashes, requires disjoint symbols and compatible close/interval/panel/market/
adjustment authority, copies every asset byte, and publishes V6 plus
`composition-audit.json` transactionally. Each output asset names its source;
each source retains its own provider claim. The procedure never fabricates a
shared provider, subsets a source, aligns or fills rows, transforms prices, or
resolves conflicts. Core begins at the V6 boundary and independently checks
the same structural claims.

Canonical research symbols belong to the cross-provider dataset contract;
route-specific lookup codes do not. Peer Japanese packages therefore retain a
shared symbol such as `7203.T` while a Nikkei route separately records `7203`
as its provider code. Comparison fails closed rather than inventing aliases.

In the repository-root desk, `staging/` and each Project's `data/` and cache
are Git-ignored persistent local evidence. Agents do not force-add ordinary
provider bytes or normalized market data. The checked-in sample's small
deterministic fixture is a teaching/distribution exception, not a precedent
for real Projects. Briefs, contracts, source, Runs, Reports, and Dossiers
remain ordinary Git-managed research state; provider redistribution terms and
an explicit caller request govern any deliberately distributable data fixture.

Changing markets does not require a new Workspace. Separate research
questions normally become sibling Projects; their immutable snapshots may
currently duplicate bytes. A shared mutable “latest data” cache is not part of
this contract, and duplicate task-coherent snapshots are acceptable.

Revisiting the same question after another completed session does not require
a duplicate Project either. The initial Project-root snapshot remains its
construction record; a continuation may bind a complete newer package under a
Study-owned data namespace. Each vintage is immutable evidence with its own
request boundary and content hash, even when most rows duplicate the prior
vintage. Download reuse is an implementation convenience, never research
authority: an Agent must fill the exact current request and verify alignment
rather than limit the question to whatever happens to be on disk.

## Failure behavior

Provider access is expected to degrade. A route stops truthfully on blocking,
shape changes, ambiguous symbols, stale or truncated output, or contradictory
semantics. It records the failure and may try another named peer route, but it
never silently changes adjustment, venue, interval, or authority claims.
The router's bounded route-attempt wrapper preserves one standard
`autoquant-provider-route-failure` record for a nonzero or unlaunchable
provider command, including its provider id, attempt time, exit status, and
bounded stdout/stderr tails. A failure record is local route evidence, not a
claim that the provider was globally unavailable.

When a provider route can safely preserve more specific response evidence, it
does so before returning nonzero. The TWSE monthly Skill writes one
`provider-failure.json`, a per-request attempt receipt, selected non-secret
response headers, and exact HTTP error bodies. The generic route receipt stays
beside this provider-specific evidence. This avoids asking an Agent to probe a
blocked endpoint again merely to reconstruct the response, while deliberately
excluding cookies or other authentication-bearing headers. A provider failure
never creates a dataset package or intake authority.

The first field-trial matrix proves named U.S., XSHG/XSHE/XBSE, Tokyo, KRX,
TWSE, HOSE, and XPAR routes. It does not imply all securities, TPEx, all
Vietnamese boards, one synthetic European calendar, survivorship-free
universes, delisted history, futures rolls, live feeds, or redistribution
rights.

## Trading boundary

Acquisition and research intake grant no account, Broker, Order, TP/SL, or
trading authority. AutoQuant may later produce factor or target-weight
evidence from the locked dataset. OpenAlice or another execution-facing
system remains responsible for live state, suitability, execution planning,
and user authorization.
