# Market-clock decision anchors

Status: implemented.

Related: [[docs/design/caller-owned-decision-cadence]],
[[docs/design/configurable-session-interval-inputs]],
[[docs/design/research-intake-and-dataset-snapshots]], and
[[docs/design/rl-factor-policy-lab]].

## Purpose

The collaborating workbench owns both the spacing and the market-clock anchor
of delegated Portfolio/RL decisions. AutoQuant binds that assumption to the
locked dataset and applies one deterministic schedule everywhere.

```text
portfolioPolicy.decisionSchedule
→ content-addressed Portfolio Mandate
→ locked-dataset compatibility check
→ one complete-panel eligibility mask
→ Portfolio / governed RL / evidence / handoff
```

## Contract

The complete caller policy contains:

```json
{
  "decisionSchedule": {
    "kind": "every-bars",
    "bars": 4,
    "anchor": "session-start"
  }
}
```

Supported anchors are:

- `dataset-start`: the first complete panel row is eligible and one global
  ordinal continues across the complete dataset;
- `session-start`: the first completed XNYS regular-session base bar is
  eligible and the ordinal restarts for every verified session.

`session-start` is accepted only for V3 XNYS session-clock packages whose base
interval is intraday. This is a request-to-dataset compatibility rule, not an
inference from timestamp gaps. A daily row is already one whole session and a
continuous market has no supported session-reset authority.

The Mandate retains the exact anchor:

```json
{
  "decisionPolicy": {
    "source": "caller-supplied",
    "kind": "every-bars",
    "bars": 4,
    "anchor": "session-start"
  }
}
```

## XNYS semantics

The locked V3 input contract already proves every expected XNYS regular-session
bar, scheduled open/close, holiday, DST transition, and early close. The
decision mask uses the same complete panel. For each session and zero-based
bar ordinal `i`:

```text
eligible = i mod decisionSchedule.bars == 0
```

Thus a 15-minute/four-bar policy is eligible on the first completed bar and
then every four bars within that session. The next regular or early-close
session starts again at its first completed bar. Evaluation split boundaries
never restart the schedule.

## Invariants

1. The request owns anchor choice; candidate code cannot tune it.
2. Intake proves the anchor is compatible with the locked market clock before
   creating a Project.
3. Portfolio signal state, ordinary execution, governed-RL action availability,
   baselines, and Q bootstrap use one exact mask.
4. Risk-only scale-down remains available on every base bar.
5. Run, Explorer, Studio, Report, Dossier, and CLI disclose the exact anchor.
6. Changing the anchor changes immutable research identity and never
   reinterprets prior evidence.

## Known limits

- `session-start` currently means verified XNYS regular sessions only.
- `calendar-month-end` is a separate schedule kind for V1 daily XNYS
  packages. It uses the official final regular session of the calendar month,
  so an incomplete terminal month is never made eligible by dataset truncation.
- The first completed base bar is the phase origin. Arbitrary phase offsets,
  wall-clock times, session-close decisions, and auctions are not yet
  represented.
- This is a historical research schedule and grants no live trading authority.
