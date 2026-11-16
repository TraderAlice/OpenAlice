from __future__ import annotations

import copy
import unittest

import jsonschema

from autoquant.briefs import validate_research_request
from autoquant.horizons import (
    RESEARCH_HORIZON_JSON_SCHEMA,
    build_research_horizon,
    validate_horizon_capacity,
    validate_research_horizon,
)
from autoquant.workspace import AutoQuantValidationError


def request(
    policy: dict[str, object] | None = None,
) -> dict[str, object]:
    value: dict[str, object] = {
        "schemaVersion": 1,
        "kind": "autoquant-research-request",
        "title": "Medium-term equity leadership",
        "question": "Does leadership persist over the intended horizon?",
        "decisionContext": "OpenAlice is reviewing an equity allocation.",
        "assets": [
            {"symbol": "AAPL", "assetClass": "equity", "venue": "XNYS"}
        ],
        "direction": "long",
        "horizon": "one to three months",
        "hypotheses": ["Leadership persists out of sample."],
        "constraints": ["No trading authority."],
        "deliverables": ["Factor and portfolio evidence."],
        "source": {
            "system": "openalice",
            "workspaceId": "equity-desk",
            "sessionId": "request-1",
            "artifactPath": "requests/aapl.json",
            "artifactRevision": "sha256:test",
        },
    }
    if policy is not None:
        value["horizonPolicy"] = policy
    return value


class ResearchHorizonTests(unittest.TestCase):
    def test_caller_policy_builds_content_addressed_horizon(self) -> None:
        normalized = validate_research_request(
            request(
                {
                    "primaryForwardBars": 21,
                    "diagnosticForwardBars": [5, 21, 63],
                }
            )
        )
        horizon = build_research_horizon(normalized)

        self.assertEqual(horizon["primaryForwardBars"], 21)
        self.assertEqual(horizon["diagnosticForwardBars"], [5, 21, 63])
        self.assertEqual(horizon["source"]["horizonPolicy"], "caller-supplied")
        self.assertEqual(validate_research_horizon(horizon), horizon)
        jsonschema.validate(horizon, RESEARCH_HORIZON_JSON_SCHEMA)

        changed = copy.deepcopy(normalized)
        changed["horizonPolicy"]["primaryForwardBars"] = 63
        self.assertNotEqual(
            build_research_horizon(changed)["id"],
            horizon["id"],
        )

    def test_primary_is_added_to_canonical_evaluated_horizons(self) -> None:
        normalized = validate_research_request(
            request(
                {
                    "primaryForwardBars": 20,
                    "diagnosticForwardBars": [5, 60],
                }
            )
        )

        self.assertEqual(
            normalized["horizonPolicy"],
            {
                "primaryForwardBars": 20,
                "diagnosticForwardBars": [5, 20, 60],
            },
        )
        horizon = build_research_horizon(normalized)
        self.assertEqual(horizon["diagnosticForwardBars"], [5, 20, 60])

    def test_omission_is_explicit_reference_default(self) -> None:
        normalized = validate_research_request(request())
        horizon = build_research_horizon(normalized)

        self.assertEqual(horizon["primaryForwardBars"], 1)
        self.assertEqual(horizon["diagnosticForwardBars"], [1, 5, 10])
        self.assertEqual(
            horizon["source"]["horizonPolicy"],
            "reference-default",
        )

    def test_request_rejects_invalid_horizon_policy(self) -> None:
        invalid = (
            {
                "primaryForwardBars": True,
                "diagnosticForwardBars": [1, 5, 10],
            },
            {
                "primaryForwardBars": 5,
                "diagnosticForwardBars": [5, 1, 5],
            },
            {
                "primaryForwardBars": 253,
                "diagnosticForwardBars": [253],
            },
            {
                "primaryForwardBars": 5,
                "diagnosticForwardBars": [1, 5],
                "unknown": 10,
            },
            {
                "primaryForwardBars": 6,
                "diagnosticForwardBars": [1, 2, 3, 4, 5],
            },
        )
        for policy in invalid:
            with self.subTest(policy=policy):
                with self.assertRaises(AutoQuantValidationError):
                    validate_research_request(request(policy))

    def test_capacity_requires_twenty_post_purge_rows_per_split(self) -> None:
        policy = {
            "primaryForwardBars": 21,
            "diagnosticForwardBars": [5, 21, 63],
        }
        validate_horizon_capacity(policy, 420)
        with self.assertRaises(AutoQuantValidationError) as captured:
            validate_horizon_capacity(policy, 260)
        self.assertEqual(
            captured.exception.issues[0].code,
            "horizon.insufficient-history",
        )

    def test_tamper_changes_derived_id(self) -> None:
        horizon = build_research_horizon(
            validate_research_request(
                request(
                    {
                        "primaryForwardBars": 5,
                        "diagnosticForwardBars": [1, 5, 20],
                    }
                )
            )
        )
        tampered = copy.deepcopy(horizon)
        tampered["primaryForwardBars"] = 20
        with self.assertRaises(AutoQuantValidationError):
            validate_research_horizon(tampered)


if __name__ == "__main__":
    unittest.main()
