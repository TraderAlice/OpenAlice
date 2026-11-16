# Candidate preflight feedback

Status: implemented.

Related: [[docs/design/agent-operator-experience]],
[[docs/design/study-run-evidence]],
[[docs/design/research-session-loop]],
[[docs/design/agent-cli-contract]], and
[[docs/design/research-selection-integrity]].

## Purpose

Candidate preflight is the cheap governed feedback tier before the first
complete baseline and between later Session worktree edits and the complete
fixed Judge. It answers only:

> Can this exact candidate satisfy the fixed executable API, structural,
> determinism, mutation, numeric, and bounded causality checks declared for
> this Study?

It does not answer whether the candidate is quantitatively better. A passing
preflight grants no scientific admission and predicts no formal verdict.

```text
Agent authors first canonical candidate
→ session start executes fixed optional Preflight in isolation
→ FAILED: no Run or Session; candidate remains for repair
→ PASSED: complete baseline, then Session with retained guard receipt

Agent later edits active Session worktree
→ session check executes the same fixed Preflight in isolation
→ immutable CandidateCheck: PASSED or FAILED
→ PASSED: complete Judge remains next
→ FAILED: worktree candidate stays editable for repair
```

## Contract ownership

The scientific `study.json` remains unchanged. A Study may optionally own:

```text
studies/<study-id>/preflight.json
```

The preflight manifest is strict and declares:

- schema version and `autoquant-candidate-preflight` kind;
- fixed Python entrypoint;
- complete fixed preflight source closure;
- fixed arguments;
- a short wall-clock timeout.

Preflight entrypoint and source paths remain beneath the Project Judge
directory and outside every editable closure. The entrypoint must be included
in the declared preflight closure. The closure must also be disjoint from the
formal Judge closure; a legacy broad `judges/**` Study must first narrow its
Judge inventory deliberately before opting in. Its definition and source
hashes form a separate `preflightHash`.

This separation is deliberate. Adding or improving operational feedback does
not change the identity of historical scientific evidence. A new active
Session still pins the preflight contract in its fixed inventory, so it cannot
change beneath that Session.

## Execution boundary

For a fresh editable Study with no reusable successful baseline, `aq session
start` applies the fixed preflight to the canonical Project candidate before
calling the complete Judge. It uses an ephemeral output directory outside the
Project. Failed, malformed, timed-out, or crashing guards return structured
validation issues without allocating Run or Session identity. After a pass,
the ordinary baseline and Session are created and the exact passed receipt is
retained under `baselineGuard`; its authority fields are all `none`. If the
baseline is reused, Core does not rerun this operational check. If the Study has
no preflight, the established direct baseline route remains explicit.

The retained baseline receipt is not a CandidateCheck: there was no Session
when it executed, it does not consume Check sequence, and it cannot satisfy a
later worktree Check. Its hashes bind the same candidate/data/Study/preflight/
Harness identity and are verified whenever the Session loads.

`aq session check`:

1. loads an active Session and reconstructs immutable leader/history state;
2. validates canonical and worktree fixed authority;
3. requires candidate source to differ from the current leader;
4. loads equal canonical/worktree preflight identities;
5. materializes an isolated workspace containing only Project identity,
   selected Study/program, fixed preflight sources, editable candidate source,
   and declared fixed dependencies;
6. points the process at the owning Project's already content-locked data root;
7. executes with the declared timeout;
8. normalizes one strict result and publishes its manifest last.

The process receives:

- `AUTOQUANT_PROJECT_ROOT`;
- `AUTOQUANT_DATA_ROOT`;
- `AUTOQUANT_STUDY_PATH`;
- `AUTOQUANT_CHECK_OUTPUT`;
- `AUTOQUANT_CHECK_INPUT_HASH`.

Like the formal Judge, this is fixed Project-authored Python, not an OS
sandbox. It never receives a Broker, UTA, order, account, or trading token.

The reference Factor preflight forms its bounded panel from up to two
position-capable Study assets plus all fixed `contextAssets` and the named
benchmark asset in the Study-bound Portfolio mandate. It preserves Study
universe order, filters references to the locked Study universe, and caps each
asset at 256 timestamps. Missing reference metadata preserves first-two-asset
behavior; malformed fixed mandate metadata fails explicitly rather than
silently changing the exercised contract.

## Output protocol

Fixed preflight output contains:

- schema version;
- `passed` or `failed` status;
- concise summary;
- named check rows with `passed`/`failed` status and diagnostic message;
- structured errors.

It contains no `metrics`, objective value, improvement, candidate ranking,
KEEP/REVERT/CRASH verdict, train/validation/test score, portfolio weight,
action recommendation, or trading instruction.

Core CandidateCheck adds:

- Check, Session, Project, and Study identity;
- candidate and current-leader source hashes;
- Study input, dataset, preflight, Harness, and total input hashes;
- start/completion/duration and bounded execution details;
- explicit authority:
  `selectionAuthority: none`, `promotionAuthority: none`,
  `tradingAuthority: none`;
- the normalized check rows and errors.

## Persistence and currentness

Checks live beneath the Session:

```text
checks/
└── check-<UTC timestamp>-<identity>/
    ├── result.json
    ├── stdout.txt
    ├── stderr.txt
    ├── raw-output.json     # normalized strict runner output
    └── manifest.json       # written last; hashes every prior file
```

Checks are immutable diagnostic artifacts. Listing/loading verifies every
file. A Check is current only when all of these match:

- active Session id and selected Study;
- exact candidate source hash;
- current leader source hash;
- current Study input and dataset hash;
- current preflight definition/source hash;
- current Harness identity.

Editing the candidate makes the prior Check stale. A Check does not mutate the
Session pointer because currentness is reconstructed from hashes.

## Agent Work Brief routing

For an active valid Session:

- candidate equals leader → `candidate-edit-required`, no executable primary
  action, worktree remains the only writable root;
- changed candidate and no current Check → `candidate-check-required`,
  `session.check` is primary;
- current failed Check → `candidate-check-failed`, no executable primary
  action until the Agent edits the candidate;
- current passed Check → `candidate-check-passed`,
  `experiment.evaluate` is primary;
- Study has no preflight → legacy `session-active`,
  `experiment.evaluate` remains primary.

Studio displays this exact Core-authored Brief. It does not inspect Check files
or infer readiness in JavaScript.

## Reference checks

The OHLCV Factor and Portfolio reference checks use a bounded subset of the
fixed dataset and verify:

- import and callable `compute_factor(panel)` API;
- complete-universe panel identity and input immutability;
- output Series type, length, and index;
- numeric conversion, finite non-null observations, and no infinity;
- deterministic repeated output;
- exact emitted-value equality when future timestamps are withheld from the
  whole panel at fixed prefix cuts.

The governed RL reference check verifies:

- bounded unique `FEATURE_NAMES`;
- callable `encode_state(state)` API;
- input mapping immutability;
- numeric one-dimensional vector aligned with feature names;
- finiteness and fixed absolute bounds;
- deterministic repeated encoding over fixed representative causal states.

These checks reject obvious invalid candidates. They do not train, backtest,
evaluate returns, inspect a holdout, or compare a candidate with the leader.

## Invariants

1. Preflight sources are fixed authority and cannot overlap candidate edits or
   the formal Judge closure.
2. CandidateCheck has no selection, promotion, or trading authority.
3. No Check creates a Run or Experiment or changes the Session leader/sequence.
4. Failure preserves candidate bytes for repair.
5. Passing never predicts or substitutes for a formal Judge verdict.
6. Formal evidence and historical Study identity do not depend on whether a
   preflight is installed later.
7. Currentness is hash-reconstructed, not trusted from a mutable pointer.
8. CLI and Studio receive the same state through the Agent Work Brief.

## Known limitations

- V1 supports fixed Python preflights only.
- The check is Project-authored and not an OS sandbox.
- A weak fixed preflight may miss errors caught by the complete Judge.
- A preflight cannot safely provide approximate alpha or portfolio metrics.
- Formal Judge progress streaming remains separate future work.
