from __future__ import annotations

import pytest

from routing import (
    CapabilityClass,
    SearchPolicy,
    TaskClass,
    decide_routing,
    render_runtime_system_context,
    runtime_response_metadata,
)


def route(query: str, mode: str = "Auto", messages: list[dict[str, str]] | None = None):
    return decide_routing(
        mode,
        messages or [{"role": "user", "content": query}],
    )


@pytest.fixture(autouse=True)
def deterministic_routing_config(monkeypatch) -> None:
    monkeypatch.setenv("KALILLAC_CHAT_PROVIDER", "openrouter")
    monkeypatch.setenv("KALILLAC_MODEL", "openrouter/free")
    monkeypatch.setenv("KALILLAC_OPTIONAL_SEARCH_ENABLED", "true")
    monkeypatch.setenv("KALILLAC_MAX_OUTPUT_TOKENS_FAST", "900")
    monkeypatch.setenv("KALILLAC_MAX_OUTPUT_TOKENS_SMART", "1800")
    monkeypatch.setenv("KALILLAC_MAX_OUTPUT_TOKENS_DEEP", "3600")
    monkeypatch.setenv("KALILLAC_MAX_TOTAL_INPUT_CHARS", "50000")


@pytest.mark.parametrize(
    ("query", "task", "effective", "reason"),
    [
        ("Hi, how are you?", TaskClass.SIMPLE_GENERAL, "Fast", "auto-simple"),
        ("What is 17 times 19?", TaskClass.SIMPLE_GENERAL, "Fast", "auto-simple"),
        ("Draft a short thank-you email.", TaskClass.WRITING, "Smart", "auto-writing"),
        ("How do I write a Python function?", TaskClass.CODING, "Smart", "auto-coding"),
        ("Explain photosynthesis.", TaskClass.STUDY_EXPLANATION, "Smart", "auto-study"),
        ("What is the latest iOS release?", TaskClass.CURRENT_INFORMATION, "Smart", "auto-current-info"),
        ("Research recent evidence about sleep.", TaskClass.RESEARCH, "Deep", "auto-research"),
        ("Compare laptops for a student.", TaskClass.COMPARISON_DECISION, "Smart", "auto-comparison"),
        ("Prove this theorem step by step.", TaskClass.COMPLEX_REASONING, "Deep", "auto-complex"),
    ],
)
def test_auto_uses_deterministic_task_policy(query, task, effective, reason) -> None:
    decision = route(query)
    assert decision.task_class is task
    assert decision.effective_mode == effective
    assert decision.reason_codes == (reason,)


@pytest.mark.parametrize(
    ("mode", "capability", "reason"),
    [
        ("Fast", CapabilityClass.FAST, "explicit-fast"),
        ("Smart", CapabilityClass.BALANCED, "explicit-smart"),
        ("Deep", CapabilityClass.HIGH_REASONING, "explicit-deep"),
    ],
)
def test_explicit_modes_select_capability_policy(mode, capability, reason) -> None:
    decision = route("What is two plus two?", mode)
    assert decision.requested_mode == mode
    assert decision.effective_mode == mode
    assert decision.capability_class is capability
    assert decision.reason_codes == (reason,)


def test_current_information_is_required_even_in_fast_mode() -> None:
    decision = route("Search the web for the current train schedule.", "Fast")
    assert decision.effective_mode == "Fast"
    assert decision.search_policy is SearchPolicy.REQUIRED
    assert decision.search_required is True


def test_auto_current_query_gets_smart_and_required_search() -> None:
    decision = route("What is the latest iOS release?")
    assert decision.effective_mode == "Smart"
    assert decision.search_policy is SearchPolicy.REQUIRED


def test_research_and_product_recommendations_use_optional_search() -> None:
    assert route("Research evidence about sleep.", "Deep").search_policy is SearchPolicy.OPTIONAL
    assert route("Compare laptops for a student.").search_policy is SearchPolicy.OPTIONAL
    assert route("Compare these two paragraphs.").search_policy is SearchPolicy.DISABLED


@pytest.mark.parametrize(
    "query",
    [
        "What is Kalillac?",
        "Do you save my chats?",
        "Do you remember me?",
        "Can you search the internet?",
        "What model answered me?",
        "Can you read PDFs?",
    ],
)
def test_stable_product_self_knowledge_never_searches(query) -> None:
    decision = route(query)
    assert decision.task_class is TaskClass.SELF_KNOWLEDGE
    assert decision.search_policy is SearchPolicy.DISABLED
    assert decision.product_topic is not None


def test_search_requirement_overrides_disabled_optional_search(monkeypatch) -> None:
    monkeypatch.setenv("KALILLAC_OPTIONAL_SEARCH_ENABLED", "false")
    assert route("Compare laptops for a student.").search_policy is SearchPolicy.DISABLED
    assert route("Search the web for the latest iOS release.").search_policy is SearchPolicy.REQUIRED


def test_structural_signals_route_long_multi_part_request_to_deep() -> None:
    query = (
        "Please solve this request:\n"
        "- identify the constraints\n"
        "- consider three edge cases\n"
        "- evaluate each trade-off\n"
        "- explain the result\n"
    ) + ("Additional context. " * 35)
    decision = route(query)
    assert decision.task_class is TaskClass.COMPLEX_REASONING
    assert decision.effective_mode == "Deep"
    assert decision.output_token_limit <= 8_192
    assert decision.max_input_chars > route("Hi").max_input_chars


def test_unknown_provider_model_is_reported_as_unknown_not_guessed() -> None:
    decision = route("Explain a stable concept.", "Smart")
    metadata = runtime_response_metadata(
        decision,
        request_id="opaque",
        returned_model=None,
        search_used=False,
    )
    assert metadata["model_identity"] == "unknown"
    assert metadata["returned_model"] is None
    assert metadata["configured_model"] == decision.configured_model


def test_dynamic_provider_alias_is_not_reported_as_an_exact_model() -> None:
    decision = route("Explain a stable concept.", "Smart")
    metadata = runtime_response_metadata(
        decision,
        request_id="opaque",
        returned_model="openrouter/free",
        search_used=False,
    )
    assert metadata["model_identity"] == "configured_route_only"


def test_runtime_context_is_structured_content_free_and_contains_truth_guards() -> None:
    import json

    decision = route("Explain a stable concept.", "Smart")
    context = json.loads(render_runtime_system_context(decision, search_available=True))
    assert context["label"] == "KALILLAC_PRODUCT_AND_RUNTIME_CONTEXT"
    assert context["product"]["capabilities"]["cloud_sync"] is False
    assert context["runtime"]["configured_model_route"] == "openrouter/free"
    assert context["runtime"]["effective_mode"] == "Smart"
    assert any("product.prohibited_claims" in rule for rule in context["truthfulness_rules"])
    assert "reason_codes" not in context["runtime"]


def test_fast_skips_optional_search_but_keeps_required_verification() -> None:
    assert route("Research the history of ancient mathematics.", "Fast").search_policy is SearchPolicy.DISABLED
    assert route("Research the history of ancient mathematics.", "Smart").search_policy is SearchPolicy.OPTIONAL
    assert route("Search the web for the current iOS release.", "Fast").search_policy is SearchPolicy.REQUIRED
