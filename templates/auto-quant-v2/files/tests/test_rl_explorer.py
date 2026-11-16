from __future__ import annotations

import csv
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import jsonschema

from autoquant.rl_explorer import (
    RL_DIAGNOSTICS_JSON_SCHEMA,
    load_rl_diagnostics,
)
from autoquant.runs import execute_study
from autoquant.studio import build_studio_snapshot
from autoquant.studies import hash_file
from autoquant.templates import RL_STUDY_ID
from autoquant.workspace import (
    AutoQuantValidationError,
    create_project,
    initialize_workspace,
)


def make_lab(root: Path):
    workspace = initialize_workspace(root / "workspace")
    project = create_project(
        workspace.root_dir,
        "rl-evidence",
        template="ohlcv-rl-factor-lab",
    )
    return workspace, project, execute_study(project, RL_STUDY_ID)


def rehash_run(run_root: Path) -> None:
    manifest_path = run_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["files"] = {
        path.relative_to(run_root).as_posix(): hash_file(path)
        for path in sorted(run_root.rglob("*"))
        if path.is_file() and path != manifest_path
    }
    manifest["resultHash"] = manifest["files"]["result.json"]
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


class RlPolicyEvidenceExplorerTests(unittest.TestCase):
    def test_projection_reconciles_trials_baselines_training_and_actions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace, project, run = make_lab(Path(directory))
            diagnostics = load_rl_diagnostics(
                project,
                run.result["id"],
                point_limit=64,
            )

            self.assertEqual(
                diagnostics["kind"],
                "autoquant-rl-policy-diagnostics",
            )
            self.assertEqual(diagnostics["run"]["inputHash"], run.result["inputHash"])
            self.assertEqual(len(diagnostics["trials"]), 6)
            self.assertEqual(len(diagnostics["baselines"]), 14)
            self.assertEqual(len(diagnostics["models"]), 6)
            self.assertEqual(len(diagnostics["contextualBaselines"]), 2)
            self.assertTrue(
                all(
                    item["available"]
                    and item["method"]
                    == "iterative-same-pretrade-contextual-ridge-v1"
                    and item["labelScope"] == "train-only"
                    and item["anchorAction"] == "balanced"
                    and item["iterations"] == 4
                    and len(item["history"]) == 4
                    for item in diagnostics["contextualBaselines"]
                )
            )
            self.assertTrue(
                all(
                    iteration["sharedPretradeActionEvaluations"]
                    == iteration["trainingRows"]
                    * len(diagnostics["protocol"]["actions"])
                    for item in diagnostics["contextualBaselines"]
                    for iteration in item["history"]
                )
            )
            self.assertEqual(
                len(diagnostics["training"]),
                diagnostics["protocol"]["episodes"]
                * diagnostics["summary"]["trialCount"],
            )
            self.assertEqual(len(diagnostics["actionSummaries"]), 12)
            self.assertEqual(diagnostics["actionPath"]["sampledRows"], 64)
            self.assertEqual(diagnostics["actionPath"]["totalRows"], 780)
            self.assertFalse(diagnostics["protocol"]["testEntersSelection"])
            self.assertEqual(
                diagnostics["protocol"]["configuration"]["learningContract"][
                    "method"
                ],
                "fixed-after-train-only-blocked-stability-audit-v1",
            )
            seed_stability = diagnostics["summary"][
                "withinFoldSeedStability"
            ]
            self.assertEqual(seed_stability["folds"], 2)
            self.assertGreaterEqual(
                seed_stability["maximumStandardDeviation"],
                seed_stability["meanStandardDeviation"],
            )
            self.assertLessEqual(seed_stability["exactConsensusFolds"], 2)
            self.assertGreaterEqual(
                seed_stability["maximumPairwiseActionMismatch"],
                seed_stability["meanPairwiseActionMismatch"],
            )
            self.assertEqual(
                diagnostics["factorFusion"]["dependency"]["paths"],
                [
                    "factors/**",
                    "strategies/factor-claim.json",
                    "strategies/factor-population.json",
                    "strategies/portfolio-mandate.json",
                    "strategies/research-horizon.json",
                ],
            )
            self.assertEqual(
                diagnostics["predictionUniverse"]["evaluationMode"],
                "cross-sectional",
            )
            self.assertEqual(
                diagnostics["signalTranslation"]["method"],
                "prediction-mode-causal-percentile-v2",
            )
            self.assertTrue(diagnostics["portfolioMandate"]["available"])
            self.assertEqual(
                diagnostics["portfolioMandate"]["family"],
                "dollar-neutral",
            )
            self.assertEqual(
                diagnostics["portfolioMandate"]["id"],
                run.result["metrics"]["portfolio_mandate"]["id"],
            )
            self.assertTrue(diagnostics["executedBookRisk"]["available"])
            self.assertEqual(
                diagnostics["executedBookRisk"]["selectionAuthority"],
                "context-only",
            )
            self.assertEqual(
                diagnostics["executedBookRisk"]["validation"][
                    "executedBreachDates"
                ],
                0,
            )
            self.assertEqual(
                diagnostics["executedBookRisk"]["validation"][
                    "trialPaths"
                ],
                6,
            )
            self.assertTrue(diagnostics["factorFusion"]["available"])
            self.assertEqual(
                diagnostics["factorFusion"][
                    "meanValidationAdvantageVsCandidateFactor"
                ],
                run.result["metrics"]["comparison"][
                    "mean_validation_advantage_vs_candidate_factor"
                ],
            )
            self.assertEqual(
                diagnostics["summary"]["validation"]["mean"],
                run.result["metrics"]["validation_mean_net_sharpe"],
            )
            self.assertEqual(
                diagnostics["summary"]["meanValidationAdvantageVsBestBaseline"],
                run.result["metrics"]["comparison"][
                    "mean_validation_advantage_vs_best_baseline"
                ],
            )
            behavior = diagnostics["policyBehavior"]
            self.assertTrue(behavior["available"])
            self.assertEqual(
                behavior["policy"]["qScale"],
                "uncalibrated-linear-model-score",
            )
            self.assertEqual(
                behavior["policy"]["selectionAuthority"],
                "context-only",
            )
            self.assertEqual(behavior["validation"]["decisions"], 360)
            self.assertEqual(behavior["validation"]["trialPaths"], 6)
            self.assertEqual(len(behavior["validation"]["byAction"]), 5)
            self.assertEqual(
                {
                    item["feature"]
                    for item in behavior["validation"]["byFeature"]
                },
                set(diagnostics["protocol"]["featureNames"]),
            )
            self.assertTrue(
                behavior["validation"]["reconciliation"]["passed"]
            )
            self.assertEqual(
                {
                    item["split"]
                    for item in behavior["representativeDecisions"]
                },
                {"validation", "test"},
            )
            opportunity = diagnostics["factorOpportunity"]
            self.assertTrue(opportunity["available"])
            self.assertEqual(
                opportunity["policy"]["method"],
                "actual-pretrade-one-step-governed-action-audit-v1",
            )
            self.assertEqual(
                opportunity["selectionAuthority"],
                "context-only",
            )
            self.assertEqual(opportunity["validation"]["decisions"], 360)
            self.assertEqual(opportunity["validation"]["trialPaths"], 6)
            self.assertEqual(
                opportunity["validation"]["reconciliation"][
                    "action_evaluations"
                ],
                1800,
            )
            self.assertTrue(
                opportunity["validation"]["reconciliation"]["passed"]
            )
            self.assertEqual(
                {
                    item["split"]
                    for item in opportunity["representativeDecisions"]
                },
                {"validation", "test"},
            )
            self.assertTrue(
                all(
                    item["selectedBaseline"] == "contextual-ridge"
                    for item in diagnostics["trials"]
                )
            )
            incremental = diagnostics["incrementalAttribution"]
            self.assertTrue(incremental["available"])
            self.assertEqual(
                incremental["policy"]["comparison_path"],
                "independent-full-rollouts",
            )
            self.assertEqual(incremental["validation"]["decisions"], 360)
            self.assertEqual(incremental["validation"]["trialPaths"], 6)
            self.assertTrue(
                incremental["validation"]["reconciliation"]["passed"]
            )
            self.assertAlmostEqual(
                incremental["validation"][
                    "meanTrialTotalGrossActiveReturn"
                ]
                - incremental["validation"][
                    "meanTrialTotalIncrementalCost"
                ],
                incremental["validation"][
                    "meanTrialTotalNetActiveReturn"
                ],
            )
            self.assertEqual(
                {
                    item["asset"]
                    for item in incremental["validation"]["byAsset"]
                },
                set(diagnostics["dataset"]["universe"]),
            )
            self.assertEqual(
                {
                    item["split"]
                    for item in incremental["representativeDays"]
                },
                {"validation", "test"},
            )
            self.assertTrue(
                all(
                    sum(item["actionCounts"].values())
                    == diagnostics["protocol"]["ranges"][item["fold"]]["train"][
                        "observations"
                    ]
                    for item in diagnostics["training"]
                )
            )
            fusion_diagnosis = diagnostics["factorFusionDiagnosis"]
            self.assertTrue(fusion_diagnosis["available"])
            self.assertEqual(
                fusion_diagnosis["authority"],
                "research-prioritization-only",
            )
            self.assertEqual(
                fusion_diagnosis["tradingAuthority"],
                "none",
            )
            self.assertEqual(
                fusion_diagnosis["validation"]["role"],
                "selection",
            )
            self.assertEqual(
                fusion_diagnosis["testAudit"]["role"],
                "visible-audit",
            )
            self.assertFalse(
                fusion_diagnosis["semantics"]["testEntersDiagnosis"]
            )
            validation_diagnosis = fusion_diagnosis["validation"]
            candidate = validation_diagnosis["candidateFactor"]
            balanced_validation = [
                item["validation"]["netSharpe"]
                for item in diagnostics["baselines"]
                if item["name"] == "fixed:balanced"
            ]
            self.assertAlmostEqual(
                candidate["fixedSleeveSharpeDeltaVsBalanced"],
                diagnostics["factorFusion"]["candidateValidation"]["mean"]
                - sum(balanced_validation) / len(balanced_validation),
            )
            transmission = validation_diagnosis["adaptiveTransmission"]
            self.assertAlmostEqual(
                transmission["meanTrialGrossActiveReturn"]
                - transmission["meanTrialIncrementalCost"],
                transmission["meanTrialNetActiveReturn"],
            )
            self.assertEqual(
                validation_diagnosis["stability"]["trialPaths"],
                len(diagnostics["trials"]),
            )
            self.assertEqual(
                set(validation_diagnosis["lossLocator"]),
                {
                    "worstRegime",
                    "worstActionPair",
                    "worstSwitchState",
                    "worstAssetGrossContribution",
                },
            )
            jsonschema.validate(diagnostics, RL_DIAGNOSTICS_JSON_SCHEMA)

            snapshot = build_studio_snapshot(workspace.root_dir)
            observed = snapshot["projects"][0]
            self.assertEqual(
                observed["rlExplorer"]["run"]["id"],
                run.result["id"],
            )
            self.assertIn(
                "run.rl",
                [item["id"] for item in observed["commands"]],
            )

            result_path = run.root_dir / "result.json"
            report_path = run.root_dir / "artifacts" / "rl-report.json"
            models_path = run.root_dir / "artifacts" / "policy-models.json"
            rationale_path = (
                run.root_dir / "artifacts" / "policy-rationales.json"
            )
            opportunity_path = (
                run.root_dir / "artifacts" / "policy-opportunities.json"
            )
            incremental_path = (
                run.root_dir
                / "artifacts"
                / "policy-incremental-attribution.json"
            )
            legacy_result = json.loads(result_path.read_text(encoding="utf-8"))
            legacy_report = json.loads(report_path.read_text(encoding="utf-8"))
            legacy_models = json.loads(models_path.read_text(encoding="utf-8"))
            for value in (legacy_result, legacy_report):
                value["metrics"]["configuration"].pop("learningContract")
                value["metrics"]["research_integrity"].pop(
                    "learning_configuration"
                )
            legacy_report["semantics"].pop("learningConfiguration")
            legacy_models["configuration"].pop("learningContract")
            legacy_result["metrics"].pop("policy_rationale")
            legacy_result["metrics"].pop("factor_opportunity")
            legacy_result["metrics"].pop("incremental_attribution")
            legacy_result["artifacts"] = [
                item
                for item in legacy_result["artifacts"]
                if item["kind"]
                not in {
                    "policy-rationales",
                    "policy-opportunities",
                    "policy-incremental-attribution",
                }
            ]
            legacy_report["metrics"].pop("policy_rationale")
            legacy_report["metrics"].pop("factor_opportunity")
            legacy_report["metrics"].pop("incremental_attribution")
            result_path.write_text(
                json.dumps(legacy_result, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            report_path.write_text(
                json.dumps(legacy_report, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            models_path.write_text(
                json.dumps(legacy_models, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            rationale_path.unlink()
            opportunity_path.unlink()
            incremental_path.unlink()
            rehash_run(run.root_dir)
            legacy = load_rl_diagnostics(project, run.result["id"])
            self.assertFalse(legacy["policyBehavior"]["available"])
            self.assertFalse(legacy["factorOpportunity"]["available"])
            self.assertFalse(legacy["incrementalAttribution"]["available"])
            self.assertFalse(legacy["factorFusionDiagnosis"]["available"])
            self.assertIsNone(
                legacy["protocol"]["configuration"].get("learningContract")
            )
            jsonschema.validate(legacy, RL_DIAGNOSTICS_JSON_SCHEMA)

    def test_limits_and_rehashed_action_corruption_fail_structurally(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace, project, run = make_lab(Path(directory))
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "point_limit must be 40..400",
            ):
                load_rl_diagnostics(project, run.result["id"], point_limit=39)
            with patch(
                "autoquant.rl_explorer.MAX_ARTIFACT_BYTES",
                1,
            ), self.assertRaisesRegex(
                AutoQuantValidationError,
                "exceeds 1 bytes",
            ):
                load_rl_diagnostics(project, run.result["id"])

            actions_path = run.root_dir / "artifacts" / "policy-actions.csv"
            models_path = (
                run.root_dir / "artifacts" / "policy-models.json"
            )
            result_path = run.root_dir / "result.json"
            report_path = run.root_dir / "artifacts" / "rl-report.json"
            original_result = result_path.read_text(encoding="utf-8")
            original_report = report_path.read_text(encoding="utf-8")
            result_value = json.loads(original_result)
            report_value = json.loads(original_report)
            for value in (result_value, report_value):
                value["metrics"]["configuration"]["learningContract"][
                    "development_selection_scope"
                ] = "validation-guided"
                value["metrics"]["research_integrity"][
                    "learning_configuration"
                ]["development_selection_scope"] = "validation-guided"
            result_path.write_text(
                json.dumps(result_value, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            report_path.write_text(
                json.dumps(report_value, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            rehash_run(run.root_dir)
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Learning configuration provenance differs",
            ):
                load_rl_diagnostics(project, run.result["id"])
            result_path.write_text(original_result, encoding="utf-8")
            report_path.write_text(original_report, encoding="utf-8")
            rehash_run(run.root_dir)

            original_models = models_path.read_text(encoding="utf-8")
            models = json.loads(original_models)
            models["models"]["fold-1"]["contextualRidgeBaseline"][
                "history"
            ][0]["sharedPretradeActionEvaluations"] += 1
            models_path.write_text(
                json.dumps(models, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            rehash_run(run.root_dir)
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "action evaluations do not reconcile",
            ):
                load_rl_diagnostics(project, run.result["id"])
            models_path.write_text(original_models, encoding="utf-8")
            rehash_run(run.root_dir)

            rationale_path = (
                run.root_dir / "artifacts" / "policy-rationales.json"
            )
            original_rationale = rationale_path.read_text(encoding="utf-8")
            rationale = json.loads(original_rationale)
            rationale["rows"][0]["qValues"][
                rationale["actions"][0]
            ] += 0.125
            rationale_path.write_text(
                json.dumps(rationale, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            rehash_run(run.root_dir)
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "does not reconcile action Q value",
            ):
                load_rl_diagnostics(project, run.result["id"])
            rationale_path.write_text(original_rationale, encoding="utf-8")
            rehash_run(run.root_dir)

            opportunities_path = (
                run.root_dir / "artifacts" / "policy-opportunities.json"
            )
            original_opportunities = opportunities_path.read_text(
                encoding="utf-8"
            )
            opportunities = json.loads(original_opportunities)
            first_row = opportunities["rows"][0]
            first_asset = opportunities["assets"][0]
            if first_row["sharedExecution"] is None:
                selected = first_row["selectedAction"]
                executed = first_row["actions"][selected][
                    "executedWeights"
                ]
            else:
                executed = first_row["sharedExecution"][
                    "executedWeights"
                ]
            executed[first_asset] += 0.01
            opportunities_path.write_text(
                json.dumps(opportunities, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            rehash_run(run.root_dir)
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "executed minus pretrade weight",
            ):
                load_rl_diagnostics(project, run.result["id"])
            opportunities_path.write_text(
                original_opportunities,
                encoding="utf-8",
            )
            rehash_run(run.root_dir)

            incremental_path = (
                run.root_dir
                / "artifacts"
                / "policy-incremental-attribution.json"
            )
            original_incremental = incremental_path.read_text(
                encoding="utf-8"
            )
            incremental = json.loads(original_incremental)
            incremental["rows"][0]["assetGrossContribution"][
                incremental["assets"][0]
            ] += 0.01
            incremental_path.write_text(
                json.dumps(incremental, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            rehash_run(run.root_dir)
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "asset gross contribution",
            ):
                load_rl_diagnostics(project, run.result["id"])
            incremental_path.write_text(
                original_incremental,
                encoding="utf-8",
            )
            rehash_run(run.root_dir)

            original_actions = actions_path.read_text(encoding="utf-8")
            with actions_path.open(
                encoding="utf-8",
                newline="",
            ) as handle:
                rows = list(csv.DictReader(handle))
                fields = list(rows[0])
            active = next(
                row
                for row in rows
                if row["execution_risk_forecast_available"] == "True"
            )
            active["executed_risk_forecast_annualized"] = str(
                float(active["execution_risk_ceiling_annualized"]) + 0.01
            )
            with actions_path.open(
                "w",
                encoding="utf-8",
                newline="",
            ) as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerows(rows)
            rehash_run(run.root_dir)
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Action executed-book risk evidence is invalid",
            ):
                load_rl_diagnostics(project, run.result["id"])

            actions_path.write_text(original_actions, encoding="utf-8")
            rehash_run(run.root_dir)
            with actions_path.open(
                encoding="utf-8",
                newline="",
            ) as handle:
                rows = list(csv.DictReader(handle))
                fields = list(rows[0])
            rows[0]["execution_risk_observations"] = "2.5"
            with actions_path.open(
                "w",
                encoding="utf-8",
                newline="",
            ) as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerows(rows)
            rehash_run(run.root_dir)
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Expected a non-negative integer",
            ):
                load_rl_diagnostics(project, run.result["id"])

            actions_path.write_text(original_actions, encoding="utf-8")
            rehash_run(run.root_dir)
            lines = actions_path.read_text(encoding="utf-8").splitlines()
            actions_path.write_text(
                "\n".join(lines[:-1]) + "\n",
                encoding="utf-8",
            )
            rehash_run(run.root_dir)

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Action rows do not match declared split observations",
            ):
                load_rl_diagnostics(project, run.result["id"])

            snapshot = build_studio_snapshot(workspace.root_dir)
            observed = snapshot["projects"][0]
            self.assertIsNone(observed["rlExplorer"])
            self.assertFalse(observed["valid"])
            self.assertTrue(
                any(
                    item["category"].startswith("rl-explorer:")
                    for item in observed["diagnostics"]
                )
            )


if __name__ == "__main__":
    unittest.main()
