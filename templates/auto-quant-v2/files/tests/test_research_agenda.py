from __future__ import annotations

import copy
import tempfile
import unittest

import jsonschema

from autoquant.research_agenda import (
    RESEARCH_AGENDA_JSON_SCHEMA,
    build_research_agenda,
    factor_research_agenda,
    portfolio_research_agenda,
    rl_research_agenda,
    waiting_research_agenda,
)
from autoquant.runs import execute_study
from autoquant.studies import create_study
from tests.study_helpers import make_project, study_definition


def factor_diagnostics(
    *,
    stage: str = "style-neutral-edge-absent",
) -> dict:
    return {
        "run": {"id": "run-factor", "inputHash": "factor-input"},
        "factorQualification": {
            "available": True,
            "diagnosis": {
                "stage": stage,
                "iterationFocus": "distinct-factor-information",
                "explanation": "Verified factor qualification diagnosis.",
                "qualifiesForPortfolio": stage
                in {
                    "factor-qualification-positive",
                    "known-style-validation-positive",
                },
            },
            "validation": {
                "candidate": {
                    "meanRankIc": 0.23,
                    "hacTStatistic": 3.15,
                },
                "styleNeutralCandidate": {
                    "meanRankIc": (
                        0.12
                        if stage == "factor-qualification-positive"
                        else -0.08
                    ),
                    "hacTStatistic": (
                        2.2
                        if stage == "factor-qualification-positive"
                        else -1.4
                    ),
                },
            },
            "test": {"candidate": {"meanRankIc": 999.0}},
        },
        "factorComponents": {
            "available": True,
            "evaluationMode": "cross-sectional",
            "validationDiagnosis": {
                "strongestRawComponent": "base_momentum",
                "strongestRawMeanIc": 0.31,
                "strongestResidualComponent": "slow_trend",
                "strongestResidualMeanIc": 0.14,
                "removalMostImprovesFixedBlend": "noisy_daily",
                "bestRemovalDeltaMeanIc": 0.07,
                "mostRedundantPair": {
                    "left": "base_momentum",
                    "right": "slow_trend",
                    "trainMeanAbsoluteRankAssociation": 0.88,
                },
            },
            "components": [
                {
                    "id": "base_momentum",
                    "label": "Base momentum",
                    "hypothesis": "Base momentum persists for one bar.",
                    "validation": {
                        "nearestPeerResidual": {"meanRankIc": 0.02}
                    },
                },
                {
                    "id": "slow_trend",
                    "label": "Completed slow trend",
                    "hypothesis": (
                        "Completed higher-interval trend persists at the next "
                        "base close."
                    ),
                    "validation": {
                        "nearestPeerResidual": {"meanRankIc": 0.14}
                    },
                },
                {
                    "id": "noisy_daily",
                    "label": "Daily reversal",
                    "hypothesis": "Daily reversal predicts the next base bar.",
                    "validation": {
                        "nearestPeerResidual": {"meanRankIc": -0.03}
                    },
                },
            ],
            "testAudit": {"strongest": "must-not-enter-agenda"},
        },
    }


def portfolio_diagnostics(
    *,
    stage: str = "cost-fragile",
    outcome: str = "transmission-destroyed-edge",
    adverse: str = "tradingCost",
) -> dict:
    return {
        "run": {"id": "run-portfolio", "inputHash": "portfolio-input"},
        "strategyViability": {
            "diagnosis": {
                "stage": stage,
                "iterationFocus": "turnover-and-execution",
                "explanation": "Verified Portfolio viability diagnosis.",
            },
            "validation": {
                "factorRankIc": 0.12,
                "gross": {"sharpe": 0.8},
                "net": {
                    "sharpe": (
                        0.35
                        if stage == "post-cost-edge-positive"
                        else -0.1
                    )
                },
            },
            "test": {"net": {"sharpe": 999.0}},
        },
        "signalMonetization": {
            "diagnosis": {
                "outcome": outcome,
                "largestAdverseStage": adverse,
                "largestAdverseAnnualizedDelta": -0.08,
            },
            "test": {"largestAdverseStage": "must-not-enter-agenda"},
        },
    }


def rl_diagnostics(
    *,
    stage: str = "implementation-cost-destroys-edge",
) -> dict:
    return {
        "run": {"id": "run-rl", "inputHash": "rl-input"},
        "factorFusionDiagnosis": {
            "available": True,
            "diagnosis": {
                "stage": stage,
                "iterationFocus": "switch-persistence-and-turnover",
                "explanation": "Verified governed-RL fusion diagnosis.",
            },
            "validation": {
                "adaptiveTransmission": {
                    "meanTrialGrossActiveReturn": 0.03,
                    "meanTrialNetActiveReturn": (
                        0.02
                        if stage == "adaptive-value-positive"
                        else -0.01
                    ),
                    "meanSharpeAdvantageVsSelectedBaseline": (
                        0.2
                        if stage == "adaptive-value-positive"
                        else -0.1
                    ),
                },
                "stability": {
                    "positiveNetTrialRate": (
                        0.75
                        if stage == "adaptive-value-positive"
                        else 0.33
                    )
                },
            },
            "testAudit": {"oracleCaptureRate": 1.0},
        },
    }


class EvidenceDrivenResearchAgendaTests(unittest.TestCase):
    def test_factor_components_create_bounded_validation_only_moves(self) -> None:
        diagnostics = factor_diagnostics()
        agenda = factor_research_agenda(diagnostics, ["factors/**"])
        jsonschema.validate(agenda, RESEARCH_AGENDA_JSON_SCHEMA)

        self.assertEqual(agenda["status"], "available")
        self.assertEqual(
            [item["id"] for item in agenda["moves"]],
            [
                "factor-isolate-residual-component",
                "factor-orthogonalize-redundant-components",
            ],
        )
        self.assertEqual(
            agenda["moves"][0]["target"]["components"],
            ["slow_trend"],
        )
        self.assertEqual(
            agenda["moves"][0]["target"]["editablePaths"],
            ["factors/**"],
        )
        self.assertFalse(agenda["authority"]["testEntersPrioritization"])

        changed_test = copy.deepcopy(diagnostics)
        changed_test["factorQualification"]["test"]["candidate"][
            "meanRankIc"
        ] = -999.0
        changed_test["factorComponents"]["testAudit"] = {"arbitrary": True}
        self.assertEqual(
            agenda,
            factor_research_agenda(changed_test, ["factors/**"]),
        )

        blend_agenda = factor_research_agenda(
            factor_diagnostics(stage="blend-uplift-absent"),
            ["factors/**"],
        )
        blend_move = next(
            move
            for move in blend_agenda["moves"]
            if move["id"] == "factor-challenge-fixed-blend-inclusion"
        )
        self.assertIn("not an ablation", blend_move["rationale"])

    def test_factor_timestamp_context_creates_one_fixed_interaction_move(
        self,
    ) -> None:
        diagnostics = factor_diagnostics(
            stage="known-style-temporal-instability",
        )
        diagnostics["researchHorizon"] = {"primaryForwardBars": 1}
        diagnostics["factorComponents"]["components"].append(
            {
                "id": "market_stress",
                "label": "Market stress",
                "role": "timestamp-context",
                "hypothesis": "Factor efficacy varies with market stress.",
                "validation": {
                    "nearestPeerResidual": None,
                    "context": {
                        "conditionalFactorHorizonProfile": [
                            {
                                "horizon": 1,
                                "low": {"meanRankIc": -0.05},
                                "middle": {"meanRankIc": 0.02},
                                "high": {"meanRankIc": 0.16},
                            }
                        ]
                    },
                },
            }
        )
        agenda = factor_research_agenda(diagnostics, ["factors/**"])
        context_move = next(
            move
            for move in agenda["moves"]
            if move["id"] == "factor-test-context-interaction"
        )
        self.assertEqual(
            context_move["target"]["components"],
            ["market_stress"],
        )
        self.assertIn("Train-only tertiles", context_move["rationale"])
        self.assertNotIn("test", context_move["evidenceRefs"][0]["path"])

        temporal = copy.deepcopy(diagnostics)
        temporal["factorComponents"]["evaluationMode"] = (
            "single-asset-temporal"
        )
        temporal_agenda = factor_research_agenda(
            temporal,
            ["factors/**"],
        )
        self.assertIn(
            "temporal rank contribution",
            temporal_agenda["moves"][0]["evidenceRefs"][0]["label"],
        )
        temporal_context = next(
            move
            for move in temporal_agenda["moves"]
            if move["id"] == "factor-test-context-interaction"
        )
        self.assertIn(
            "conditional temporal rank-contribution range",
            temporal_context["rationale"],
        )
        self.assertEqual(
            temporal_context["evidenceRefs"][0]["unit"],
            "rank-correlation-contribution-range",
        )

    def test_factor_legacy_components_fall_back_and_positive_edge_freezes(self) -> None:
        diagnostics = factor_diagnostics(stage="raw-predictive-edge-absent")
        diagnostics["factorComponents"] = {
            "available": False,
            "reason": "legacy-run-without-factor-components",
        }
        fallback = factor_research_agenda(diagnostics, ["factors/**"])
        jsonschema.validate(fallback, RESEARCH_AGENDA_JSON_SCHEMA)
        self.assertEqual(
            fallback["moves"][0]["id"],
            "factor-raw-predictive-edge-absent",
        )

        positive = factor_research_agenda(
            factor_diagnostics(stage="factor-qualification-positive"),
            ["factors/**"],
        )
        jsonschema.validate(positive, RESEARCH_AGENDA_JSON_SCHEMA)
        self.assertEqual(
            positive["status"],
            "no-further-in-sample-tuning",
        )
        self.assertEqual(
            positive["moves"][0]["target"]["editablePaths"],
            [],
        )

        known_weak = factor_diagnostics(
            stage="raw-statistical-evidence-weak",
        )
        known_weak["factorQualification"]["claim"] = {
            "claim": "known-style-validation",
            "knownStyle": "reversal_5",
        }
        frozen = factor_research_agenda(
            known_weak,
            ["factors/**"],
        )
        self.assertEqual(
            frozen["status"],
            "no-further-in-sample-tuning",
        )
        self.assertEqual(
            frozen["moves"][0]["id"],
            "factor-freeze-and-independent-sample",
        )
        self.assertEqual(
            frozen["moves"][0]["target"]["editablePaths"],
            [],
        )

    def test_portfolio_recipes_never_open_fixed_mechanics(self) -> None:
        recipes = {
            ("transmission-destroyed-edge", "tradingCost"): (
                "portfolio-increase-signal-persistence"
            ),
            ("transmission-destroyed-edge", "executionRetention"): (
                "portfolio-increase-signal-persistence"
            ),
            ("transmission-destroyed-edge", "riskGovernor"): (
                "portfolio-reduce-factor-crowding"
            ),
            ("transmission-destroyed-edge", "sizingAndCaps"): (
                "portfolio-improve-cross-sectional-breadth"
            ),
            ("signal-intent-negative", "sizingAndCaps"): (
                "portfolio-repair-signal-intent"
            ),
        }
        for (outcome, adverse), expected in recipes.items():
            with self.subTest(outcome=outcome, adverse=adverse):
                diagnostics = portfolio_diagnostics(
                    outcome=outcome,
                    adverse=adverse,
                )
                agenda = portfolio_research_agenda(
                    diagnostics,
                    ["factors/**"],
                )
                jsonschema.validate(agenda, RESEARCH_AGENDA_JSON_SCHEMA)
                move = agenda["moves"][0]
                self.assertEqual(move["id"], expected)
                self.assertEqual(
                    move["target"]["editablePaths"],
                    ["factors/**"],
                )
                self.assertNotIn("strategies/**", move["target"]["editablePaths"])
                changed_test = copy.deepcopy(diagnostics)
                changed_test["strategyViability"]["test"] = {"tampered": True}
                changed_test["signalMonetization"]["test"] = {"tampered": True}
                self.assertEqual(
                    agenda,
                    portfolio_research_agenda(
                        changed_test,
                        ["factors/**"],
                    ),
                )

        positive = portfolio_research_agenda(
            portfolio_diagnostics(
                stage="post-cost-edge-positive",
                outcome="monetized-positive",
            ),
            ["factors/**"],
        )
        self.assertEqual(
            positive["status"],
            "no-further-in-sample-tuning",
        )
        self.assertEqual(
            positive["moves"][0]["target"]["editablePaths"],
            [],
        )

    def test_translation_sensitive_portfolio_repairs_factor_not_window(self) -> None:
        diagnostics = portfolio_diagnostics(
            stage="post-cost-edge-positive",
            outcome="monetized-positive",
        )
        diagnostics["translationRobustness"] = {
            "applicable": True,
            "diagnosis": {
                "status": "translation-sensitive-target-path",
                "minimumActiveStateAgreementRate": 0.62,
                "maximumMeanAbsoluteTargetDelta": 0.09,
            },
            "test": {"profiles": "must-not-enter-prioritization"},
        }

        agenda = portfolio_research_agenda(diagnostics, ["factors/**"])

        jsonschema.validate(agenda, RESEARCH_AGENDA_JSON_SCHEMA)
        self.assertEqual(agenda["status"], "available")
        move = agenda["moves"][0]
        self.assertEqual(
            move["id"],
            "portfolio-stabilize-temporal-factor-representation",
        )
        self.assertEqual(move["target"]["editablePaths"], ["factors/**"])
        self.assertIn("not select", move["rationale"])
        self.assertTrue(
            all(
                "translationRobustness/diagnosis" in evidence["path"]
                for evidence in move["evidenceRefs"]
            )
        )

        changed_test = copy.deepcopy(diagnostics)
        changed_test["translationRobustness"]["test"] = {"tampered": True}
        self.assertEqual(
            agenda,
            portfolio_research_agenda(changed_test, ["factors/**"]),
        )

    def test_rl_recipes_only_target_the_causal_encoder(self) -> None:
        recipes = {
            "adaptive-book-selection-negative": (
                "rl-improve-causal-state-capture"
            ),
            "implementation-cost-destroys-edge": (
                "rl-increase-switch-persistence"
            ),
            "risk-adjusted-adaptive-value-absent": (
                "rl-control-active-risk"
            ),
            "seed-fold-unstable": "rl-simplify-train-only-learning",
        }
        for stage, expected in recipes.items():
            with self.subTest(stage=stage):
                diagnostics = rl_diagnostics(stage=stage)
                agenda = rl_research_agenda(
                    diagnostics,
                    ["models/**"],
                )
                jsonschema.validate(agenda, RESEARCH_AGENDA_JSON_SCHEMA)
                move = agenda["moves"][0]
                self.assertEqual(move["id"], expected)
                self.assertEqual(
                    move["target"]["editablePaths"],
                    ["models/**"],
                )
                changed_test = copy.deepcopy(diagnostics)
                changed_test["factorFusionDiagnosis"]["testAudit"] = {
                    "oracleCaptureRate": -999.0
                }
                self.assertEqual(
                    agenda,
                    rl_research_agenda(changed_test, ["models/**"]),
                )

        positive = rl_research_agenda(
            rl_diagnostics(stage="adaptive-value-positive"),
            ["models/**"],
        )
        self.assertEqual(
            positive["status"],
            "no-further-in-sample-tuning",
        )
        self.assertEqual(
            positive["moves"][0]["target"]["editablePaths"],
            [],
        )

    def test_waiting_and_unsupported_states_are_explicit(self) -> None:
        waiting = waiting_research_agenda("factor")
        jsonschema.validate(waiting, RESEARCH_AGENDA_JSON_SCHEMA)
        self.assertEqual(waiting["status"], "waiting-evidence")
        self.assertEqual(waiting["moves"], [])

        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            create_study(project, study_definition())
            run = execute_study(project, "factor-quality")
            unsupported = build_research_agenda(
                project,
                run.result["id"],
                lane_id=None,
                editable_paths=["factors/**"],
            )
        jsonschema.validate(unsupported, RESEARCH_AGENDA_JSON_SCHEMA)
        self.assertEqual(unsupported["status"], "unsupported-study")
        self.assertEqual(unsupported["moves"], [])
        self.assertIn("score", unsupported["reason"])


if __name__ == "__main__":
    unittest.main()
