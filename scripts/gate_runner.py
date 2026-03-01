#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable

from attestation import validate_attestation
from dataset_snapshot_lock import build_snapshot, load_or_create_snapshot
from gate_checks_g0 import run_g0
from gate_common import (
    append_ndjson,
    canonical_json_hash,
    read_json,
    read_json_compat,
    sha256_file,
    utc_now_iso,
    write_json,
)
from runner_guard import STATE_OPEN, evaluate_runner_guard, load_history
from stress_metrics import FORMULA_HASH, FORMULA_ID, stress_net_trim10_decline

EXIT_OK = 0
EXIT_POLICY_FAIL = 2
EXIT_TOOL_ERROR = 3

STATUS_PASS = "pass"
STATUS_POLICY_FAIL = "policy_fail"
STATUS_TOOL_ERROR = "tool_error"
STATUS_SKIPPED = "skipped"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run V5.1.1 gate pipeline (G0-G4).")
    parser.add_argument("--repo-root", default=".")
    parser.add_argument(
        "--profile",
        default="data/config/profiles/profile_m0_72h.v5_1.yaml",
    )
    parser.add_argument(
        "--registry",
        default="data/config/metric_registry.v1.yaml",
    )
    parser.add_argument(
        "--reason-codes",
        default="docs/research/templates/verdict_reason_codes.v1.json",
    )
    parser.add_argument(
        "--owners",
        default="data/config/acting_owners.v1.json",
    )
    parser.add_argument(
        "--source-fallback-policy",
        default="data/config/source_fallback_policy.v1.json",
    )
    parser.add_argument(
        "--runner-guard-policy",
        default="data/config/runner_guard_policy.v1.json",
    )
    parser.add_argument(
        "--history",
        default="data/runtime/gates/history.ndjson",
        help="Gate checkpoint history NDJSON.",
    )
    parser.add_argument(
        "--output-root",
        default="data/runtime/gates",
        help="Output root directory for run folders and guard state.",
    )
    parser.add_argument("--run-id", default=None)
    parser.add_argument(
        "--resumed-from-run-id",
        default=None,
        help="Optional previous run id when continuing a failed run.",
    )
    parser.add_argument(
        "--attestation",
        default=None,
        help="Path to attestation payload for G4.",
    )
    parser.add_argument(
        "--research-cards",
        default="data/research/strategy-watch/latest_experiment_cards.json",
    )
    parser.add_argument(
        "--admission-report",
        default="data/research/strategy-watch/admission/latest_strategy_admission_report.json",
    )
    parser.add_argument(
        "--external-benchmark-report",
        default="data/research/external-benchmark/latest_external_benchmark_report.json",
    )
    parser.add_argument(
        "--health-report",
        default="data/research/strategy-watch/health/latest_health_report.json",
    )
    parser.add_argument(
        "--strategy-metrics",
        default="data/runtime/gates/strategy_metrics.json",
        help="Optional strategy metrics input for G3.",
    )
    parser.add_argument(
        "--budget-usage",
        default="data/runtime/gates/model_budget_usage.json",
        help="Optional budget usage input for G3.",
    )
    parser.add_argument(
        "--dataset-path",
        default="data/research/strategy-watch/latest_experiment_cards.json",
    )
    parser.add_argument(
        "--features-path",
        default="data/research/external-benchmark/latest_external_benchmark_report.json",
    )
    parser.add_argument(
        "--labels-path",
        default="data/research/strategy-watch/admission/latest_strategy_admission_report.json",
    )
    parser.add_argument(
        "--split-path",
        default="data/research/strategy-watch/health/latest_health_report.json",
    )
    parser.add_argument(
        "--verdict-output",
        default=None,
        help="Optional verdict output path. Defaults to <run_dir>/verdict.v2.json",
    )
    return parser.parse_args()


def _numeric(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _tail(value: str, max_lines: int = 20) -> str:
    lines = value.strip().splitlines()
    if len(lines) <= max_lines:
        return "\n".join(lines)
    return "\n".join(lines[-max_lines:])


def _dedup(values: list[str]) -> list[str]:
    out: list[str] = []
    for value in values:
        if value not in out:
            out.append(value)
    return out


def _read_optional_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    payload = read_json(path)
    return payload


def _as_float(value: Any) -> float | None:
    if _numeric(value):
        return float(value)
    return None


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def _pick_number(payload: dict[str, Any], keys: list[str]) -> float | None:
    for key in keys:
        if key not in payload:
            continue
        value = _as_float(payload.get(key))
        if value is not None:
            return value
    return None


def _pick_int(payload: dict[str, Any], keys: list[str]) -> int | None:
    for key in keys:
        if key not in payload:
            continue
        value = _as_int(payload.get(key))
        if value is not None:
            return value
    return None


def _canonical_reason_codes(reason_codes_path: Path) -> set[str]:
    payload = read_json(reason_codes_path)
    values: set[str] = set()
    for item in payload.get("codes", []):
        if not isinstance(item, dict):
            continue
        code = item.get("code")
        if isinstance(code, str) and code:
            values.add(code)
    return values


def _metric_versions(registry: dict[str, Any]) -> dict[str, str]:
    metrics = registry.get("metrics")
    if not isinstance(metrics, dict):
        return {}
    out: dict[str, str] = {}
    for metric_name, spec in metrics.items():
        if not isinstance(metric_name, str) or not isinstance(spec, dict):
            continue
        version = spec.get("metric_version")
        if isinstance(version, str):
            out[metric_name] = version
    return out


def _run_python(
    repo_root: Path,
    script_rel: str,
    extra_args: list[str],
    timeout_seconds: int,
) -> dict[str, Any]:
    script_path = repo_root / script_rel
    cmd = [sys.executable, str(script_path), *extra_args]
    started_at = time.perf_counter()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(repo_root),
            text=True,
            capture_output=True,
            check=False,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired:
        duration_ms = int((time.perf_counter() - started_at) * 1000)
        return {
            "status": STATUS_TOOL_ERROR,
            "exitCode": None,
            "durationMs": duration_ms,
            "stdoutTail": "",
            "stderrTail": "timeout",
            "blockingIssue": f"timeout while running {' '.join(cmd)}",
        }
    except Exception as exc:  # noqa: BLE001
        duration_ms = int((time.perf_counter() - started_at) * 1000)
        return {
            "status": STATUS_TOOL_ERROR,
            "exitCode": None,
            "durationMs": duration_ms,
            "stdoutTail": "",
            "stderrTail": str(exc),
            "blockingIssue": f"tool_error while running {' '.join(cmd)}: {exc}",
        }

    duration_ms = int((time.perf_counter() - started_at) * 1000)
    if proc.returncode == 0:
        status = STATUS_PASS
    elif proc.returncode == 2:
        status = STATUS_POLICY_FAIL
    else:
        status = STATUS_TOOL_ERROR

    return {
        "status": status,
        "exitCode": proc.returncode,
        "durationMs": duration_ms,
        "stdoutTail": _tail(proc.stdout),
        "stderrTail": _tail(proc.stderr),
        "blockingIssue": None,
    }


def _gate_timeout_seconds(profile: dict[str, Any], gate: str) -> int:
    value = 60
    timeouts = profile.get("timeouts_minutes")
    if isinstance(timeouts, dict):
        raw = timeouts.get(gate)
        if isinstance(raw, int) and raw > 0:
            value = raw
    return value * 60


def _gate_retry_cfg(profile: dict[str, Any], gate: str) -> tuple[int, int]:
    retries = profile.get("retries")
    if not isinstance(retries, dict):
        return 0, 0
    gate_cfg = retries.get(gate)
    if not isinstance(gate_cfg, dict):
        return 0, 0
    max_attempts = gate_cfg.get("max_attempts")
    interval_seconds = gate_cfg.get("interval_seconds")
    max_attempts_int = max_attempts if isinstance(max_attempts, int) and max_attempts >= 0 else 0
    interval_int = (
        interval_seconds
        if isinstance(interval_seconds, int) and interval_seconds >= 0
        else 0
    )
    return max_attempts_int, interval_int


def _call_gate_fn_with_timeout(
    gate_fn: Callable[[int], dict[str, Any]],
    attempt: int,
    timeout_seconds: int,
) -> dict[str, Any]:
    if timeout_seconds <= 0:
        return gate_fn(attempt)

    if hasattr(signal, "SIGALRM") and hasattr(signal, "setitimer"):
        timed_out = False

        def _timeout_handler(_: int, __: Any) -> None:
            nonlocal timed_out
            timed_out = True
            raise TimeoutError(f"gate execution timed out after {timeout_seconds}s")

        previous_handler = signal.getsignal(signal.SIGALRM)
        signal.signal(signal.SIGALRM, _timeout_handler)
        signal.setitimer(signal.ITIMER_REAL, float(timeout_seconds))
        try:
            return gate_fn(attempt)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0.0)
            signal.signal(signal.SIGALRM, previous_handler)
            if timed_out:
                # keep explicit state for debugging even though exception already raised
                pass

    started = time.perf_counter()
    outcome = gate_fn(attempt)
    elapsed_seconds = time.perf_counter() - started
    if elapsed_seconds > timeout_seconds:
        raise TimeoutError(
            f"gate execution exceeded timeout ({elapsed_seconds:.3f}s > {timeout_seconds}s)"
        )
    return outcome


def _build_checkpoint(
    *,
    gate: str,
    run_id: str,
    attempt: int,
    resumed_from: str | None,
    status: str,
    reason_codes: list[str],
    blocking_issues: list[str],
    started_at: str,
    ended_at: str,
    duration_ms: int,
    profile_hash: str,
    thresholds_hash: str,
    statistics_lock_hash: str,
    registry_version: str,
    metric_versions: dict[str, str],
    dataset_snapshot_hash: str | None,
    decision_weight: str | None,
    attestation: dict[str, Any] | None,
    details: dict[str, Any],
) -> dict[str, Any]:
    idempotency_key = canonical_json_hash(
        {
            "runId": run_id,
            "gate": gate,
            "attempt": attempt,
            "profileHash": profile_hash,
        }
    )
    return {
        "version": "v1",
        "gate": gate,
        "runId": run_id,
        "attempt": attempt,
        "idempotencyKey": idempotency_key,
        "resumedFrom": resumed_from,
        "status": status,
        "reasonCodes": _dedup(reason_codes),
        "blockingIssues": blocking_issues,
        "startedAt": started_at,
        "endedAt": ended_at,
        "durationMs": max(duration_ms, 0),
        "profileHash": profile_hash,
        "thresholdsHash": thresholds_hash,
        "statisticsLockHash": statistics_lock_hash,
        "registryVersion": registry_version,
        "metricVersions": metric_versions,
        "datasetSnapshotHash": dataset_snapshot_hash,
        "decisionWeight": decision_weight,
        "attestation": attestation,
        "details": details,
    }


def _evaluate_runner_guard(
    *,
    output_root: Path,
    history_path: Path,
    policy_path: Path,
) -> tuple[dict[str, Any], bool]:
    policy = read_json(policy_path)
    history = load_history(history_path)
    state_path = output_root / "runner_guard_state.json"
    previous_state = "closed"
    if state_path.exists():
        state_payload = read_json(state_path)
        state_raw = state_payload.get("state")
        if isinstance(state_raw, str):
            previous_state = state_raw

    report = evaluate_runner_guard(policy, history, previous_state)
    write_json(output_root / "runner_guard_latest_report.json", report)
    write_json(
        state_path,
        {"state": report["state"], "updatedAt": report["generatedAt"]},
    )
    mode = str(policy.get("mode", "learning")).lower()
    hard_open = report["state"] == STATE_OPEN and mode != "learning"
    return report, hard_open


def _gate_g1(
    *,
    repo_root: Path,
    run_dir: Path,
    timeout_seconds: int,
    profile: dict[str, Any],
) -> dict[str, Any]:
    g1_cfg = profile.get("g1")
    if not isinstance(g1_cfg, dict):
        g1_cfg = {}

    checks: list[dict[str, Any]] = []
    reasons: list[str] = []
    issues: list[str] = []

    env_report = run_dir / "g1_env_verify_report.json"
    env_check = _run_python(
        repo_root,
        "scripts/verify_environment_lock.py",
        ["--output", str(env_report)],
        timeout_seconds,
    )
    env_check["name"] = "verify_environment_lock"
    checks.append(env_check)

    freeze_report = run_dir / "g1_freeze_verify_report.json"
    freeze_check = _run_python(
        repo_root,
        "scripts/verify_freeze_manifest.py",
        ["--output", str(freeze_report)],
        timeout_seconds,
    )
    freeze_check["name"] = "verify_freeze_manifest"
    checks.append(freeze_check)

    sync_report = run_dir / "g1_post_pull_sync_report.json"
    sync_check = _run_python(
        repo_root,
        "scripts/post_pull_sync.py",
        ["--repo-root", str(repo_root), "--output", str(sync_report)],
        timeout_seconds,
    )
    sync_check["name"] = "post_pull_sync"
    checks.append(sync_check)

    required_map = {
        "verify_environment_lock": bool(g1_cfg.get("require_env_lock_passed", True)),
        "verify_freeze_manifest": bool(g1_cfg.get("require_freeze_manifest_passed", True)),
        "post_pull_sync": bool(g1_cfg.get("require_post_pull_sync_passed", True)),
    }
    reason_map = {
        "verify_environment_lock": "HARD_ENV_MISMATCH",
        "verify_freeze_manifest": "HARD_FREEZE_MANIFEST_INVALID",
        "post_pull_sync": "HARD_HARD_GATE_CHECK_FAILED",
    }

    status = STATUS_PASS
    for check in checks:
        name = str(check.get("name", "unknown"))
        required = required_map.get(name, True)
        check_status = str(check.get("status", STATUS_TOOL_ERROR))
        if not required:
            continue
        if check_status == STATUS_PASS:
            continue
        if check_status == STATUS_TOOL_ERROR:
            status = STATUS_TOOL_ERROR
        elif status != STATUS_TOOL_ERROR:
            status = STATUS_POLICY_FAIL
        reasons.append(reason_map.get(name, "HARD_HARD_GATE_CHECK_FAILED"))
        blocking_issue = check.get("blockingIssue")
        if isinstance(blocking_issue, str) and blocking_issue:
            issues.append(blocking_issue)
        else:
            issues.append(f"{name} failed with status={check_status}")

    return {
        "status": status,
        "reasonCodes": _dedup(reasons),
        "blockingIssues": issues,
        "details": {"checks": checks},
        "datasetSnapshotHash": None,
        "attestation": None,
    }


def _gate_g2(*, research_cards_path: Path, profile: dict[str, Any]) -> dict[str, Any]:
    research_cfg = profile.get("research")
    if not isinstance(research_cfg, dict):
        research_cfg = {}

    reasons: list[str] = []
    issues: list[str] = []
    details: dict[str, Any] = {}

    if not research_cards_path.exists():
        return {
            "status": STATUS_POLICY_FAIL,
            "reasonCodes": ["HARD_METRIC_MISSING"],
            "blockingIssues": [f"research cards file not found: {research_cards_path}"],
            "details": {"cardsPath": str(research_cards_path)},
            "datasetSnapshotHash": None,
            "attestation": None,
        }

    payload = read_json(research_cards_path)
    cards = payload.get("cards")
    if not isinstance(cards, list):
        cards = []
    card_count = payload.get("card_count")
    if not isinstance(card_count, int):
        card_count = len(cards)

    min_cards = research_cfg.get("min_cards")
    min_cards_int = min_cards if isinstance(min_cards, int) else 0
    if card_count < min_cards_int:
        issues.append(f"card_count below threshold: {card_count} < {min_cards_int}")
        reasons.append("HARD_THRESHOLD_BREACH")

    required_fields = research_cfg.get("required_fields")
    required_field_list = [str(item) for item in required_fields] if isinstance(required_fields, list) else []
    missing_field_count = 0
    if required_field_list:
        for item in cards:
            if not isinstance(item, dict):
                missing_field_count += len(required_field_list)
                continue
            for field in required_field_list:
                value = item.get(field)
                if value is None or (isinstance(value, str) and not value.strip()):
                    missing_field_count += 1
    denominator = max(card_count * max(len(required_field_list), 1), 1)
    missing_ratio = missing_field_count / denominator
    missing_ratio_max = _as_float(research_cfg.get("required_field_missing_ratio_max")) or 0.0
    if missing_ratio > missing_ratio_max:
        issues.append(
            f"required_field_missing_ratio exceeded: {missing_ratio:.6f} > {missing_ratio_max:.6f}"
        )
        reasons.append("HARD_THRESHOLD_BREACH")

    unresolved_conflicts = 0
    traceable_count = 0
    citation_parse_count = 0
    for item in cards:
        if not isinstance(item, dict):
            continue
        conflict_status = item.get("conflict_status")
        if isinstance(conflict_status, str) and conflict_status.lower() in {"open", "unresolved"}:
            unresolved_conflicts += 1
        card_id = item.get("card_id")
        paper_id = item.get("source_paper_id")
        title = item.get("source_title")
        if all(isinstance(x, str) and x.strip() for x in (card_id, paper_id, title)):
            traceable_count += 1
        if isinstance(paper_id, str) and paper_id.strip():
            citation_parse_count += 1

    unresolved_ratio = unresolved_conflicts / max(card_count, 1)
    unresolved_ratio_max = _as_float(research_cfg.get("unresolved_conflict_ratio_max")) or 0.0
    if unresolved_ratio > unresolved_ratio_max:
        issues.append(
            f"unresolved_conflict_ratio exceeded: {unresolved_ratio:.6f} > {unresolved_ratio_max:.6f}"
        )
        reasons.append("HARD_THRESHOLD_BREACH")

    traceability_ratio = traceable_count / max(card_count, 1)
    traceability_min = _as_float(research_cfg.get("traceability_ratio_min")) or 0.0
    if traceability_ratio < traceability_min:
        issues.append(
            f"traceability_ratio below threshold: {traceability_ratio:.6f} < {traceability_min:.6f}"
        )
        reasons.append("HARD_THRESHOLD_BREACH")

    citation_parse_ratio = citation_parse_count / max(card_count, 1)
    citation_parse_min = _as_float(research_cfg.get("citation_parse_ratio_min")) or 0.0
    if citation_parse_ratio < citation_parse_min:
        issues.append(
            f"citation_parse_ratio below threshold: {citation_parse_ratio:.6f} < {citation_parse_min:.6f}"
        )
        reasons.append("HARD_THRESHOLD_BREACH")

    details.update(
        {
            "cardsPath": str(research_cards_path),
            "cardCount": card_count,
            "missingFieldCount": missing_field_count,
            "requiredFieldMissingRatio": round(missing_ratio, 6),
            "unresolvedConflictRatio": round(unresolved_ratio, 6),
            "traceabilityRatio": round(traceability_ratio, 6),
            "citationParseRatio": round(citation_parse_ratio, 6),
        }
    )

    status = STATUS_PASS if not issues else STATUS_POLICY_FAIL
    if not cards:
        reasons.append("HARD_METRIC_MISSING")
        if status != STATUS_POLICY_FAIL:
            status = STATUS_POLICY_FAIL
            issues.append("cards list is empty")

    return {
        "status": status,
        "reasonCodes": _dedup(reasons),
        "blockingIssues": issues,
        "details": details,
        "datasetSnapshotHash": None,
        "attestation": None,
    }


def _gate_g3(
    *,
    run_id: str,
    run_dir: Path,
    profile: dict[str, Any],
    registry: dict[str, Any],
    strategy_metrics_path: Path,
    admission_report_path: Path,
    external_report_path: Path,
    health_report_path: Path,
    budget_usage_path: Path,
    dataset_path: Path,
    features_path: Path,
    labels_path: Path,
    split_path: Path,
) -> dict[str, Any]:
    validation_mode = str(profile.get("validation_mode", "strict")).lower()
    strict_mode = validation_mode != "tolerant"
    strategy_cfg = profile.get("strategy")
    if not isinstance(strategy_cfg, dict):
        strategy_cfg = {}

    reasons: list[str] = []
    issues: list[str] = []
    warnings: list[str] = []
    details: dict[str, Any] = {
        "formula": {"id": FORMULA_ID, "hash": FORMULA_HASH},
    }

    strategy_metrics = _read_optional_json(strategy_metrics_path) or {}
    admission = _read_optional_json(admission_report_path) or {}
    external = _read_optional_json(external_report_path) or {}
    health = _read_optional_json(health_report_path) or {}
    budget_usage = _read_optional_json(budget_usage_path) or {}

    if strategy_metrics_path.exists():
        details["strategyMetricsPath"] = str(strategy_metrics_path)
    if admission_report_path.exists():
        details["admissionReportPath"] = str(admission_report_path)
    if external_report_path.exists():
        details["externalReportPath"] = str(external_report_path)
    if health_report_path.exists():
        details["healthReportPath"] = str(health_report_path)
    if budget_usage_path.exists():
        details["budgetUsagePath"] = str(budget_usage_path)

    rows = admission.get("rows")
    if not isinstance(rows, list):
        rows = []
    poc_count = _pick_int(admission, ["total_candidates"]) or len(rows)
    pass_candidates = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        if row.get("main_eligible") is True or row.get("transfer_pass") is True:
            pass_candidates += 1

    min_poc_count = _as_int(strategy_cfg.get("min_poc_count")) or 0
    if poc_count < min_poc_count:
        issues.append(f"min_poc_count not met: {poc_count} < {min_poc_count}")
        reasons.append("HARD_INSUFFICIENT_SAMPLE")
    pass_candidates_min = _as_int(strategy_cfg.get("pass_candidates_min")) or 0
    if pass_candidates < pass_candidates_min:
        issues.append(
            f"pass_candidates_min not met: {pass_candidates} < {pass_candidates_min}"
        )
        reasons.append("HARD_INSUFFICIENT_SAMPLE")

    metrics: dict[str, float] = {}
    missing_metrics: list[str] = []

    int_metric_mapping = {
        "min_trades": ["min_trades", "trade_count", "trades"],
        "min_backtest_days": ["min_backtest_days", "backtest_days", "days"],
        "min_effective_observations": [
            "min_effective_observations",
            "effective_observations",
            "effective_n",
        ],
    }
    for metric_name, aliases in int_metric_mapping.items():
        value = _pick_int(strategy_metrics, aliases)
        if value is None:
            missing_metrics.append(metric_name)
            continue
        metrics[metric_name] = float(value)
        threshold = _as_int(strategy_cfg.get(metric_name)) or 0
        if value < threshold:
            issues.append(f"{metric_name} not met: {value} < {threshold}")
            reasons.append("HARD_INSUFFICIENT_SAMPLE")

    float_metric_mapping = {
        "pbo": ["pbo", "meanPbo"],
        "dsr_probability": ["dsr_probability", "meanDsrProbability"],
        "fdr_q": ["fdr_q", "fdrQ"],
    }
    for metric_name, aliases in float_metric_mapping.items():
        value = _pick_number(strategy_metrics, aliases)
        if value is None:
            missing_metrics.append(metric_name)
            continue
        metrics[metric_name] = value

    pbo_max = _as_float(strategy_cfg.get("pbo_max"))
    if pbo_max is not None and "pbo" in metrics and metrics["pbo"] > pbo_max:
        issues.append(f"pbo exceeds threshold: {metrics['pbo']:.6f} > {pbo_max:.6f}")
        reasons.append("HARD_THRESHOLD_BREACH")
    dsr_min = _as_float(strategy_cfg.get("dsr_probability_min"))
    if dsr_min is not None and "dsr_probability" in metrics and metrics["dsr_probability"] < dsr_min:
        issues.append(
            f"dsr_probability below threshold: {metrics['dsr_probability']:.6f} < {dsr_min:.6f}"
        )
        reasons.append("HARD_THRESHOLD_BREACH")
    fdr_max = _as_float(strategy_cfg.get("fdr_q_max"))
    if fdr_max is not None and "fdr_q" in metrics and metrics["fdr_q"] > fdr_max:
        issues.append(f"fdr_q exceeds threshold: {metrics['fdr_q']:.6f} > {fdr_max:.6f}")
        reasons.append("HARD_THRESHOLD_BREACH")

    baseline = _pick_number(strategy_metrics, ["baseline_net_trim10_mean"])
    candidate = _pick_number(strategy_metrics, ["candidate_net_trim10_mean"])
    if baseline is None and isinstance(external.get("baseline"), dict):
        baseline = _pick_number(external["baseline"], ["net_trim10_mean"])
    if candidate is None:
        aggregate = external.get("aggregate")
        if isinstance(aggregate, list):
            best_candidate: float | None = None
            for row in aggregate:
                if not isinstance(row, dict):
                    continue
                value = _pick_number(row, ["net_trim10_mean"])
                if value is None:
                    continue
                if best_candidate is None or value > best_candidate:
                    best_candidate = value
            candidate = best_candidate

    stress_decline: float | None = None
    if baseline is not None and candidate is not None:
        stress_decline = stress_net_trim10_decline(baseline, candidate)
        metrics["stress_net_trim10_decline"] = stress_decline
        stress_max = _as_float(strategy_cfg.get("stress_net_trim10_decline_max"))
        if stress_max is not None and stress_decline > stress_max:
            issues.append(
                f"stress_net_trim10_decline exceeds threshold: {stress_decline:.6f} > {stress_max:.6f}"
            )
            reasons.append("HARD_THRESHOLD_BREACH")
    else:
        missing_metrics.append("stress_net_trim10_decline")
        reasons.append("HARD_STRESS_METRIC_UNDEFINED")
        issues.append("stress metric inputs missing (baseline/candidate)")

    if strategy_metrics.get("leakage_detected") is True:
        issues.append("leakage_detected=true")
        reasons.append("HARD_LEAKAGE_DETECTED")

    source_health_cfg = profile.get("source_health")
    if not isinstance(source_health_cfg, dict):
        source_health_cfg = {}
    if health:
        stale_watch = _pick_number(health, ["stale_watch_minutes"])
        stale_optimize = _pick_number(health, ["stale_optimize_minutes"])
        stale_queue = _pick_number(health, ["stale_queue_drain_minutes"])
        queue_length = _pick_number(health, ["queue_length"])
        legacy_ratio = _pick_number(health, ["queue_legacy_ratio"])

        checks = [
            ("stale_watch_minutes", stale_watch, _as_float(source_health_cfg.get("stale_watch_minutes_max"))),
            ("stale_optimize_minutes", stale_optimize, _as_float(source_health_cfg.get("stale_optimize_minutes_max"))),
            ("stale_queue_drain_minutes", stale_queue, _as_float(source_health_cfg.get("stale_queue_drain_minutes_max"))),
            ("queue_length", queue_length, _as_float(source_health_cfg.get("queue_length_max"))),
            ("queue_legacy_ratio", legacy_ratio, _as_float(source_health_cfg.get("legacy_ratio_max"))),
        ]
        for name, value, threshold in checks:
            if threshold is None:
                continue
            if value is None:
                msg = f"source health metric missing: {name}"
                if strict_mode:
                    issues.append(msg)
                    reasons.append("HARD_SOURCE_HEALTH_FAIL")
                else:
                    warnings.append(msg)
                continue
            if value > threshold:
                issues.append(f"source health threshold breach: {name}={value} > {threshold}")
                reasons.append("HARD_SOURCE_HEALTH_FAIL")
    elif strict_mode:
        issues.append(f"missing source health report: {health_report_path}")
        reasons.append("HARD_SOURCE_HEALTH_FAIL")

    budget_cfg = profile.get("budget")
    if not isinstance(budget_cfg, dict):
        budget_cfg = {}
    if budget_usage:
        daily_tokens = _pick_number(
            budget_usage,
            ["daily_tokens", "daily_token_usage", "dailyTokenUsage", "dailyTokens"],
        )
        per_task_tokens = _pick_number(
            budget_usage,
            ["per_task_tokens", "per_task_token_usage", "perTaskTokenUsage"],
        )
        daily_cost = _pick_number(
            budget_usage,
            ["daily_cost_usd", "dailyCostUsd", "cost_usd", "daily_cost"],
        )

        hard_daily_tokens = _as_float(budget_cfg.get("daily_token_hard_cap"))
        hard_per_task_tokens = _as_float(budget_cfg.get("per_task_token_hard_cap"))
        hard_cost = _as_float(budget_cfg.get("cost_hard_cap_usd"))
        soft_daily_tokens = _as_float(budget_cfg.get("daily_token_soft_cap"))
        soft_cost = _as_float(budget_cfg.get("cost_soft_cap_usd"))

        if daily_tokens is not None and hard_daily_tokens is not None and daily_tokens > hard_daily_tokens:
            issues.append(
                f"daily token hard cap breach: {daily_tokens:.0f} > {hard_daily_tokens:.0f}"
            )
            reasons.append("HARD_BUDGET_HARD_CAP_HIT")
        if per_task_tokens is not None and hard_per_task_tokens is not None and per_task_tokens > hard_per_task_tokens:
            issues.append(
                f"per-task token hard cap breach: {per_task_tokens:.0f} > {hard_per_task_tokens:.0f}"
            )
            reasons.append("HARD_BUDGET_HARD_CAP_HIT")
        if daily_cost is not None and hard_cost is not None and daily_cost > hard_cost:
            issues.append(f"daily cost hard cap breach: {daily_cost:.4f} > {hard_cost:.4f}")
            reasons.append("HARD_BUDGET_HARD_CAP_HIT")

        if daily_tokens is not None and soft_daily_tokens is not None and daily_tokens > soft_daily_tokens:
            warnings.append(
                f"daily token soft cap exceeded: {daily_tokens:.0f} > {soft_daily_tokens:.0f}"
            )
        if daily_cost is not None and soft_cost is not None and daily_cost > soft_cost:
            warnings.append(f"daily cost soft cap exceeded: {daily_cost:.4f} > {soft_cost:.4f}")
    elif strict_mode:
        issues.append(f"missing budget usage report: {budget_usage_path}")
        reasons.append("HARD_METRIC_MISSING")

    registry_stats_lock = registry.get("statistics_lock")
    candidate_stats_lock = strategy_metrics.get("statistics_lock")
    if isinstance(candidate_stats_lock, dict) and isinstance(registry_stats_lock, dict):
        if canonical_json_hash(candidate_stats_lock) != canonical_json_hash(registry_stats_lock):
            issues.append("statistics_lock mismatch between registry and strategy metrics")
            reasons.append("HARD_STAT_METHOD_MISMATCH")

    dataset_lock_path = run_dir / "dataset_snapshot_lock.json"
    try:
        locked_snapshot = load_or_create_snapshot(
            run_id=run_id,
            dataset_path=dataset_path,
            features_path=features_path,
            labels_path=labels_path,
            split_path=split_path,
            output_path=dataset_lock_path,
            reuse_existing=True,
        )
        live_snapshot = build_snapshot(
            run_id=run_id,
            dataset_path=dataset_path,
            features_path=features_path,
            labels_path=labels_path,
            split_path=split_path,
        )
        for hash_key in ("datasetHash", "featuresHash", "labelHash", "splitHash"):
            if locked_snapshot.get(hash_key) != live_snapshot.get(hash_key):
                issues.append(f"dataset snapshot drift on {hash_key}")
                reasons.append("HARD_DATASET_SNAPSHOT_DRIFT")
                break
    except FileNotFoundError as exc:
        issues.append(str(exc))
        reasons.append("HARD_DATASET_SNAPSHOT_DRIFT")
    except Exception as exc:  # noqa: BLE001
        issues.append(f"dataset snapshot tool_error: {exc}")
        reasons.append("HARD_DATASET_SNAPSHOT_DRIFT")

    if missing_metrics:
        message = f"missing metrics: {', '.join(sorted(set(missing_metrics)))}"
        if strict_mode:
            issues.append(message)
            reasons.append("HARD_METRIC_MISSING")
        else:
            warnings.append(message)

    status = STATUS_PASS if not issues else STATUS_POLICY_FAIL
    details.update(
        {
            "strategyMetrics": metrics,
            "warnings": warnings,
            "pocCount": poc_count,
            "passCandidates": pass_candidates,
            "statisticsLockHash": canonical_json_hash(registry.get("statistics_lock", {})),
            "thresholdsHash": canonical_json_hash(profile.get("strategy", {})),
        }
    )
    if dataset_lock_path.exists():
        details["datasetSnapshotLockPath"] = str(dataset_lock_path)
        details["datasetSnapshotHash"] = sha256_file(dataset_lock_path)
    return {
        "status": status,
        "reasonCodes": _dedup(reasons),
        "blockingIssues": issues,
        "details": details,
        "datasetSnapshotHash": details.get("datasetSnapshotHash"),
        "attestation": None,
    }


def _gate_g4(
    *,
    attestation_path: Path | None,
    owners_path: Path,
    source_fallback_policy_path: Path,
) -> dict[str, Any]:
    reasons: list[str] = []
    issues: list[str] = []
    details: dict[str, Any] = {}
    attestation_summary: dict[str, Any] | None = None

    if attestation_path is None:
        issues.append("missing attestation path")
        reasons.append("HARD_HARD_GATE_CHECK_FAILED")
    elif not attestation_path.exists():
        issues.append(f"attestation file not found: {attestation_path}")
        reasons.append("HARD_HARD_GATE_CHECK_FAILED")
    else:
        owners_payload = read_json(owners_path)
        attestation_payload = read_json(attestation_path)
        passed, attestation_issues = validate_attestation(attestation_payload, owners_payload)
        details["attestationPath"] = str(attestation_path)
        if not passed:
            issues.extend(attestation_issues)
            reasons.append("HARD_HARD_GATE_CHECK_FAILED")
        attestation_summary = {
            "mode": attestation_payload.get("mode"),
            "attestedBy": attestation_payload.get("attestedBy"),
            "reviewedBy": attestation_payload.get("reviewedBy"),
            "passed": passed,
            "issues": attestation_issues,
        }

    source_policy = read_json(source_fallback_policy_path)
    mode = source_policy.get("mode")
    details["sourceFallbackMode"] = mode
    if mode == "archive_only":
        details["archiveOnlyAllowedOutputs"] = source_policy.get("archiveOnly", {}).get("allowedOutputs")

    status = STATUS_PASS if not issues else STATUS_POLICY_FAIL
    return {
        "status": status,
        "reasonCodes": _dedup(reasons),
        "blockingIssues": issues,
        "details": details,
        "datasetSnapshotHash": None,
        "attestation": attestation_summary,
    }


def _run_gate_with_retry(
    *,
    gate: str,
    run_id: str,
    resumed_from: str | None,
    profile: dict[str, Any],
    registry: dict[str, Any],
    profile_hash: str,
    run_dir: Path,
    checkpoints_dir: Path,
    history_path: Path,
    decision_weight: str | None,
    gate_fn: Callable[[int], dict[str, Any]],
) -> dict[str, Any]:
    retry_on = profile.get("retry_on_status")
    retry_statuses = [str(item) for item in retry_on] if isinstance(retry_on, list) else [STATUS_TOOL_ERROR]
    max_retries, retry_interval_seconds = _gate_retry_cfg(profile, gate)
    gate_timeout_seconds = _gate_timeout_seconds(profile, gate)
    total_attempts = 1 + max_retries

    registry_version = str(registry.get("registry_version", "unknown"))
    metric_versions = _metric_versions(registry)
    thresholds_hash = canonical_json_hash(profile.get("strategy", {}))
    statistics_lock_hash = canonical_json_hash(registry.get("statistics_lock", {}))
    last_checkpoint: dict[str, Any] | None = None

    for attempt in range(1, total_attempts + 1):
        started_at = utc_now_iso()
        started_perf = time.perf_counter()
        try:
            outcome = _call_gate_fn_with_timeout(
                gate_fn=gate_fn,
                attempt=attempt,
                timeout_seconds=gate_timeout_seconds,
            )
            status = str(outcome.get("status", STATUS_TOOL_ERROR))
            reason_codes = [str(item) for item in outcome.get("reasonCodes", [])]
            blocking_issues = [str(item) for item in outcome.get("blockingIssues", [])]
            details = outcome.get("details")
            if not isinstance(details, dict):
                details = {}
            dataset_snapshot_hash = outcome.get("datasetSnapshotHash")
            dataset_hash_value = str(dataset_snapshot_hash) if isinstance(dataset_snapshot_hash, str) else None
            attestation = outcome.get("attestation")
            attestation_obj = attestation if isinstance(attestation, dict) else None
        except TimeoutError as exc:
            status = STATUS_TOOL_ERROR
            reason_codes = ["HARD_HARD_GATE_CHECK_FAILED"]
            blocking_issues = [f"{gate} timeout exceeded: {exc}"]
            details = {"exception": repr(exc), "timeoutSeconds": gate_timeout_seconds}
            dataset_hash_value = None
            attestation_obj = None
        except Exception as exc:  # noqa: BLE001
            status = STATUS_TOOL_ERROR
            reason_codes = ["HARD_HARD_GATE_CHECK_FAILED"]
            blocking_issues = [f"unhandled gate exception: {exc}"]
            details = {"exception": repr(exc)}
            dataset_hash_value = None
            attestation_obj = None

        details["gateTimeoutSeconds"] = gate_timeout_seconds

        ended_at = utc_now_iso()
        duration_ms = int((time.perf_counter() - started_perf) * 1000)
        checkpoint = _build_checkpoint(
            gate=gate,
            run_id=run_id,
            attempt=attempt,
            resumed_from=resumed_from,
            status=status,
            reason_codes=reason_codes,
            blocking_issues=blocking_issues,
            started_at=started_at,
            ended_at=ended_at,
            duration_ms=duration_ms,
            profile_hash=profile_hash,
            thresholds_hash=thresholds_hash,
            statistics_lock_hash=statistics_lock_hash,
            registry_version=registry_version,
            metric_versions=metric_versions,
            dataset_snapshot_hash=dataset_hash_value,
            decision_weight=decision_weight,
            attestation=attestation_obj,
            details=details,
        )
        write_json(checkpoints_dir / f"{gate}_attempt{attempt}.json", checkpoint)
        append_ndjson(history_path, checkpoint)
        last_checkpoint = checkpoint

        if status == STATUS_PASS:
            break
        should_retry = status in retry_statuses and attempt < total_attempts
        if not should_retry:
            break
        if retry_interval_seconds > 0:
            time.sleep(retry_interval_seconds)

    if last_checkpoint is None:
        raise RuntimeError(f"{gate} did not produce checkpoint")
    return last_checkpoint


def _build_skipped_checkpoint(
    *,
    gate: str,
    run_id: str,
    resumed_from: str | None,
    profile_hash: str,
    thresholds_hash: str,
    statistics_lock_hash: str,
    registry: dict[str, Any],
    decision_weight: str | None,
    reason: str,
) -> dict[str, Any]:
    now = utc_now_iso()
    return _build_checkpoint(
        gate=gate,
        run_id=run_id,
        attempt=1,
        resumed_from=resumed_from,
        status=STATUS_SKIPPED,
        reason_codes=[],
        blocking_issues=[reason],
        started_at=now,
        ended_at=now,
        duration_ms=0,
        profile_hash=profile_hash,
        thresholds_hash=thresholds_hash,
        statistics_lock_hash=statistics_lock_hash,
        registry_version=str(registry.get("registry_version", "unknown")),
        metric_versions=_metric_versions(registry),
        dataset_snapshot_hash=None,
        decision_weight=decision_weight,
        attestation=None,
        details={},
    )


def _derive_verdict(
    *,
    checkpoints: list[dict[str, Any]],
    profile: dict[str, Any],
    source_fallback_policy: dict[str, Any],
    canonical_codes: set[str],
    run_id: str,
    profile_hash: str,
    registry: dict[str, Any],
) -> dict[str, Any]:
    decision_cfg = profile.get("decision")
    if not isinstance(decision_cfg, dict):
        decision_cfg = {}

    decision_weight = str(decision_cfg.get("default_decision_weight", "limited"))
    all_reasons: list[str] = []
    all_issues: list[str] = []
    statuses: list[str] = []
    attestation_summary: dict[str, Any] | None = None
    for checkpoint in checkpoints:
        statuses.append(str(checkpoint.get("status")))
        for code in checkpoint.get("reasonCodes", []):
            if isinstance(code, str):
                all_reasons.append(code)
        for issue in checkpoint.get("blockingIssues", []):
            if isinstance(issue, str):
                all_issues.append(issue)
        if checkpoint.get("gate") == "G4":
            attestation_obj = checkpoint.get("attestation")
            if isinstance(attestation_obj, dict):
                attestation_summary = attestation_obj

    reasons = _dedup(all_reasons)
    issues = _dedup(all_issues)

    if any(code not in canonical_codes for code in reasons):
        reasons.append("HARD_REASON_CODE_UNKNOWN")
        reasons = _dedup(reasons)
        issues.append("unknown reason code detected in checkpoints")

    if any(status == STATUS_TOOL_ERROR for status in statuses):
        result = "BLOCKED_WITH_RECOVERY_PLAN"
    elif any(status == STATUS_POLICY_FAIL for status in statuses):
        blocked_codes = {
            "HARD_SOURCE_HEALTH_FAIL",
            "HARD_BUDGET_HARD_CAP_HIT",
            "HARD_GATE_RUNNER_SELF_HEALTH_FAIL",
        }
        if any(code in blocked_codes for code in reasons):
            result = "BLOCKED_WITH_RECOVERY_PLAN"
        else:
            result = "NO_GO"
    elif all(status in (STATUS_PASS, STATUS_SKIPPED) for status in statuses):
        result = "PAPER_ONLY_GO"
    else:
        result = "NO_GO"

    allowed_outputs = decision_cfg.get("allowed_outputs")
    if isinstance(allowed_outputs, list):
        allowed_set = {str(item) for item in allowed_outputs}
        if result not in allowed_set:
            result = "NO_GO"
            reasons.append("HARD_RELEASE_GATE_BLOCKED")
            reasons = _dedup(reasons)
            issues.append("result not in decision.allowed_outputs")

    mode = source_fallback_policy.get("mode")
    if mode == "archive_only":
        archive = source_fallback_policy.get("archiveOnly")
        allowed = set()
        if isinstance(archive, dict):
            raw_allowed = archive.get("allowedOutputs")
            if isinstance(raw_allowed, list):
                allowed = {str(item) for item in raw_allowed}
        if allowed and result not in allowed:
            result = "BLOCKED_WITH_RECOVERY_PLAN"
            reasons.append("HARD_RELEASE_GATE_BLOCKED")
            reasons = _dedup(reasons)
            issues.append("archive_only forbids this verdict")

    return {
        "version": "v2",
        "generatedAt": utc_now_iso(),
        "runId": run_id,
        "result": result,
        "decisionWeight": decision_weight,
        "reasonCodes": reasons,
        "blockingIssues": issues,
        "profileHash": profile_hash,
        "thresholdsHash": canonical_json_hash(profile.get("strategy", {})),
        "statisticsLockHash": canonical_json_hash(registry.get("statistics_lock", {})),
        "registryVersion": str(registry.get("registry_version", "unknown")),
        "metricVersions": _metric_versions(registry),
        "attestationSummary": attestation_summary,
    }


def _exit_code_from_verdict(result: str) -> int:
    if result == "PAPER_ONLY_GO":
        return EXIT_OK
    if result in {"NO_GO", "BLOCKED_WITH_RECOVERY_PLAN"}:
        return EXIT_POLICY_FAIL
    return EXIT_TOOL_ERROR


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    profile_path = (repo_root / args.profile).resolve() if not Path(args.profile).is_absolute() else Path(args.profile)
    registry_path = (repo_root / args.registry).resolve() if not Path(args.registry).is_absolute() else Path(args.registry)
    reason_codes_path = (repo_root / args.reason_codes).resolve() if not Path(args.reason_codes).is_absolute() else Path(args.reason_codes)
    owners_path = (repo_root / args.owners).resolve() if not Path(args.owners).is_absolute() else Path(args.owners)
    source_fallback_policy_path = (repo_root / args.source_fallback_policy).resolve() if not Path(args.source_fallback_policy).is_absolute() else Path(args.source_fallback_policy)
    runner_guard_policy_path = (repo_root / args.runner_guard_policy).resolve() if not Path(args.runner_guard_policy).is_absolute() else Path(args.runner_guard_policy)

    output_root = (repo_root / args.output_root).resolve() if not Path(args.output_root).is_absolute() else Path(args.output_root)
    output_root.mkdir(parents=True, exist_ok=True)
    history_path = (repo_root / args.history).resolve() if not Path(args.history).is_absolute() else Path(args.history)
    history_path.parent.mkdir(parents=True, exist_ok=True)

    run_id = args.run_id if isinstance(args.run_id, str) and args.run_id.strip() else utc_now_iso().replace(":", "").replace("-", "").replace("T", "_").replace("Z", "")
    run_dir = output_root / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    checkpoints_dir = run_dir / "checkpoints"
    checkpoints_dir.mkdir(parents=True, exist_ok=True)

    profile = read_json_compat(profile_path)
    registry = read_json_compat(registry_path)
    profile_hash = canonical_json_hash(profile)
    canonical_codes = _canonical_reason_codes(reason_codes_path)
    source_fallback_policy = read_json(source_fallback_policy_path)
    decision_weight = None
    decision_cfg = profile.get("decision")
    if isinstance(decision_cfg, dict):
        decision_weight_raw = decision_cfg.get("default_decision_weight")
        if isinstance(decision_weight_raw, str):
            decision_weight = decision_weight_raw

    guard_report, guard_open = _evaluate_runner_guard(
        output_root=output_root,
        history_path=history_path,
        policy_path=runner_guard_policy_path,
    )
    write_json(run_dir / "runner_guard_report.json", guard_report)

    checkpoints: list[dict[str, Any]] = []
    resumed_from = args.resumed_from_run_id if isinstance(args.resumed_from_run_id, str) else None

    def run_g0_fn(_: int) -> dict[str, Any]:
        if guard_open:
            return {
                "status": STATUS_POLICY_FAIL,
                "reasonCodes": ["HARD_GATE_RUNNER_SELF_HEALTH_FAIL"],
                "blockingIssues": ["runner guard state is open; gate pipeline blocked"],
                "details": {"runnerGuardState": guard_report.get("state"), "runnerGuardMode": guard_report.get("mode")},
                "datasetSnapshotHash": None,
                "attestation": None,
            }
        report = run_g0(
            repo_root=repo_root,
            profile=profile,
            reason_codes_path=reason_codes_path,
        )
        status = STATUS_PASS if report.get("passed") is True else STATUS_POLICY_FAIL
        return {
            "status": status,
            "reasonCodes": [str(item) for item in report.get("reasonCodes", [])],
            "blockingIssues": [str(item) for item in report.get("issues", [])],
            "details": report.get("details", {}),
            "datasetSnapshotHash": None,
            "attestation": None,
        }

    g0_checkpoint = _run_gate_with_retry(
        gate="G0",
        run_id=run_id,
        resumed_from=resumed_from,
        profile=profile,
        registry=registry,
        profile_hash=profile_hash,
        run_dir=run_dir,
        checkpoints_dir=checkpoints_dir,
        history_path=history_path,
        decision_weight=decision_weight,
        gate_fn=run_g0_fn,
    )
    checkpoints.append(g0_checkpoint)

    if g0_checkpoint["status"] == STATUS_PASS:
        g1_timeout = _gate_timeout_seconds(profile, "G1")
        g1_checkpoint = _run_gate_with_retry(
            gate="G1",
            run_id=run_id,
            resumed_from=resumed_from,
            profile=profile,
            registry=registry,
            profile_hash=profile_hash,
            run_dir=run_dir,
            checkpoints_dir=checkpoints_dir,
            history_path=history_path,
            decision_weight=decision_weight,
            gate_fn=lambda _: _gate_g1(
                repo_root=repo_root,
                run_dir=run_dir,
                timeout_seconds=g1_timeout,
                profile=profile,
            ),
        )
        checkpoints.append(g1_checkpoint)
    else:
        g1_checkpoint = None

    if g1_checkpoint is not None and g1_checkpoint["status"] == STATUS_PASS:
        g2_checkpoint = _run_gate_with_retry(
            gate="G2",
            run_id=run_id,
            resumed_from=resumed_from,
            profile=profile,
            registry=registry,
            profile_hash=profile_hash,
            run_dir=run_dir,
            checkpoints_dir=checkpoints_dir,
            history_path=history_path,
            decision_weight=decision_weight,
            gate_fn=lambda _: _gate_g2(
                research_cards_path=(repo_root / args.research_cards).resolve()
                if not Path(args.research_cards).is_absolute()
                else Path(args.research_cards),
                profile=profile,
            ),
        )
        checkpoints.append(g2_checkpoint)
    else:
        g2_checkpoint = None

    if g2_checkpoint is not None and g2_checkpoint["status"] == STATUS_PASS:
        g3_checkpoint = _run_gate_with_retry(
            gate="G3",
            run_id=run_id,
            resumed_from=resumed_from,
            profile=profile,
            registry=registry,
            profile_hash=profile_hash,
            run_dir=run_dir,
            checkpoints_dir=checkpoints_dir,
            history_path=history_path,
            decision_weight=decision_weight,
            gate_fn=lambda _: _gate_g3(
                run_id=run_id,
                run_dir=run_dir,
                profile=profile,
                registry=registry,
                strategy_metrics_path=(repo_root / args.strategy_metrics).resolve()
                if not Path(args.strategy_metrics).is_absolute()
                else Path(args.strategy_metrics),
                admission_report_path=(repo_root / args.admission_report).resolve()
                if not Path(args.admission_report).is_absolute()
                else Path(args.admission_report),
                external_report_path=(repo_root / args.external_benchmark_report).resolve()
                if not Path(args.external_benchmark_report).is_absolute()
                else Path(args.external_benchmark_report),
                health_report_path=(repo_root / args.health_report).resolve()
                if not Path(args.health_report).is_absolute()
                else Path(args.health_report),
                budget_usage_path=(repo_root / args.budget_usage).resolve()
                if not Path(args.budget_usage).is_absolute()
                else Path(args.budget_usage),
                dataset_path=(repo_root / args.dataset_path).resolve()
                if not Path(args.dataset_path).is_absolute()
                else Path(args.dataset_path),
                features_path=(repo_root / args.features_path).resolve()
                if not Path(args.features_path).is_absolute()
                else Path(args.features_path),
                labels_path=(repo_root / args.labels_path).resolve()
                if not Path(args.labels_path).is_absolute()
                else Path(args.labels_path),
                split_path=(repo_root / args.split_path).resolve()
                if not Path(args.split_path).is_absolute()
                else Path(args.split_path),
            ),
        )
        checkpoints.append(g3_checkpoint)
    else:
        g3_checkpoint = None

    if g3_checkpoint is not None and g3_checkpoint["status"] == STATUS_PASS:
        attestation_path = None
        if isinstance(args.attestation, str) and args.attestation.strip():
            attestation_path = (
                (repo_root / args.attestation).resolve()
                if not Path(args.attestation).is_absolute()
                else Path(args.attestation)
            )
        g4_checkpoint = _run_gate_with_retry(
            gate="G4",
            run_id=run_id,
            resumed_from=resumed_from,
            profile=profile,
            registry=registry,
            profile_hash=profile_hash,
            run_dir=run_dir,
            checkpoints_dir=checkpoints_dir,
            history_path=history_path,
            decision_weight=decision_weight,
            gate_fn=lambda _: _gate_g4(
                attestation_path=attestation_path,
                owners_path=owners_path,
                source_fallback_policy_path=source_fallback_policy_path,
            ),
        )
        checkpoints.append(g4_checkpoint)
    else:
        g4_checkpoint = None

    executed_gates = {str(item.get("gate")) for item in checkpoints}
    for gate in ("G0", "G1", "G2", "G3", "G4"):
        if gate in executed_gates:
            continue
        reason = "skipped because previous gate failed"
        skipped = _build_skipped_checkpoint(
            gate=gate,
            run_id=run_id,
            resumed_from=resumed_from,
            profile_hash=profile_hash,
            thresholds_hash=canonical_json_hash(profile.get("strategy", {})),
            statistics_lock_hash=canonical_json_hash(registry.get("statistics_lock", {})),
            registry=registry,
            decision_weight=decision_weight,
            reason=reason,
        )
        write_json(checkpoints_dir / f"{gate}_attempt1.json", skipped)
        append_ndjson(history_path, skipped)
        checkpoints.append(skipped)

    checkpoints.sort(key=lambda item: (str(item.get("gate")), int(item.get("attempt", 1))))
    write_json(run_dir / "gate_checkpoints.json", {"version": "v1", "items": checkpoints})

    verdict = _derive_verdict(
        checkpoints=checkpoints,
        profile=profile,
        source_fallback_policy=source_fallback_policy,
        canonical_codes=canonical_codes,
        run_id=run_id,
        profile_hash=profile_hash,
        registry=registry,
    )
    verdict_path = (
        Path(args.verdict_output)
        if isinstance(args.verdict_output, str) and args.verdict_output.strip()
        else run_dir / "verdict.v2.json"
    )
    if not verdict_path.is_absolute():
        verdict_path = (repo_root / verdict_path).resolve()
    write_json(verdict_path, verdict)

    summary = {
        "version": "v1",
        "generatedAt": utc_now_iso(),
        "runId": run_id,
        "profilePath": str(profile_path),
        "registryPath": str(registry_path),
        "reasonCodesPath": str(reason_codes_path),
        "verdictPath": str(verdict_path),
        "result": verdict["result"],
        "checkpointCount": len(checkpoints),
        "checkpointsPath": str(run_dir / "gate_checkpoints.json"),
    }
    write_json(run_dir / "run_summary.json", summary)
    print(
        json.dumps(
            {
                "runId": run_id,
                "result": verdict["result"],
                "verdictPath": str(verdict_path),
            },
            ensure_ascii=False,
        )
    )
    return _exit_code_from_verdict(str(verdict["result"]))


if __name__ == "__main__":
    sys.exit(main())
