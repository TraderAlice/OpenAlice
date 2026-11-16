"""Agent-editable baseline state representation for the governed RL lab."""

from __future__ import annotations


FEATURE_NAMES = (
    "bias",
    "previous_activity",
    "previous_intraday",
    "previous_reversal",
    "previous_balanced",
)


def encode_state(state: dict[str, float]) -> list[float]:
    """Encode one causal state without using regime information.

    This intentionally weak baseline can learn one globally preferred factor
    mixture and switching persistence, but cannot adapt to the observable
    volume regime or execution context. Research candidates may add causal
    market fields, pretrade-book summaries, per-sleeve target distances, and
    bounded interactions while preserving this pure row-level API.
    """

    return [
        1.0,
        state["previous_activity"],
        state["previous_intraday"],
        state["previous_reversal"],
        state["previous_balanced"],
    ]
