import asyncio
from dataclasses import replace
from decimal import Decimal
import json

import httpx
import pytest

from fastapi_app import app
from provider import OpenRouterProvider, ProviderError, ProviderStreamEvent
from reliability import BudgetedSearch, Capacity, RateLimiter, ReliabilityRuntime, ProviderCandidate
from reliability_config import ReliabilitySettings
from routing import decide_routing
from search_provider import NormalizedSource, SearchProviderError
from usage_accounting import AttemptRecord, CostCatalog, ModelPrice, Operation, TokenUsage
from test_reliability import FakeProvider


DECISION = decide_routing("Fast", [{"role": "user", "content": "Hello"}])


@pytest.fixture(autouse=True)
def isolate():
    for name in ("provider", "search_provider", "provider_candidates", "reliability"):
        if hasattr(app.state, name):
            delattr(app.state, name)
    yield
    for name in ("provider", "search_provider", "provider_candidates", "reliability"):
        if hasattr(app.state, name):
            delattr(app.state, name)


def test_free_route_zero_cost_without_inventing_tokens():
    usage = TokenUsage()
    assert CostCatalog().token_cost("openrouter", "openrouter/free", "vendor/model:free", usage) == Decimal(0)
    assert usage.input_tokens is None and usage.kind == "unknown"


def test_decimal_cost_arithmetic_with_cached_tokens():
    catalog = CostCatalog({("fake", "model"): ModelPrice(Decimal("0.15"), Decimal("0.60"), Decimal("0.03"))})
    usage = TokenUsage(1_000_000, 500_000, 1_500_000, 200_000, "reported")
    assert catalog.token_cost("fake", "model", None, usage) == Decimal("0.426")


@pytest.mark.parametrize("usage", [TokenUsage(), TokenUsage(total_tokens=10, kind="reported")])
def test_missing_token_breakdown_is_unknown_not_invented(usage):
    catalog = CostCatalog({("fake", "model"): ModelPrice(Decimal(1), Decimal(2))})
    assert catalog.token_cost("fake", "model", None, usage) is None


def test_unknown_pricing_and_returned_model_priority():
    catalog = CostCatalog({("fake", "actual"): ModelPrice(Decimal("1.1"), Decimal("2.2"))})
    usage = TokenUsage(3, 7, 10, kind="reported")
    assert catalog.token_cost("fake", "missing", None, usage) is None
    assert catalog.token_cost("fake", "route", "actual", usage) == Decimal("0.0000187")


def test_config_catalog_and_search_cost(monkeypatch):
    monkeypatch.setenv("KALILLAC_COST_CATALOG_JSON", json.dumps({
        "models": [{"provider": "fake", "model": "m", "input_per_million": "0.1", "output_per_million": "0.2"}],
        "search_per_request": {"search": "0.004"},
    }))
    catalog = CostCatalog.from_env()
    op = Operation(search_calls=1, search_provider="search")
    assert op.record(catalog)["cost"]["total"] == "0.004"
    assert CostCatalog().token_cost("openrouter", "openrouter/free", None, TokenUsage()) == 0


@pytest.mark.parametrize("bad", ["NaN", "-1", "Infinity", "not-a-price"])
def test_catalog_rejects_invalid_money(monkeypatch, bad):
    monkeypatch.setenv("KALILLAC_COST_CATALOG_JSON", json.dumps({"search_per_request": {"search": bad}}))
    with pytest.raises(ValueError):
        CostCatalog.from_env()


def test_fallback_costs_include_every_attempt_and_unknown_search_is_not_zero():
    catalog = CostCatalog({("fake", "m"): ModelPrice(Decimal(1), Decimal(2))})
    op = Operation(attempts=[
        AttemptRecord("p1", "fake", "m", 1, False, usage=TokenUsage(100, 10, 110, kind="reported")),
        AttemptRecord("p2", "fake", "m", 2, True, usage=TokenUsage(200, 20, 220, kind="reported")),
    ], fallback_used=True)
    record = op.record(catalog)
    assert record["provider_attempts"] == 2
    assert record["total_tokens"] == 330
    assert record["cost"]["total"] == "0.00036"
    op.search_calls, op.search_provider = 1, "unknown"
    record = op.record(catalog)
    assert record["cost"]["token_cost"] == "0.00036"
    assert record["cost"]["search_cost"] is None and record["cost"]["total"] is None
    op.attempts[0].usage = TokenUsage()
    assert op.record(catalog)["input_tokens"] is None
    assert op.record(catalog)["usage_kind"] == "unknown"


def test_usage_extraction_keeps_only_reported_nonnegative_integer_counts():
    assert TokenUsage.from_provider({"prompt_tokens": True, "completion_tokens": -1}).kind == "unknown"
    usage = TokenUsage.from_provider({"prompt_tokens": 5, "completion_tokens": 7,
                                     "prompt_tokens_details": {"cached_tokens": 100}})
    assert usage.input_tokens == 5 and usage.total_tokens is None and usage.cached_input_tokens is None


def test_estimated_usage_is_explicitly_distinct_from_reported_and_unknown():
    operation = Operation(attempts=[
        AttemptRecord("example", "example", "model", 1, False,
                      usage=TokenUsage(100, 20, 120, kind="estimated")),
    ])
    assert operation.record(CostCatalog())["usage_kind"] == "estimated"
    # No current adapter estimates counts; absent provider usage stays unknown.
    assert TokenUsage.from_provider(None).kind == "unknown"


def test_rate_limit_window_global_bound_and_bounded_private_keys():
    clock = [1.]
    settings = replace(ReliabilitySettings(), rate_requests=2, global_rate_requests=3, max_sessions=2)
    limiter = RateLimiter(settings, lambda: clock[0])
    limiter.check("a" * 32)
    limiter.check("a" * 32)
    with pytest.raises(ProviderError):
        limiter.check("a" * 32)
    limiter.check("b" * 32)
    with pytest.raises(ProviderError):
        limiter.check("c" * 32)
    clock[0] += 61
    limiter.check("c" * 32)
    assert len(limiter._sessions) <= 2
    assert all(isinstance(key, bytes) and key != b"a" * 32 for key in limiter._sessions)


@pytest.mark.parametrize("outcome", ["success", "exception", "timeout", "cancel"])
def test_concurrency_resources_release_for_all_exit_paths(outcome):
    async def run():
        capacity = Capacity(1)
        entered = asyncio.Event()
        async def work():
            async with capacity.lease():
                entered.set()
                if outcome == "exception":
                    raise ValueError("private")
                if outcome == "timeout":
                    async with asyncio.timeout(.01):
                        await asyncio.Event().wait()
                if outcome == "cancel":
                    await asyncio.Event().wait()
        task = asyncio.create_task(work())
        await entered.wait()
        if outcome == "cancel":
            with pytest.raises(ProviderError):
                async with capacity.lease():
                    pass
            task.cancel()
        try:
            await task
        except (asyncio.CancelledError, ValueError, TimeoutError):
            pass
        assert capacity.active == 0
        async with capacity.lease():
            assert capacity.active == 1
    asyncio.run(run())


@pytest.mark.parametrize("reason", ["input", "output", "search"])
def test_request_hard_bounds_reject_before_external_work(reason):
    settings = ReliabilitySettings()
    decision = DECISION
    messages = [{"role": "user", "content": "hello"}]
    if reason == "input":
        messages[0]["content"] = "x" * (decision.max_input_chars + 1)
    elif reason == "output":
        settings = replace(settings, max_output_tokens=256)
    else:
        settings = replace(settings, max_search_calls=0)
        decision = decide_routing("Fast", [{"role": "user", "content": "Search the web for current news"}])
    with pytest.raises(ProviderError):
        ReliabilityRuntime(settings).budget(decision, messages)


def test_prepared_grounding_budget_is_enforced():
    runtime = ReliabilityRuntime(replace(ReliabilitySettings(), max_prepared_input_chars=100))
    with pytest.raises(ProviderError):
        runtime.prepared_budget(DECISION, [{"role": "user", "content": "x" * 101}])


def test_search_single_call_timeout_and_resource_cleanup():
    class SlowSearch:
        calls = 0
        async def search(self, query):
            self.calls += 1
            await asyncio.Event().wait()
    async def run():
        runtime = ReliabilityRuntime(replace(ReliabilitySettings(), search_timeout_seconds=.01))
        op, search = Operation(), SlowSearch()
        wrapper = BudgetedSearch(search, runtime, op)
        with pytest.raises(SearchProviderError):
            await wrapper.search("private query")
        assert search.calls == 1 and runtime.search_capacity.active == 0
        with pytest.raises(SearchProviderError):
            await wrapper.search("private query")
        assert search.calls == 1 and op.search_error == "timeout"
    asyncio.run(run())


def test_cancelled_search_releases_permit():
    async def run():
        class Search:
            async def search(self, query):
                await asyncio.Event().wait()
        runtime, op = ReliabilityRuntime(), Operation()
        task = asyncio.create_task(BudgetedSearch(Search(), runtime, op).search("private"))
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert runtime.search_capacity.active == 0
    asyncio.run(run())


def test_ledger_bounded_cancelled_requests_not_successful():
    async def run():
        runtime = ReliabilityRuntime(replace(ReliabilitySettings(), ledger_capacity=2))
        for _ in range(3):
            try:
                async with runtime.request(DECISION, [{"role": "user", "content": "private"}], None):
                    raise asyncio.CancelledError()
            except asyncio.CancelledError:
                pass
        records = runtime.ledger.snapshot()
        assert len(records) == 2
        assert all(r["outcome"] == "cancelled" for r in records)
        assert "private" not in json.dumps(records)
    asyncio.run(run())


async def api_request(path="/api/chat", content="Hello", headers=None):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        return await client.post(path, json={"mode": "Fast", "request_id": "PROMPT_SENTINEL",
                                            "messages": [{"role": "user", "content": content}]}, headers=headers)


def test_api_rate_limits_before_ai_and_uses_normal_contract():
    runtime = ReliabilityRuntime(replace(ReliabilitySettings(), rate_requests=1))
    provider = FakeProvider()
    app.state.reliability, app.state.provider = runtime, provider
    assert asyncio.run(api_request()).status_code == 200
    response = asyncio.run(api_request())
    assert response.status_code == 429 and response.json()["error"]["code"] == "rate-limited"
    assert provider.calls == 1
    assert runtime.ledger.snapshot()[-1]["outcome"] == "rate-limited"


def test_api_overload_is_provider_neutral_and_does_not_call_provider():
    runtime, provider = ReliabilityRuntime(), FakeProvider()
    runtime.capacity.active = runtime.capacity.maximum
    app.state.reliability, app.state.provider = runtime, provider
    response = asyncio.run(api_request("/api/chat/stream"))
    assert '"code":"server-busy"' in response.text and "openrouter" not in response.text
    assert provider.calls == 0


def test_open_ai_circuit_rejects_before_spending_on_search():
    from reliability import CircuitBreaker
    class Search:
        calls = 0
        async def search(self, query):
            self.calls += 1
            return []
    runtime, provider, search = ReliabilityRuntime(), FakeProvider(), Search()
    breaker = CircuitBreaker(1, 100)
    breaker.failure(False)
    runtime.breakers["openrouter-primary"] = breaker
    app.state.reliability, app.state.provider, app.state.search_provider = runtime, provider, search
    response = asyncio.run(api_request(content="Search the web for current facts"))
    assert response.status_code == 503
    assert search.calls == provider.calls == 0


def test_privacy_sentinels_absent_from_ledger_logs_cost_and_readiness(caplog, monkeypatch):
    import logging
    caplog.set_level(logging.INFO, logger="kalillac.operations")
    sentinels = ["PROMPT_SENTINEL", "ANSWER_SENTINEL", "QUERY_SENTINEL", "SOURCE_SENTINEL", "KEY_SENTINEL"]
    monkeypatch.setenv("OPENROUTER_API_KEY", "KEY_SENTINEL")
    class Search:
        async def search(self, query):
            return [NormalizedSource("source-1", "SOURCE_SENTINEL", "https://example.org", "example.org",
                                     "SOURCE_SENTINEL", 1)]
    app.state.provider = FakeProvider(result=__import__("provider").ProviderResult("ANSWER_SENTINEL", "vendor/model"))
    app.state.search_provider = Search()
    response = asyncio.run(api_request(content="Search the web for current QUERY_SENTINEL PROMPT_SENTINEL"))
    assert response.status_code == 200
    runtime = app.state.reliability
    records = runtime.ledger.snapshot()
    assert records[0]["provider_attempts"] == 1 and records[0]["search_calls"] == 1
    assert runtime.capacity.active == runtime.search_capacity.active == 0
    async def ready():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await client.get("/api/readyz")
    health = asyncio.run(ready())
    emitted = json.dumps(records) + health.text + json.dumps(
        [getattr(log, "operation", {}) for log in caplog.records])
    for sentinel in sentinels:
        assert sentinel not in emitted
    assert records[0]["cost"]["total"] is None  # search price unknown, not silently zero


def test_readiness_is_configuration_only_and_never_calls_provider(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    app.state.provider = FakeProvider()
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.get("/health")).json() == {"status": "ok"}
            response = await client.get("/api/readyz")
            assert response.status_code == 503
            assert response.json()["ai_configured"] is False
    asyncio.run(run())
    assert app.state.provider.calls == 0


def test_api_body_limit_before_external_calls(monkeypatch):
    monkeypatch.setenv("KALILLAC_MAX_REQUEST_BODY_BYTES", "1000")
    provider = FakeProvider()
    app.state.provider = provider
    response = asyncio.run(api_request(content="x" * 1100))
    assert response.status_code == 413 and provider.calls == 0


@pytest.mark.parametrize("streaming", [False, True])
def test_api_cancellation_releases_generation_and_closes_provider(streaming):
    from starlette.requests import Request
    from fastapi_app import ChatRequest, chat, chat_stream
    async def run():
        provider = FakeProvider(wait=not streaming)
        fallback = FakeProvider()
        runtime = ReliabilityRuntime()
        app.state.reliability = runtime
        app.state.provider_candidates = [
            ProviderCandidate("first", "fake", provider),
            ProviderCandidate("second", "fake", fallback),
        ]
        request = Request({"type": "http", "app": app, "headers": [], "method": "POST", "path": "/api/chat"})
        payload = ChatRequest(mode="Fast", messages=[{"role": "user", "content": "Hello"}])
        if streaming:
            response = await chat_stream(payload, request, provider, object(), None)
            iterator = response.body_iterator
            assert "delta" in await anext(iterator)
            await iterator.aclose()
            assert provider.closed
        else:
            task = asyncio.create_task(chat(payload, request, provider, object(), None))
            await asyncio.sleep(0)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        assert runtime.capacity.active == 0
        assert fallback.calls == 0
        assert runtime.ledger.snapshot()[-1]["outcome"] == "cancelled"
    asyncio.run(run())


def test_fallback_drops_unpublished_citation_fragments():
    from citation_validation import validate_citations
    class Search:
        async def search(self, query):
            return [NormalizedSource("source-1", "Title", "https://example.org", "example.org", "Evidence", 1)]
    first = FakeProvider(chunks=[
        ProviderStreamEvent("delta", text="[source-"),
        ProviderError("provider-stream-failed", "raw"),
    ])
    second = FakeProvider(chunks=[
        ProviderStreamEvent("delta", text="New answer [source-1]."),
        ProviderStreamEvent("complete", model="vendor/model"),
    ])
    app.state.provider_candidates = [
        ProviderCandidate("first", "fake", first), ProviderCandidate("second", "fake", second),
    ]
    app.state.provider, app.state.search_provider = first, Search()
    response = asyncio.run(api_request("/api/chat/stream", "Search the web for current facts"))
    text = ""
    for line in response.text.splitlines():
        if line.startswith("data: "):
            event = json.loads(line[6:])
            if event["type"] == "delta":
                text += event["text"]
    assert text == validate_citations("New answer [source-1].", {"source-1"})
    assert second.calls == 1
    assert app.state.reliability.ledger.snapshot()[-1]["fallback_used"]


def test_model_disclosure_uses_successful_fallback_runtime_not_primary():
    first = FakeProvider(error=ProviderError("provider-timeout", "private"))
    second = FakeProvider(result=__import__("provider").ProviderResult("I am an invented model", "vendor/actual"))
    app.state.provider = first
    app.state.provider_candidates = [
        ProviderCandidate("first", "first", first), ProviderCandidate("second", "second", second),
    ]
    response = asyncio.run(api_request("/api/chat/stream", "What model is answering this response?"))
    assert "vendor/actual" in response.text
    assert "invented model" not in response.text
    assert '"provider":"second"' in response.text
    assert first.calls == second.calls == 1


@pytest.mark.parametrize("streaming", [False, True])
def test_openrouter_reported_usage_is_normalized_without_live_calls(streaming):
    async def run():
        seen = []
        async def handler(request):
            seen.append(json.loads(request.content))
            usage = {"prompt_tokens": 12, "completion_tokens": 3, "total_tokens": 15}
            if streaming:
                chunks = [
                    {"model": "vendor/model", "choices": [{"delta": {"content": "Answer"}}]},
                    {"choices": [], "usage": usage},
                ]
                body = "".join("data: " + json.dumps(c) + "\n\n" for c in chunks) + "data: [DONE]\n\n"
                return httpx.Response(200, text=body)
            return httpx.Response(200, json={"model": "vendor/model", "choices": [
                {"message": {"content": "Answer"}}], "usage": usage})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = OpenRouterProvider(api_key="fixture", client=client)
            if streaming:
                events = [e async for e in provider.stream([], decision=DECISION, request_id="r")]
                result = events[-1]
                assert seen[0]["stream_options"]["include_usage"] is True
            else:
                result = await provider.complete([], decision=DECISION, request_id="r")
        assert len(seen) == 1
        assert result.model == "vendor/model"
        assert result.usage == TokenUsage(12, 3, 15, kind="reported")
    asyncio.run(run())


@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("error_code,expected", [(401, "provider-authentication-failed"),
                                               ("content_filter", "policy-refusal")])
def test_embedded_upstream_errors_are_normalized_without_payload_leak(streaming, error_code, expected):
    async def run():
        async def handler(request):
            payload = {"error": {"code": error_code, "message": "PRIVATE_ACCOUNT_KEY_SENTINEL"}}
            return httpx.Response(200, text="data: " + json.dumps(payload) + "\n\n") if streaming else (
                httpx.Response(200, json=payload))
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = OpenRouterProvider(api_key="fixture", client=client)
            with pytest.raises(ProviderError) as error:
                if streaming:
                    _ = [e async for e in provider.stream([], decision=DECISION, request_id="r")]
                else:
                    await provider.complete([], decision=DECISION, request_id="r")
            assert error.value.code == expected
            assert "SENTINEL" not in error.value.message
    asyncio.run(run())


def test_openrouter_stream_close_immediately_closes_http_response_not_shared_client():
    async def run():
        class TrackedStream(httpx.AsyncByteStream):
            closed = False
            async def __aiter__(self):
                yield b'data: {"model":"vendor/model","choices":[{"delta":{"content":"Ordinary answer text."}}]}\n\n'
                await asyncio.Event().wait()
            async def aclose(self):
                self.closed = True
        tracked = TrackedStream()
        async def handler(request):
            return httpx.Response(200, stream=tracked)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = OpenRouterProvider(api_key="fixture", client=client)
            iterator = provider.stream([], decision=DECISION, request_id="r")
            assert (await asyncio.wait_for(anext(iterator), 1)).kind == "delta"
            await iterator.aclose()
            assert tracked.closed
            assert not client.is_closed
    asyncio.run(run())
