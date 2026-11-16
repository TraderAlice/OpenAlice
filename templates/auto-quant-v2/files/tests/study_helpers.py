from __future__ import annotations

from pathlib import Path

from autoquant.studies import (
    StudyDataset,
    StudyDefinition,
    StudyJudge,
    StudyObjective,
    StudyResearchRequest,
    StudySubject,
    StudyTimeRange,
    StudyUpstreamEvidence,
)
from autoquant.workspace import create_project, initialize_workspace


SUCCESS_JUDGE = """\
import json
import os
from pathlib import Path

from factors.candidate import SCORE

artifacts = Path(os.environ["AUTOQUANT_ARTIFACTS_DIR"])
report = artifacts / "report.json"
report.write_text(json.dumps({"score": SCORE, "input": os.environ["AUTOQUANT_INPUT_HASH"]}))
output = {
    "schema_version": 1,
    "status": "succeeded",
    "summary": f"candidate score {SCORE}",
    "metrics": {
        "score": SCORE,
        "per_asset": {"AAA/USD": {"score": SCORE}},
    },
    "artifacts": [
        {
            "kind": "report",
            "path": "report.json",
            "description": "Synthetic factor report",
        }
    ],
    "errors": [],
}
Path(os.environ["AUTOQUANT_RUN_OUTPUT"]).write_text(json.dumps(output))
print(f"evaluated {SCORE}")
"""


FAILURE_JUDGE = """\
import sys

print("judge failed before producing output", file=sys.stderr)
raise SystemExit(7)
"""


MALFORMED_JUDGE = """\
import os
from pathlib import Path

Path(os.environ["AUTOQUANT_RUN_OUTPUT"]).write_text("{not json")
"""


TIMEOUT_JUDGE = """\
import time

time.sleep(2)
"""


def request_definition(
    *,
    title: str = "Recovery continuation",
    question: str = "When did each fixed stress path recover?",
) -> dict:
    return {
        "schemaVersion": 1,
        "kind": "autoquant-research-request",
        "title": title,
        "question": question,
        "decisionContext": "A bounded continuation needs prior Run evidence.",
        "assets": [
            {
                "symbol": "AAA/USD",
                "assetClass": "equity",
                "venue": "TEST",
            }
        ],
        "direction": "research-only",
        "horizon": "one month",
        "hypotheses": ["Recovery timing differs across fixed paths."],
        "constraints": ["Use only exact immutable evidence."],
        "deliverables": ["Recovery evidence and limitations."],
        "source": {
            "system": "local",
            "workspaceId": "test-workspace",
            "sessionId": "test-session",
            "artifactPath": None,
            "artifactRevision": None,
        },
    }


def make_project(directory: str | Path):
    root = Path(directory) / "workspace"
    workspace = initialize_workspace(root, name="Test Quant Desk")
    project = create_project(workspace.root_dir, "factor-project", name="Factor Project")
    (project.root_dir / "factors" / "candidate.py").write_text(
        "SCORE = 1.25\n",
        encoding="utf-8",
    )
    (project.root_dir / "judges" / "evaluate.py").write_text(
        SUCCESS_JUDGE,
        encoding="utf-8",
    )
    return workspace, project


def study_definition(
    *,
    study_id: str = "factor-quality",
    judge: str = "judges/evaluate.py",
    timeout: int = 10,
    editable: list[str] | None = None,
    dataset_paths: list[str] | None = None,
    dependencies: list[str] | None = None,
    research_request: StudyResearchRequest | None = None,
    upstream_evidence: StudyUpstreamEvidence | None = None,
) -> StudyDefinition:
    return StudyDefinition(
        schema_version=1,
        id=study_id,
        name="Factor Quality",
        description="Measure one synthetic factor without market data",
        program="program.md",
        subject=StudySubject("factor", "candidate-factor", "working"),
        editable={"paths": editable or ["factors/**"]},
        judge=StudyJudge("python", judge, ["judges/**"], [], timeout),
        objective=StudyObjective("score", "maximize", 0.01),
        dataset=StudyDataset(
            "synthetic-bars",
            "v1",
            "equity",
            ["AAA/USD"],
            StudyTimeRange("2026-01-01", "2026-01-31"),
            dataset_paths,
        ),
        dependencies=(
            {"paths": dependencies}
            if dependencies is not None
            else None
        ),
        research_request=research_request,
        upstream_evidence=upstream_evidence,
    )
