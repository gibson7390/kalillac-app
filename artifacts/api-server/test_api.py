from __future__ import annotations

import asyncio
import json
from typing import Sequence

import httpx
import pytest

from fastapi_app import app
from provider import (
    OpenRouterProvider,
    ProviderError,
    ProviderResult,
    ProviderStreamEvent,
)


class FakeProvider:
    def __init__(self, result: ProviderResult | None = None, error: Exception | None = None) -> None:
        self.calls: list[tuple[Sequence[dict[str, str]], str, str]] = []
        self.result = result or ProviderResult("A real mocked answer.", "mock-model")
        self.error = error

    async def complete(
        self,
        messages: Sequence[dict[str, str]],
        *,
        mode: str,
        request_id: str,
    ) -> ProviderResult:
        self.calls.append((messages, mode, request_id))
        if self.error:
            raise self.error
        return self.result

    async def stream(
        self,
        messages: Sequence[dict[str, str]],
        *,
        mode: str,
        request_id: str,
    ):
        if self.error:
            raise self.error
        yield ProviderStreamEvent("delta", text="A ")
        yield ProviderStreamEvent("delta", text="streamed answer.")
        yield ProviderStreamEvent("complete", model=self.result.model)


async def request(
    method: str,
    url: str,
    **kwargs: object,
) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.request(method, url, **kwargs)


@pytest.fixture(autouse=True)
def clear_provider() -> None:
    if hasattr(app.state, "provider"):
        del app.state.provider


def test_health_is_non_sensitive() -> None:
    response = asyncio.run(request("GET", "/health"))
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_chat_validates_roles_and_unknown_fields() -> None:
    response = asyncio.run(
        request(
            "POST",
            "/api/chat",
            json={
                "mode": "Auto",
                "messages": [
                    {"role": "user", "content": "hello", "unsupported": "nope"},
                ],
            },
        )
    )
    assert response.status_code == 422
    assert response.json() == {
        "error": {"code": "invalid-request", "message": "The chat request is invalid."}
    }


def test_chat_rejects_non_user_final_message() -> None:
    response = asyncio.run(
        request(
            "POST",
            "/api/chat",
            json={
                "mode": "Fast",
                "messages": [
                    {"role": "user", "content": "hello"},
                    {"role": "assistant", "content": "already answered"},
                ],
            },
        )
    )
    assert response.status_code == 422


def test_chat_passes_mode_and_context_to_provider() -> None:
    provider = FakeProvider()
    app.state.provider = provider
    response = asyncio.run(
        request(
            "POST",
            "/api/chat",
            headers={"X-Request-ID": "opaque-request-1"},
            json={
                "mode": "Deep",
                "messages": [
                    {"role": "user", "content": "first"},
                    {"role": "assistant", "content": "context"},
                    {"role": "user", "content": "follow-up"},
                ],
            },
        )
    )
    assert response.status_code == 200
    assert response.json() == {
        "role": "assistant",
        "content": "A real mocked answer.",
        "request_id": "opaque-request-1",
        "model": "mock-model",
    }
    assert provider.calls == [
        (
            [
                {"role": "user", "content": "first"},
                {"role": "assistant", "content": "context"},
                {"role": "user", "content": "follow-up"},
            ],
            "Deep",
            "opaque-request-1",
        )
    ]


def test_provider_failure_is_safe_and_retryable() -> None:
    app.state.provider = FakeProvider(
        error=ProviderError("provider-rate-limited", "The AI provider is temporarily rate limited.", 503)
    )
    response = asyncio.run(
        request(
            "POST",
            "/api/chat",
            json={"mode": "Auto", "messages": [{"role": "user", "content": "hello"}]},
        )
    )
    assert response.status_code == 503
    assert response.json() == {
        "error": {
            "code": "provider-rate-limited",
            "message": "The AI provider is temporarily rate limited.",
        }
    }


def test_openrouter_provider_sends_backend_only_credentials_and_configured_model() -> None:
    observed: dict[str, object] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        observed["authorization"] = request.headers["authorization"]
        body = json.loads(request.content)
        observed["body"] = body
        return httpx.Response(
            200,
            json={
                "model": "returned-free-model",
                "choices": [{"message": {"role": "assistant", "content": "provider answer"}}],
            },
        )

    async def run() -> ProviderResult:
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            provider = OpenRouterProvider(
                api_key="backend-only-test-key",
                model="configured-test-model",
                client=client,
            )
            return await provider.complete(
                [{"role": "user", "content": "hello"}],
                mode="Auto",
                request_id="test-request",
            )
        finally:
            await client.aclose()

    result = asyncio.run(run())
    assert result == ProviderResult("provider answer", "returned-free-model")
    assert observed["authorization"] == "Bearer backend-only-test-key"
    assert observed["body"]["model"] == "configured-test-model"  # type: ignore[index]
    assert observed["body"]["stream"] is False  # type: ignore[index]


def test_chat_stream_emits_machine_readable_deltas_and_completion() -> None:
    provider = FakeProvider(result=ProviderResult("unused", "mock-stream-model"))
    app.state.provider = provider
    response = asyncio.run(
        request(
            "POST",
            "/api/chat/stream",
            json={
                "mode": "Auto",
                "request_id": "stream-request-1",
                "messages": [{"role": "user", "content": "stream this"}],
            },
        )
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    body = response.text
    assert 'event: delta\ndata: {"type":"delta","request_id":"stream-request-1","text":"A "}' in body
    assert '"text":"streamed answer."' in body
    assert 'event: complete\ndata: {"type":"complete","request_id":"stream-request-1","model":"mock-stream-model"}' in body
    assert "backend-only-test-key" not in body


def test_chat_stream_serializes_safe_provider_errors_without_internal_details() -> None:
    app.state.provider = FakeProvider(
        error=ProviderError(
            "provider-rate-limited",
            "The AI provider is temporarily rate limited.",
            503,
        )
    )
    response = asyncio.run(
        request(
            "POST",
            "/api/chat/stream",
            json={"mode": "Auto", "messages": [{"role": "user", "content": "hello"}]},
        )
    )

    assert response.status_code == 200
    assert response.text.startswith("event: error\n")
    assert '"type":"error"' in response.text
    assert '"code":"provider-rate-limited"' in response.text
    assert "Traceback" not in response.text
    assert "OPENROUTER_API_KEY" not in response.text


def test_openrouter_provider_streams_deltas_and_keeps_secret_out_of_events() -> None:
    observed: dict[str, object] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        observed["authorization"] = request.headers["authorization"]
        observed["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            content=(
                b'data: {"model":"returned-stream-model","choices":[{"delta":{"content":"hello"}}]}\n\n'
                b'data: {"choices":[{"delta":{"content":" world"}}]}\n\n'
                b"data: [DONE]\n\n"
            ),
        )

    async def run() -> list[ProviderStreamEvent]:
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            provider = OpenRouterProvider(
                api_key="backend-only-stream-key",
                model="configured-stream-model",
                client=client,
            )
            events: list[ProviderStreamEvent] = []
            async for event in provider.stream(
                [{"role": "user", "content": "hello"}],
                mode="Auto",
                request_id="stream-provider-test",
            ):
                events.append(event)
            return events
        finally:
            await client.aclose()

    events = asyncio.run(run())
    assert [event.kind for event in events] == ["delta", "delta", "complete"]
    assert "".join(event.text for event in events) == "hello world"
    assert events[-1].model == "returned-stream-model"
    assert observed["authorization"] == "Bearer backend-only-stream-key"
    assert observed["body"]["stream"] is True  # type: ignore[index]


def test_openrouter_provider_rejects_malformed_stream_events_safely() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=b'data: {"choices":[]}\n\ndata: [DONE]\n\n',
        )

    async def run() -> None:
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            provider = OpenRouterProvider(
                api_key="backend-only-malformed-key",
                client=client,
            )
            async for _event in provider.stream(
                [{"role": "user", "content": "hello"}],
                mode="Auto",
                request_id="malformed-stream-test",
            ):
                pass
        finally:
            await client.aclose()

    with pytest.raises(ProviderError) as error:
        asyncio.run(run())
    assert error.value.code == "provider-invalid-stream"
    assert "backend-only-malformed-key" not in str(error.value)
