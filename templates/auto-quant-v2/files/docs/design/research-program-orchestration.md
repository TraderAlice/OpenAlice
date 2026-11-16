# Research program orchestration

Status: implemented.

Related: [[docs/design/quant-research-lifecycle]],
[[docs/design/research-intake-and-dataset-snapshots]],
[[docs/design/ohlcv-factor-lab]],
[[docs/design/portfolio-construction-lab]],
[[docs/design/request-bound-portfolio-mandates]],
[[docs/design/caller-owned-factor-population]],
[[docs/design/rl-factor-policy-lab]], and
[[docs/design/evidence-gated-research-progression]], and
[[docs/design/studio-observation-surface]].

## Purpose

One investment question may require several fixed evaluation questions. The
Project owns the evolving question and source; Studies own distinct immutable
evaluation authority.

The first canonical research program is:

```text
caller request + one content-locked OHLCV snapshot
        │
        ├─ factor-quality
        │    causal predictive evidence
        │
        ├─ portfolio-quality
        │    same factor → mechanical state → target weights → costs/risk
        │
        └─ governed-rl-policy
             locked candidate + references → adaptive-policy value-add challenge
```

The lanes are coordinated but do not collapse into one score.

## Project construction

`ohlcv-research-desk` creates:

- one Project-level request and dataset snapshot;
- one `factors/candidate.py` shared by Factor and Portfolio Studies;
- one `models/candidate.py` for the governed RL Study;
- one request-derived `strategies/factor-population.json` bound by all three
  Studies as evaluation-only authority;
- one request-derived `strategies/portfolio-mandate.json` bound by Portfolio
  and RL Studies;
- one exact `factors/**` dependency closure additionally bound by the RL Study;
- precise fixed Judge closures for all three Studies;
- one program manifest declaring lane order, dependencies, roles, editable
  surfaces, and the RL integration boundary.

All Studies bind the exact same dataset id, version, universe, time range, and
file hashes. Canonical source and Judge files are written before any Study
identity is created so later construction cannot silently mutate an earlier
Study's fixed closure.

The Project intake manifest continues to bind the Factor Study as its primary
construction proof for V1 compatibility. The research-program loader verifies
all additional Study identities against the same dataset rather than treating
the single primary pointer as the whole Project.

## Lane semantics

### Factor quality

Owns causal factor discovery and professional IC/decay/quantile/stability
evidence. It edits `factors/**`.

### Portfolio quality

Owns whether the same current factor survives mechanical signal state,
request-permitted position sizing, constraints, drift, turnover, cost, and
risk. It edits `factors/**` while consuming the Factor Population and mandate
as separate fixed inputs.

Factor and Portfolio Sessions therefore share an editable surface. The
research-program projection marks simultaneous active Sessions as a conflict;
it never attempts an automatic merge.

### Governed RL policy

Owns whether a bounded adaptive state representation adds value beyond fixed
and contextual baselines. It edits `models/**` and reads the current
`factors/**`, Factor Population, and Portfolio Mandate through separately
hashed, fixed dependency closures.
The Judge independently re-audits the factor and evaluates it as both an action
and a standalone baseline.

A promoted factor changes the RL Study input hash, making old RL Runs stale.
An active Factor/Portfolio writer plus an active RL reader is an explicit
writer-reader conflict: finish promotion, then start a fresh RL Session.

## Verified status projection

`aq project program` loads the strict manifest and verifies:

- exact canonical lanes and dependency order;
- every referenced Study;
- shared dataset identity and hash;
- declared editable paths;
- declared dependency paths, exact Factor-source/RL-factor-subset equality,
  shared Factor Population identity, and shared Portfolio/RL mandate identity;
- most recent successful immutable Run whose `studyInputHash` matches current
  Project source, falling back to the latest attempt only when no current
  evidence exists;
- latest Session, experiment count, leader, and active state;
- immutable Reports for that Session, or a Project-owned current Run Report
  only when no Session exists for the lane;
- shared writer/writer and writer/reader concurrency conflicts.

Each lane is projected as:

- `not-started`: no Run or Session evidence;
- `baseline-ready`: current immutable Run exists, no Session;
- `researching`: an active Session exists;
- `reported`: the latest Session has an immutable Report, or no Session exists
  and the current Run has a Project-owned immutable Report;
- `stale`: Project Runs exist, but no successful Run matches current Study
  input.

These are coordination states, not scientific verdicts.
Candidate Runs remain immutable search history, but a REVERT/CRASH can never
replace the lane's current evidence or headline metric merely because it was
executed later. Studio explorers use that same current Run pointer, so charts,
tables, cockpit headlines, and the Inspector cannot disagree about which
evidence is canonical.

Scientific progression is projected separately under `progression`:

- Factor is always the first required evidence lane.
- Portfolio is admitted only when the current successful Factor Run has
  strictly reconstructed diagnostics at a request-bound claim-positive stage
  and a passing Project-family selection adjustment, and a current immutable
  Report freezes that exact leader.
- Governed RL is admitted only when the Factor gate remains passed and the
  current successful Portfolio Run has strictly reconstructed diagnostics at
  `post-cost-edge-positive`, again frozen by a current Report.
- RL is an optional complexity challenge after the two required gates pass. It
  is never required merely because the Study exists.

A failed gate is a valid research result. It keeps the recommended action in
the upstream lane and permits an immutable early-stop Dossier rather than
spending compute on downstream complexity. Gate status is derived by Core from
strict Run diagnostics and exact Report bindings; the browser does not infer
it from metric signs or lane phases.

A current failed lane attempt is distinct from missing evidence. Its phase is
`scientific-limit` or `repair-required`, its latest Run retains exact errors,
and no unchanged execute command is offered. A scientific-limit Run may receive
one Run-bound Report, but the Factor-to-Portfolio or Portfolio-to-RL gate stays
`blocked-scientific-limit`; reporting a limit never converts it into successful
qualification. Repair-required failures route to Run inspection and remain
`blocked-failed-evidence` until source or fixed authority actually changes.

## Next actions

Core generates exact copy-only commands. It may recommend:

- inspect or execute a missing/stale Study baseline;
- publish a Run-bound Report over current immutable evidence when no candidate
  investigation is needed;
- start a delegated Session using the preserved request;
- inspect an active Session;
- inspect an immutable Report;
- complete an active reported lane when its verified leader remains baseline;
- start a fresh Session after a terminal Session when the evidence gate remains
  blocked;
- advance only when the upstream scientific gate passes;
- return the required Factor/Portfolio evidence through a Dossier once both
  required gates pass, optionally challenging it with governed RL.

The browser renders these commands but cannot execute them. AI callers receive
the identical object through CLI JSON.

## Authority and invariants

1. A research program coordinates Studies; it cannot alter their Judges or
   promotion rules.
2. One dataset snapshot is materialized once and hashed by every Study.
3. Factor and Portfolio share source intentionally and cannot be researched
   concurrently without an explicit conflict.
4. Currentness is an exact hash comparison, never a timestamp guess.
   Rejected candidate recency cannot override matching canonical evidence.
5. Downstream evidence never retroactively changes an upstream Run.
6. Report readiness is not trading approval.
7. RL consumes only the exact content-locked candidate source declared by its
   Study; no mutable implicit cross-Study reads are allowed.
8. Portfolio and RL consume one request-derived position mandate; research
   context never becomes an implicit tradable universe.
9. AutoQuant has no authenticated host provenance or live-trading authority.
10. Only `active` Sessions participate in writer/writer and writer/reader
   conflicts; a verified completed or promoted lane is terminal coordination
   history.
11. Coordination phase never substitutes for scientific admission. A Report
   freezes evidence but cannot turn a blocked qualification stage into a pass.
12. Gate authority is research prioritization only: validation evidence and
   visible test audit may govern which experiment to run next, but no gate has
   trading authority.
13. A Session takes precedence over an older Project-owned Run Report for its
   lane. Starting an editable investigation cannot be bypassed by reporting an
   earlier baseline.
