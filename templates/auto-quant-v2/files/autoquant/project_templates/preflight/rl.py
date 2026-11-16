"""Fast bounded contract checks for an editable RL state encoder."""

from __future__ import annotations

import copy
import importlib
import json
import os
from pathlib import Path

import numpy as np


OUTPUT = Path(os.environ["AUTOQUANT_CHECK_OUTPUT"])
MAX_FEATURES = 64
FEATURE_ABS_LIMIT = 20.0
ACTIONS = ("candidate", "activity", "intraday", "reversal", "balanced")
EXPERTS = ACTIONS[:4]


class CheckFailure(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def _state(offset: float) -> dict[str, float]:
    values = {
        "market_return_5": -0.02 + offset,
        "market_volatility_20": 0.015 + abs(offset),
        "volume_regime": 0.4 - offset,
        "pretrade_gross_exposure": 0.8,
        "pretrade_net_exposure": 0.2,
        "pretrade_cash_weight": 0.2,
        "pretrade_max_abs_weight": 0.24,
        "pretrade_concentration_hhi": 0.24,
    }
    for index, expert in enumerate(EXPERTS):
        values[f"{expert}_trailing_reward_10"] = (index - 1.5) * 0.02 + offset
    for index, action in enumerate(ACTIONS):
        values[f"{action}_target_distance"] = 0.05 * (index + 1)
        values[f"previous_{action}"] = 1.0 if index == 0 else 0.0
    return values


def _write(status: str, checks: list[dict[str, str]], errors: list[dict[str, str]]) -> None:
    summary = (
        "Candidate satisfies the bounded RL encoder contract"
        if status == "passed"
        else errors[0]["message"]
    )
    OUTPUT.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "status": status,
                "summary": summary,
                "checks": checks,
                "errors": errors,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def main() -> None:
    checks: list[dict[str, str]] = []
    try:
        module = importlib.import_module("models.candidate")
        names = getattr(module, "FEATURE_NAMES", None)
        if (
            not isinstance(names, (tuple, list))
            or not 1 <= len(names) <= MAX_FEATURES
            or any(not isinstance(name, str) or not name for name in names)
            or len(set(names)) != len(names)
        ):
            raise CheckFailure(
                "policy.features",
                f"FEATURE_NAMES must contain 1 to {MAX_FEATURES} unique strings",
            )
        encoder = getattr(module, "encode_state", None)
        if not callable(encoder):
            raise CheckFailure(
                "policy.api",
                "models.candidate must export callable encode_state(state)",
            )
        for state in (_state(0.0), _state(0.07), _state(-0.04)):
            before = copy.deepcopy(state)
            try:
                first = encoder(state)
                second = encoder(state)
                first_array = np.asarray(first, dtype=float)
                second_array = np.asarray(second, dtype=float)
            except Exception as error:
                raise CheckFailure(
                    "policy.encoder",
                    f"encode_state raised {type(error).__name__}: {error}",
                ) from error
            if state != before:
                raise CheckFailure("policy.mutation", "encode_state mutated its input")
            if first_array.shape != (len(names),):
                raise CheckFailure(
                    "policy.alignment",
                    "Encoded vector length must exactly match FEATURE_NAMES",
                )
            if not np.isfinite(first_array).all():
                raise CheckFailure(
                    "policy.non-finite",
                    "Encoded state contains a non-finite feature",
                )
            if np.abs(first_array).max() > FEATURE_ABS_LIMIT:
                raise CheckFailure(
                    "policy.bounds",
                    f"Encoded features must be within ±{FEATURE_ABS_LIMIT:g}",
                )
            if not np.array_equal(first_array, second_array):
                raise CheckFailure(
                    "policy.nondeterministic",
                    "encode_state returned different values for one fixed state",
                )
        checks.append(
            {
                "id": "policy-contract",
                "status": "passed",
                "message": (
                    "API, immutability, alignment, finite bounds, and "
                    "determinism checks passed"
                ),
            }
        )
        _write("passed", checks, [])
    except CheckFailure as error:
        checks.append(
            {"id": error.code, "status": "failed", "message": str(error)}
        )
        _write("failed", checks, [{"code": error.code, "message": str(error)}])
    except Exception as error:
        message = f"Unexpected preflight error: {type(error).__name__}: {error}"
        _write(
            "failed",
            [{"id": "preflight-error", "status": "failed", "message": message}],
            [{"code": "preflight.error", "message": message}],
        )


if __name__ == "__main__":
    main()
