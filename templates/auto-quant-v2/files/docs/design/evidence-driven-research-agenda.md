# Evidence-driven research agenda

Status: V1 implemented.

Related: [[docs/design/agent-operator-experience]],
[[docs/design/evidence-gated-research-progression]],
[[docs/design/factor-component-attribution]],
[[docs/design/factor-diagnostics]],
[[docs/design/portfolio-construction-lab]],
[[docs/design/signal-policy-and-attribution]],
[[docs/design/portfolio-decision-explorer]], and
[[docs/design/rl-factor-policy-lab]], and
[[docs/design/reported-position-book-risk]].

## Purpose

`AgentWorkBrief` currently answers where an Agent may work and which lifecycle
command comes next. It does not yet answer the scientific question at the
resolution implied by AutoQuant's evidence:

- which declared multi-interval component should be isolated or challenged;
- whether a Portfolio candidate should improve breadth, persistence,
  covariance structure, or turnover efficiency under fixed mechanics;
- whether an RL encoder should improve factor capture, switching persistence,
  active-risk awareness, or train-only stability.

The research agenda closes that gap. It is a deterministic Core projection
over one verified immutable Run, not generated prose and not a second
selection system.

## Contract

Every work brief contains:

```json
{
  "researchAgenda": {
    "status": "available",
    "laneId": "factor",
    "run": {
      "id": "run-...",
      "inputHash": "..."
    },
    "diagnosis": {
      "stage": "style-neutral-edge-absent",
      "iterationFocus": "distinct-factor-information",
      "explanation": "..."
    },
    "moveRole": "current-research-guidance",
    "moves": [
      {
        "priority": 1,
        "id": "factor-isolate-residual-component",
        "title": "Isolate the strongest residual component",
        "hypothesis": "...",
        "rationale": "...",
        "target": {
          "editablePaths": ["factors/**"],
          "components": ["base_momentum_10"]
        },
        "evidenceRefs": [
          {
            "path": "/factorComponents/validationDiagnosis/strongestResidualMeanIc",
            "label": "Validation nearest-peer residual rank IC",
            "value": 0.293,
            "unit": "rank-ic",
            "role": "selection"
          }
        ],
        "evaluation": {
          "objectiveMetric": "validation_mean_ic",
          "selectionSplit": "validation",
          "requiredChecks": ["..."],
          "stopConditions": ["..."],
          "testRole": "visible-audit-only"
        }
      }
    ],
    "authority": {
      "source": "verified-immutable-run",
      "prioritization": "diagnostic-only",
      "automaticExecution": false,
      "automaticPromotion": false,
      "tradingAuthority": "none"
    }
  }
}
```

`status` is:

- `available` when a supported successful Run yields one or more moves;
- `waiting-evidence` when no current successful Run exists;
- `unsupported-study` when the Study metric has no agenda recipe;
- `no-further-in-sample-tuning` when positive evidence calls for a frozen
  candidate plus fresh external holdout rather than another validation edit.
- `descriptive-audit-complete` when a fixed Book Risk, Price Event, or
  Allocation Run is ready for answer handoff and no optimization agenda is
  authorized.

`moves` contains at most three entries. Ordering is fixed by Core. A move is
not an `AgentWorkBrief.primaryAction`: it cannot mutate state and has no
operation effect. The existing lifecycle command still governs baseline,
Session, Check, Experiment, Report, promotion, and completion transitions.
Waiting agendas declare `authority.source: none`; they never imply that a
missing Run was verified.

`moveRole` is `current-research-guidance` while the lifecycle is actively
preparing bounded work, `optional-follow-up` when immutable trial history
exists and the Work Brief has no required primary action (or terminal required
research is complete), and `unavailable` when `moves` is empty. This field
controls CLI and Studio presentation; it does not change evidence ordering,
Session writability, or selection authority.

An available future move does not make another edit mandatory after an
immutable trial restores the leader. That state is a trial-review handoff:
orientation lets the Agent report/complete the current prefix or explicitly
declare another bounded hypothesis, and labels the agenda
`optional-follow-up`. Only a separate
`no-further-in-sample-tuning` diagnosis upgrades that choice to the stronger
freeze/external-holdout handoff.

A completed descriptive audit binds its verified Run and exact
Harness-bound `run.inputHash`, carries no moves, and uses
`prioritization: none` and `selectionSplit: none` because it authorizes no
further candidate choice. Its template-specific test role describes the
evidence context; the strict Explorer separately retains any fixed result
selection contract, such as Allocation validation versus visible-test audit.
It prevents the Agent from misreading a finished fixed result as missing
Factor/Portfolio/RL evidence or manufacturing a candidate optimization.

The work-brief hash covers the agenda. Studio and `aq orient` consume the exact
Core object; neither recreates move selection.

## Authority and evidence rules

All agenda prioritization uses:

- the immutable Run identity and content-locked inputs;
- train-only facts where a diagnostic explicitly uses train for target-free
  peer/style selection;
- validation evidence for research prioritization;
- fixed Project-family trial disclosure already owned by Core.

It never uses:

- visible test-audit values;
- ex-post RL best actions or realized regret to choose the next encoder;
- mutable Session prose;
- source-code inspection to guess component provenance;
- an LLM-generated market narrative.

Every numeric fact is retained as a typed `evidenceRef` with a stable path into
the verified diagnostics projection. Explanations can restate those facts but
cannot introduce an unreferenced selection claim.

## Factor recipes

Factor agendas consume `factorQualification` and optional
`factorComponents`.

Priority rules follow the first missing qualification layer:

1. When a predeclared known-style implementation is identified but raw HAC
   evidence is weak, freeze source and request genuinely independent evidence;
   do not manufacture an in-sample code change.
2. When the current layer can be answered by component selection and usable
   nearest-peer residual evidence exists, isolate the declared
   component with the strongest validation residual and test one candidate
   centered on its declared hypothesis.
3. At the blend layer, when removing a component improves the fixed equal-rank diagnostic blend,
   challenge that component's inclusion in one newly declared candidate. The
   move must say that this is not an ablation of arbitrary
   `compute_factor(...)`.
4. At a distinctness/blend layer, when a train-selected pair is materially redundant, test one predeclared
   causal residual or choose one representative. Train chooses the peer only;
   validation judges the new candidate.
5. At a chronological-instability layer, a timestamp-context component may
   support one fixed interaction hypothesis using train-fixed states and
   validation conditional IC.
6. Otherwise use the qualification stage to propose one sign/timing,
   effect-size, style-distinctiveness, blend, or temporal-robustness
   hypothesis.

No move assumes declared components exhaustively reconstruct the final factor.
The formal Factor objective and qualification funnel remain unchanged.

## Portfolio recipes

Portfolio agendas consume `strategyViability` and `signalMonetization`.
`models` and fixed Portfolio parameters are not editable; only the factor
closure is.

- Negative signal intent proposes sign, threshold separability, or breadth in
  the factor representation only after normalized intent has been rebuilt
  under the verified prediction mode. An explicit relative-value pair may not
  be declared intent-negative merely because its capped legs leave Cash.
- Positive IC with non-positive gross monetization proposes a signal whose
  ranks remain separated under fixed hysteresis, caps, and inverse-volatility
  sizing.
- Cost fragility or a trading-cost/no-trade transmission failure proposes
  causal persistence or smoothing that reduces rank churn under the existing
  fixed mechanics.
- Risk-governor damage proposes less concentrated/correlated factor ranks,
  never a looser volatility ceiling.
- Sizing/cap damage proposes broader differentiated ranks, never different
  fixed caps.
- Positive post-cost validation evidence freezes the candidate and requests
  fresh external holdout/capacity evidence rather than more validation tuning.
  Before any Experiment exists, an active Session may still evaluate an
  explicitly predeclared bounded alternative. Orientation labels that Session
  authority as distinct from the diagnostic freeze recommendation and never
  treats it as permission for open-ended tuning.
  After an immutable REVERT/CRASH restores that unchanged leader, orientation
  must follow the freeze instead of issuing a generic candidate-edit
  instruction; the active Session remains inspectable and explicitly
  continuable under a new mandate.

## Governed-RL recipes

RL agendas consume `factorFusionDiagnosis`. Only `models/**` is editable.

- Negative adaptive selection proposes a causal state field that distinguishes
  when the candidate or another fixed sleeve has train-supported advantage.
- Positive gross but non-positive net adaptive value proposes state features
  for switch persistence and target-distance awareness.
- Positive net active return without Sharpe advantage proposes pretrade
  exposure, concentration, or volatility context for active-risk control.
- Seed/fold instability proposes a simpler bounded encoder with fewer
  interactions and stronger train-only stability.
- Positive adaptive validation evidence freezes the encoder and requests a
  fresh external holdout/capacity challenge.

Moves cannot add actions, change Q-learning, choose an ex-post oracle, alter
rewards, bypass Mandate/risk/no-trade mechanics, or touch fixed factors.

## Compatibility and failure behavior

Legacy Factor Runs without component evidence still receive a stage-level
Factor move. Missing qualification/fusion evidence yields an explicit
unavailable or waiting state rather than fabricated detail. Unknown Study
objectives are `unsupported-study`.

If verified diagnostic loading fails because evidence is malformed or
tampered, work-brief construction fails through the existing structured Core
diagnostic path. Studio may show orientation unavailable, but it does not
retain a stale agenda.

## Testing

Tests must cover:

- deterministic ordering and a maximum of three moves;
- component residual, diagnostic-blend challenge, and redundancy recipes;
- legacy Factor stage fallback;
- each Portfolio first-failure recipe and fixed-mechanics edit boundary;
- each RL diagnosis recipe and fixed-action/learning boundary;
- waiting and unsupported states;
- work-brief schema/hash, CLI human/JSON parity, and Studio rendering;
- proof that test-audit values cannot alter agenda order or content.
