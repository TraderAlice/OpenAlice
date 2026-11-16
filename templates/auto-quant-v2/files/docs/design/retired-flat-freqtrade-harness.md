# Retired flat Freqtrade Harness

Status: implemented.

Related: [[docs/design/workspace-project-boundaries]],
[[docs/design/study-run-evidence]], and
[[docs/design/research-intake-and-dataset-snapshots]].

## Decision

AutoQuant V2 has one executable architecture:

```text
Workspace
└── Project
    ├── caller-owned request and content-locked dataset
    ├── Study and fixed Judge
    ├── immutable Run evidence
    └── governed Session, Report, Dossier, and Studio projections
```

The repository-root Auto-Quant Classic arena is retired. `prepare.py`,
`run.py`, `harness.json`, `config.json`, `user_data/strategies/`, and
`versions/` are not alternate V2 entry points and are no longer distributed.

## Dependency boundary

Freqtrade was used only by the retired arena. It is not a V2 engine, Project
runtime, Broker interface, or evidence dependency. Removing it also removes
the inherited TA-Lib/CCXT/exchange runtime closure.

V2 keeps ordinary pandas/NumPy OHLCV research. Caller-supplied files enter
through `aq project intake`; Core validates the market contract, normalizes
the conventional OHLCV table, content-locks the Project-local bytes, and
executes only the Project's fixed Judges.

## Historical evidence

Pre-V2 source, strategies, notebooks, logs, and snapshots remain recoverable
from Git history. They are not loaded, migrated, or reinterpreted by current
code. Historical completed plans may still mention the retired commands as
the verification context that existed when those plans completed.

## Invariants

1. `aq` is the only public repository command family.
2. No current package import or dependency requires Freqtrade.
3. Research data belongs to a caller-created Project, never the source root.
4. A Project Run publishes the canonical structured evidence; free-form result
   blocks and root `results.tsv` journals are not accepted.
5. Historical Classic artifacts do not constrain V2 schema evolution.
