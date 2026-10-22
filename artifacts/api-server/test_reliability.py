import asyncio
from contextlib import aclosing
from dataclasses import replace
from concurrent.futures import ThreadPoolExecutor

import pytest

from provider import ProviderError, ProviderResult, ProviderStreamEvent
from reliability import CircuitBreaker, ProviderCandidate, ProviderExecutor
from reliability_config import ReliabilitySettings
from routing import decide_routing
from usage_accounting import Operation, TokenUsage


DECISION = decide_routing("Fast", [{"role": "user", "content": "Hello"}])
MESSAGES = [{"role": "user", "content": "private prompt sentinel"}]


class FakeProvider:
    def __init__(self, result=None, error=None, chunks=None, wait=False):
        self.result = result or ProviderResult("answer", "fake/model", usage=TokenUsage(10, 20, 30, kind="reported"))
        self.error, self.chunks, self.wait = error, chunks, wait
        self.calls, self.closed = 0, False

    async def complete(self, *args, **kwargs):
        self.calls += 1
        if self.wait:
            await asyncio.Event().wait()
        if self.error:
            raise self.error
        return self.result

    async def stream(self, *args, **kwargs):
        self.calls += 1
        try:
            if self.wait:
                await asyncio.Event().wait()
            if self.error:
                raise self.error
            for chunk in self.chunks if self.chunks is not None else [
                ProviderStreamEvent("delta", text="answer"),
                ProviderStreamEvent("complete", model=self.result.model, usage=self.result.usage),
            ]:
                if isinstance(chunk, BaseException):
                    raise chunk
                yield chunk
        finally:
            self.closed = True


def candidate(provider, index=0):
    return ProviderCandidate(f"fake-{index}", f"fake{index}", provider)


def execute(providers, settings=None):
    op = Operation.for_decision(DECISION)
    engine = ProviderExecutor([candidate(p, i) for i, p in enumerate(providers)], settings)
    result = asyncio.run(engine.complete(MESSAGES, decision=DECISION, request_id="opaque", operation=op))
    return result, op, engine


def test_primary_success_has_one_attempt():
    first, fallback = FakeProvider(), FakeProvider()
    result, op, _ = execute([first, fallback])
    assert result.content == "answer"
    assert (first.calls, fallback.calls, len(op.attempts)) == (1, 0, 1)
    assert not op.fallback_used


@pytest.mark.parametrize("code,status", [
    ("provider-timeout", 504), ("provider-rate-limited", 429),
    ("provider-unavailable", 503), ("provider-invalid-response", 502),
    ("provider-empty-response", 502), ("provider-invalid-stream", 502),
])
def test_retryable_primary_failure_falls_back(code, status):
    first, fallback = FakeProvider(error=ProviderError(code, "PRIVATE ERROR", status)), FakeProvider()
    _, op, _ = execute([first, fallback])
    assert (first.calls, fallback.calls) == (1, 1)
    assert op.fallback_used
    assert op.attempts[0].outcome == code
    assert op.actual_decision.provider == "fake1"
    assert op.attempts[1].usage.total_tokens == 30


@pytest.mark.parametrize("code", [
    "provider-authentication-failed", "provider-not-configured", "provider-request-failed",
    "policy-refusal", "invalid-request", "request-budget-exceeded",
])
def test_nonretryable_does_not_fallback_or_expose_raw_error(code):
    first, second = FakeProvider(error=ProviderError(code, "credential-secret sentinel", 502)), FakeProvider()
    with pytest.raises(ProviderError) as error:
        execute([first, second])
    assert first.calls == 1 and second.calls == 0
    assert "credential-secret" not in error.value.message


def test_timeout_is_whole_attempt_and_can_fallback():
    slow, second = FakeProvider(wait=True), FakeProvider()
    _, op, _ = execute([slow, second], replace(ReliabilitySettings(), timeout_seconds=.01))
    assert op.attempts[0].outcome == "provider-timeout"
    assert second.calls == 1


def test_all_fail_and_fallback_limit_is_hard():
    providers = [FakeProvider(error=ProviderError("provider-unavailable", "raw")) for _ in range(3)]
    with pytest.raises(ProviderError):
        execute(providers)
    assert [p.calls for p in providers] == [1, 1, 0]


def test_total_attempt_bound_even_if_retries_are_enabled():
    first = FakeProvider(error=ProviderError("provider-unavailable", "raw"))
    with pytest.raises(ProviderError):
        execute([first], replace(ReliabilitySettings(), retries=2, max_attempts=2, backoff_seconds=0))
    assert first.calls == 2


def test_backoff_uses_injected_clock_without_real_sleep():
    sleeps = []
    async def sleep(delay):
        sleeps.append(delay)
    async def run():
        provider = FakeProvider(error=ProviderError("provider-unavailable", "raw"))
        engine = ProviderExecutor([candidate(provider)], replace(ReliabilitySettings(), retries=1), sleep=sleep)
        with pytest.raises(ProviderError):
            await engine.complete(MESSAGES, decision=DECISION, request_id="r", operation=Operation())
    asyncio.run(run())
    assert sleeps == [.1]


@pytest.mark.parametrize("partial", [False, True])
def test_stream_can_fallback_only_before_visible_output(partial):
    async def run():
        chunks = [ProviderStreamEvent("delta", text="partial")] if partial else []
        first = FakeProvider(chunks=chunks + [ProviderError("provider-unavailable", "raw")])
        second = FakeProvider()
        op = Operation.for_decision(DECISION)
        engine = ProviderExecutor([candidate(first), candidate(second, 1)])
        output = []
        try:
            async for event in engine.stream(MESSAGES, decision=DECISION, request_id="r", operation=op):
                output.append(event.text)
        except ProviderError:
            assert partial
        assert second.calls == (0 if partial else 1)
        assert "".join(output) == ("partial" if partial else "answer")
        assert first.closed
    asyncio.run(run())


def test_empty_stream_is_retryable_before_output():
    async def run():
        first = FakeProvider(chunks=[ProviderStreamEvent("complete")])
        second = FakeProvider()
        engine = ProviderExecutor([candidate(first), candidate(second, 1)])
        events = [e async for e in engine.stream(MESSAGES, decision=DECISION, request_id="r", operation=Operation())]
        assert any(e.text == "answer" for e in events)
        assert second.calls == 1
    asyncio.run(run())


def test_cancelled_stream_closes_upstream_and_never_falls_back():
    async def run():
        first, second = FakeProvider(wait=True), FakeProvider()
        op = Operation()
        engine = ProviderExecutor([candidate(first), candidate(second, 1)])
        async def consume():
            async for _ in engine.stream(MESSAGES, decision=DECISION, request_id="r", operation=op):
                pass
        task = asyncio.create_task(consume())
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert first.closed and second.calls == 0
        assert op.attempts[0].outcome == "cancelled"
    asyncio.run(run())


def test_generator_close_after_delta_cancels_without_fallback():
    async def run():
        first, second = FakeProvider(), FakeProvider()
        op = Operation()
        stream = ProviderExecutor([candidate(first), candidate(second, 1)]).stream(
            MESSAGES, decision=DECISION, request_id="r", operation=op)
        async with aclosing(stream):
            assert (await anext(stream)).text == "answer"
        assert first.closed and second.calls == 0
        assert op.attempts[0].outcome == "cancelled"
    asyncio.run(run())


def test_circuit_threshold_cooldown_probe_and_recovery():
    now = [1.]
    breaker = CircuitBreaker(2, 10, lambda: now[0])
    assert breaker.enter() is False
    breaker.failure(False)
    assert breaker.failures == 1 and breaker.state == "closed"
    breaker.failure(False)
    assert breaker.state == "open" and breaker.enter() is None
    now[0] = 12.
    assert breaker.state == "half-open"
    assert breaker.enter() is True
    assert breaker.enter() is None
    breaker.success(True)
    assert breaker.state == "closed" and breaker.failures == 0


def test_circuit_allows_only_one_concurrent_probe():
    breaker = CircuitBreaker(1, 1, lambda: 10.)
    breaker.failure(False)
    breaker.clock = lambda: 12.
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: breaker.enter(), range(16)))
    assert sum(value is True for value in results) == 1
    assert sum(value is None for value in results) == 15


def test_open_circuit_skips_primary_and_uses_fallback():
    first, second = FakeProvider(), FakeProvider()
    settings = replace(ReliabilitySettings(), failure_threshold=1)
    breaker = CircuitBreaker(1, 100)
    breaker.failure(False)
    engine = ProviderExecutor([candidate(first), candidate(second, 1)], settings, {"fake-0": breaker})
    asyncio.run(engine.complete(MESSAGES, decision=DECISION, request_id="r", operation=Operation()))
    assert first.calls == 0 and second.calls == 1


def test_cancelled_half_open_probe_does_not_claim_recovery():
    now = [1.]
    breaker = CircuitBreaker(1, 1, lambda: now[0])
    breaker.failure(False)
    now[0] = 3.
    assert breaker.enter() is True
    breaker.abandon(True)
    assert breaker.state == "open"


def test_reported_usage_before_stream_failure_remains_in_failed_attempt():
    async def run():
        usage = TokenUsage(50, 4, 54, kind="reported")
        first = FakeProvider(chunks=[
            ProviderStreamEvent("usage", model="vendor/first", usage=usage),
            ProviderError("provider-stream-failed", "private"),
        ])
        second = FakeProvider()
        op = Operation()
        engine = ProviderExecutor([candidate(first), candidate(second, 1)])
        events = [e async for e in engine.stream(MESSAGES, decision=DECISION, request_id="r", operation=op)]
        assert all(e.kind != "usage" for e in events)
        assert op.attempts[0].usage == usage
        assert op.attempts[0].returned_model == "vendor/first"
        assert op.fallback_used
    asyncio.run(run())


def test_cancellation_during_backoff_never_starts_another_attempt():
    async def run():
        backoff = asyncio.Event()
        async def sleep(delay):
            backoff.set()
            await asyncio.Event().wait()
        first = FakeProvider(error=ProviderError("provider-unavailable", "private"))
        engine = ProviderExecutor([candidate(first)], replace(ReliabilitySettings(), retries=2), sleep=sleep)
        task = asyncio.create_task(engine.complete(MESSAGES, decision=DECISION, request_id="r", operation=Operation()))
        await backoff.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert first.calls == 1
    asyncio.run(run())
