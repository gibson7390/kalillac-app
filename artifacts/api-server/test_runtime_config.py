from __future__ import annotations

import pytest

from runtime_config import ai_timeout_seconds, max_total_input_chars, max_user_input_chars


def test_provider_timeout_and_user_input_bounds_are_configurable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KALILLAC_AI_PROVIDER_TIMEOUT_SECONDS", "55")
    monkeypatch.setenv("KALILLAC_MAX_USER_INPUT_CHARS", "9000")
    monkeypatch.setenv("KALILLAC_MAX_TOTAL_INPUT_CHARS", "60000")
    assert ai_timeout_seconds() == 55
    assert max_user_input_chars() == 9000
    assert max_total_input_chars() == 60000


def test_provider_timeout_rejects_unbounded_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KALILLAC_AI_PROVIDER_TIMEOUT_SECONDS", "999")
    with pytest.raises(ValueError):
        ai_timeout_seconds()
