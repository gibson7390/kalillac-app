from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from search_provider import (
    SEARCH_UNAVAILABLE_MESSAGE,
    SearchProviderError,
    SearchSettings,
    TavilySearchProvider,
)


def run_provider(
    handler,
    *,
    settings: SearchSettings | None = None,
    query: str = "latest public information",
    api_key: str = "test-tavily-key",
):
    async def run():
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            provider = TavilySearchProvider(
                api_key=api_key,
                client=client,
                settings=settings or SearchSettings(),
            )
            return await provider.search(query)
        finally:
            await client.aclose()

    return asyncio.run(run())


def test_tavily_uses_bearer_auth_and_normalizes_bounded_public_sources() -> None:
    observed: dict[str, object] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        observed["auth"] = request.headers["authorization"]
        observed["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "query": "private query",
                "answer": "provider-generated text is not used",
                "results": [
                    {"title": "  Example   One ", "url": "https://www.example.com/a", "content": "A" * 30, "score": 0.99},
                    {"title": "Example Two", "url": "http://example.org/path", "content": "B" * 30},
                    {"title": "Overflow", "url": "https://overflow.test/", "content": "C" * 30},
                    {"title": "Unsafe", "url": "javascript:alert(1)", "content": "ignored"},
                    {"title": "Local", "url": "http://127.0.0.1/private", "content": "ignored"},
                    {"title": "Credential URL", "url": "https://user:pass@example.com/", "content": "ignored"},
                ],
                "usage": {"credits": 1},
            },
        )

    settings = SearchSettings(
        max_query_chars=80,
        max_results=2,
        max_result_chars=8,
        max_total_grounding_chars=14,
    )
    sources = run_provider(handler, settings=settings)
    assert observed["auth"] == "Bearer test-tavily-key"
    assert observed["payload"]["max_results"] == 2  # type: ignore[index]
    assert observed["payload"]["include_answer"] is False  # type: ignore[index]
    assert observed["payload"]["include_raw_content"] is False  # type: ignore[index]
    assert [source.id for source in sources] == ["source-1", "source-2"]
    assert sources[0].title == "Example One"
    assert sources[0].domain == "www.example.com"
    assert len(sources[0].snippet) == 8
    assert len(sources[0].snippet) + len(sources[1].snippet) == 14
    assert "score" not in sources[0].customer_fields()
    assert "snippet" not in sources[0].customer_fields()


def test_empty_or_malformed_individual_results_are_handled_safely() -> None:
    empty = run_provider(lambda _request: httpx.Response(200, json={"results": []}))
    assert empty == []
    malformed = run_provider(
        lambda _request: httpx.Response(
            200,
            json={"results": [None, {"title": "Missing URL", "content": "text"}, {"title": "", "url": "https://a.test", "content": "text"}]},
        )
    )
    assert malformed == []


def test_invalid_response_shape_is_normalized() -> None:
    with pytest.raises(SearchProviderError) as caught:
        run_provider(lambda _request: httpx.Response(200, json={"results": {}}))
    assert caught.value.error_class == "invalid-response"
    assert str(caught.value) == SEARCH_UNAVAILABLE_MESSAGE


@pytest.mark.parametrize(
    ("status", "error_class"),
    [(401, "authentication"), (403, "authentication"), (429, "rate-limited"), (432, "rate-limited"), (500, "upstream-failure")],
)
def test_upstream_errors_are_normalized_without_response_body(status: int, error_class: str) -> None:
    secret = "test-tavily-key-do-not-echo"
    with pytest.raises(SearchProviderError) as caught:
        run_provider(
            lambda _request: httpx.Response(status, text=f"{secret} private upstream details"),
            api_key=secret,
        )
    assert caught.value.error_class == error_class
    assert secret not in str(caught.value)
    assert "private upstream details" not in str(caught.value)


def test_timeout_is_normalized() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("private timeout detail")

    with pytest.raises(SearchProviderError) as caught:
        run_provider(handler)
    assert caught.value.error_class == "timeout"
    assert "private timeout detail" not in str(caught.value)


def test_oversized_response_is_rejected_before_json_parsing() -> None:
    settings = SearchSettings(max_response_bytes=1024)
    with pytest.raises(SearchProviderError) as caught:
        run_provider(
            lambda _request: httpx.Response(200, content=b"x" * 1200),
            settings=settings,
        )
    assert caught.value.error_class == "response-too-large"


def test_query_size_limit_prevents_any_network_request() -> None:
    called = False

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={"results": []})

    with pytest.raises(SearchProviderError) as caught:
        run_provider(handler, settings=SearchSettings(max_query_chars=12), query="query that is too long")
    assert caught.value.error_class == "query-limit"
    assert not called


def test_missing_key_does_not_make_a_request_or_echo_credentials() -> None:
    async def run():
        provider = TavilySearchProvider(api_key="", settings=SearchSettings())
        with pytest.raises(SearchProviderError) as caught:
            await provider.search("latest weather")
        assert caught.value.error_class == "not-configured"
        assert "TAVILY_API_KEY" not in str(caught.value)

    asyncio.run(run())


def test_configuration_is_bounded(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KALILLAC_TAVILY_MAX_RESULTS", "1000")
    with pytest.raises(ValueError):
        SearchSettings.from_env()


def test_all_search_bounds_can_be_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KALILLAC_MAX_SEARCH_QUERY_CHARS", "220")
    monkeypatch.setenv("KALILLAC_TAVILY_MAX_RESULTS", "4")
    monkeypatch.setenv("KALILLAC_MAX_GROUNDING_CHARS_PER_RESULT", "700")
    monkeypatch.setenv("KALILLAC_MAX_TOTAL_GROUNDING_CHARS", "2400")
    monkeypatch.setenv("KALILLAC_TAVILY_TIMEOUT_SECONDS", "6.5")
    monkeypatch.setenv("KALILLAC_TAVILY_MAX_RESPONSE_BYTES", "50000")
    assert SearchSettings.from_env() == SearchSettings(
        max_query_chars=220,
        max_results=4,
        max_result_chars=700,
        max_total_grounding_chars=2400,
        timeout_seconds=6.5,
        max_response_bytes=50000,
    )
