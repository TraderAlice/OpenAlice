#!/usr/bin/env bash
set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPORT_PATH="$REPO_ROOT/data/runtime/takeover_ready_report.json"
VERDICT_PATH="$REPO_ROOT/decision_packet/verdict.json"

run_cmd() {
  local name="$1"
  shift
  echo "[takeover] running: $name"
  "$@"
  local code=$?
  echo "[takeover] $name exit=$code"
  return $code
}

cd "$REPO_ROOT"

run_cmd "python_governance_tests" python3 scripts/tests/test_governance_pipeline.py
code_python_tests=$?

run_cmd "pnpm_test" pnpm test
code_pnpm_test=$?

run_cmd "pnpm_freeze_verify" pnpm freeze:verify
code_freeze_verify=$?

run_cmd "pnpm_evidence_validate" pnpm evidence:validate
code_evidence_validate=$?

verdict_exists=0
if [ -f "$VERDICT_PATH" ]; then
  verdict_exists=1
fi

generated_at="$(python3 - <<'PY'
from datetime import datetime, timezone
print(datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"))
PY
)"

python3 - <<PY
import json
from pathlib import Path

report = {
    "generatedAt": "$generated_at",
    "checks": {
        "python_governance_tests": {"exitCode": $code_python_tests, "expected": [0]},
        "pnpm_test": {"exitCode": $code_pnpm_test, "expected": [0]},
        "pnpm_freeze_verify": {"exitCode": $code_freeze_verify, "expected": [0, 2]},
        "pnpm_evidence_validate": {"exitCode": $code_evidence_validate, "expected": [0, 2]},
    },
    "verdictPath": "$VERDICT_PATH",
    "verdictExists": bool($verdict_exists),
}

passed = True
passed &= report["checks"]["python_governance_tests"]["exitCode"] == 0
passed &= report["checks"]["pnpm_test"]["exitCode"] == 0
passed &= report["checks"]["pnpm_freeze_verify"]["exitCode"] in (0, 2)
passed &= report["checks"]["pnpm_evidence_validate"]["exitCode"] in (0, 2)
passed &= report["verdictExists"] is True
report["passed"] = passed

report_path = Path("$REPORT_PATH")
report_path.parent.mkdir(parents=True, exist_ok=True)
report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\\n", encoding="utf-8")
PY

if [ $code_python_tests -ne 0 ]; then
  exit 2
fi
if [ $code_pnpm_test -ne 0 ]; then
  exit 2
fi
if [ $code_freeze_verify -ne 0 ] && [ $code_freeze_verify -ne 2 ]; then
  exit 2
fi
if [ $code_evidence_validate -ne 0 ] && [ $code_evidence_validate -ne 2 ]; then
  exit 2
fi
if [ $verdict_exists -ne 1 ]; then
  exit 2
fi

exit 0
