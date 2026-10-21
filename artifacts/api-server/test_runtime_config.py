from __future__ import annotations

import pytest

from runtime_config import (
    ai_timeout_seconds,
    chat_provider_name,
    max_context_messages,
    max_total_input_chars,
    max_user_input_chars,
    model_for_capability,
    optional_search_enabled,
    output_token_limit,
)


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


def test_model_mapping_is_configurable_per_capability_class(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KALILLAC_MODEL", "openrouter/free")
    monkeypatch.setenv("KALILLAC_MODEL_FAST", "vendor/fast-route")
    monkeypatch.setenv("KALILLAC_MODEL_BALANCED", "vendor/balanced-route")
    monkeypatch.delenv("KALILLAC_MODEL_HIGH_REASONING", raising=False)
    assert model_for_capability("fast") == "vendor/fast-route"
    assert model_for_capability("balanced") == "vendor/balanced-route"
    assert model_for_capability("high_reasoning") == "openrouter/free"


def test_model_mapping_rejects_unsafe_or_unbounded_identifiers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KALILLAC_MODEL_FAST", "bad model\nwith newline")
    with pytest.raises(ValueError):
        model_for_capability("fast")
    monkeypatch.setenv("KALILLAC_MODEL_FAST", "sk-or-v1-not-a-model")
    with pytest.raises(ValueError):
        model_for_capability("fast")


def test_mode_output_budgets_are_bounded_and_configurable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KALILLAC_MAX_OUTPUT_TOKENS_FAST", "1200")
    assert output_token_limit("Fast") == 1200
    assert output_token_limit("Deep") == 3600
    monkeypatch.setenv("KALILLAC_MAX_OUTPUT_TOKENS_DEEP", "99999")
    with pytest.raises(ValueError):
        output_token_limit("Deep")


def test_provider_context_and_optional_search_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    assert chat_provider_name() == "openrouter"
    assert max_context_messages() == 40
    assert optional_search_enabled() is True
    monkeypatch.setenv("KALILLAC_OPTIONAL_SEARCH_ENABLED", "false")
    assert optional_search_enabled() is False
    monkeypatch.setenv("KALILLAC_CHAT_PROVIDER", "unsupported")
    with pytest.raises(ValueError):
        chat_provider_name()


def test_deep_has_larger_but_bounded_context_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("KALILLAC_MAX_INPUT_CHARS_FAST", raising=False)
    monkeypatch.delenv("KALILLAC_MAX_INPUT_CHARS_SMART", raising=False)
    monkeypatch.delenv("KALILLAC_MAX_INPUT_CHARS_DEEP", raising=False)
    monkeypatch.setenv("KALILLAC_MAX_TOTAL_INPUT_CHARS", "50000")
    assert max_total_input_chars("Fast") == 16_000
    assert max_total_input_chars("Smart") == 32_000
    assert max_total_input_chars("Deep") == 50_000
    monkeypatch.setenv("KALILLAC_MAX_INPUT_CHARS_DEEP", "50001")
    with pytest.raises(ValueError):
        max_total_input_chars("Deep")
