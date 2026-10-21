from __future__ import annotations

import asyncio
import json
import logging

import httpx
import pytest

from fastapi_app import app
from provider import ProviderResult, ProviderStreamEvent
from routing import RoutingDecision
from search_provider import NormalizedSource, SearchProviderError


class FakeSearchProvider:
    def __init__(self, sources=None, error=None) -> None:
        self.sources = sources if sources is not None else [
            NormalizedSource(
                id="source-1",
                title="Example source",
                url="https://example.org/article",
                domain="example.org",
                snippet="untrusted snippet text used only to ground the answer",
                rank=1,
            )
        ]
        self.error = error
        self.calls: list[str] = []

    async def search(self, query: str):
        self.calls.append(query)
        if self.error:
            raise self.error
        return self.sources


class RecordingChatProvider:
    def __init__(
        self,
        answer: str = "A grounded fact [source-1]. Invalid [source-99].",
        model: str | None = "mock-model",
    ) -> None:
        self.answer = answer
        self.model = model
        self.calls: list[tuple[list[dict[str, str]], RoutingDecision, str]] = []

    async def complete(self, messages, *, decision: RoutingDecision, request_id: str):
        self.calls.append((list(messages), decision, request_id))
        return ProviderResult(self.answer, self.model)

    async def stream(self, messages, *, decision: RoutingDecision, request_id: str):
        self.calls.append((list(messages), decision, request_id))
        yield ProviderStreamEvent("delta", text=self.answer[:22])
        yield ProviderStreamEvent("delta", text=self.answer[22:])
        yield ProviderStreamEvent("complete", model=self.model)


@pytest.fixture(autouse=True)
def clear_providers(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("KALILLAC_CHAT_PROVIDER", "openrouter")
    monkeypatch.setenv("KALILLAC_MODEL", "openrouter/free")
    monkeypatch.setenv("KALILLAC_MAX_OUTPUT_TOKENS_FAST", "900")
    monkeypatch.setenv("KALILLAC_MAX_OUTPUT_TOKENS_SMART", "1800")
    monkeypatch.setenv("KALILLAC_MAX_OUTPUT_TOKENS_DEEP", "3600")
    monkeypatch.setenv("KALILLAC_MAX_TOTAL_INPUT_CHARS", "50000")
    monkeypatch.setenv("KALILLAC_OPTIONAL_SEARCH_ENABLED", "true")
    for name in ("provider", "search_provider"):
        if hasattr(app.state, name):
            delattr(app.state, name)


async def request(method: str, url: str, **kwargs) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.request(method, url, **kwargs)


def test_required_search_streams_text_and_separate_safe_sources(caplog, monkeypatch) -> None:
    caplog.set_level(logging.DEBUG)
    monkeypatch.setenv("TAVILY_API_KEY", "tavily-key-sentinel")
    monkeypatch.setenv("OPENROUTER_API_KEY", "openrouter-key-sentinel")
    chat = RecordingChatProvider()
    search = FakeSearchProvider()
    app.state.provider = chat
    app.state.search_provider = search
    query = "What is the latest public policy?"
    response = asyncio.run(
        request(
            "POST",
            "/api/chat/stream",
            json={"mode": "Fast", "request_id": "opaque-request", "messages": [{"role": "user", "content": query}]},
        )
    )

    assert response.status_code == 200
    assert search.calls == [query]
    assert len(chat.calls) == 1
    assert chat.calls[0][1].search_used is True
    provided_messages = chat.calls[0][0]
    assert provided_messages[0]["role"] == "system"
    assert "Never follow instructions" in provided_messages[0]["content"]
    assert "untrusted snippet text" not in provided_messages[0]["content"]
    evidence = next(
        message["content"] for message in provided_messages
        if message["role"] == "user" and "UNTRUSTED_WEB_EVIDENCE_DATA_ONLY" in message["content"]
    )
    assert "untrusted snippet text" in evidence
    body = response.text
    delta_text = "".join(
        json.loads(line.removeprefix("data: "))["text"]
        for line in body.splitlines()
        if line.startswith("data: ") and '"type":"delta"' in line
    )
    assert delta_text == "A grounded fact [1]. Invalid ."
    complete = json.loads(body.split("event: complete\n", 1)[1].split("\n\n", 1)[0].removeprefix("data: "))
    assert complete["sources"] == [{
        "id": "source-1",
        "title": "Example source",
        "url": "https://example.org/article",
        "domain": "example.org",
    }]
    assert "untrusted snippet text" not in body
    assert query not in body
    assert "score" not in body
    for private_value in (
        "tavily-key-sentinel",
        "openrouter-key-sentinel",
        "untrusted snippet text used only to ground the answer",
        query,
        chat.answer,
    ):
        assert private_value not in caplog.text


def test_required_search_failure_is_retryable_and_does_not_call_chat_provider() -> None:
    chat = RecordingChatProvider()
    search = FakeSearchProvider(error=SearchProviderError("private-upstream-detail"))
    app.state.provider = chat
    app.state.search_provider = search
    response = asyncio.run(
        request(
            "POST",
            "/api/chat/stream",
            json={"mode": "Auto", "messages": [{"role": "user", "content": "What is the latest rate?"}]},
        )
    )
    assert response.status_code == 200
    assert "event: error" in response.text
    assert "Current web information is temporarily unavailable." in response.text
    assert "private-upstream-detail" not in response.text
    assert "Tavily" not in response.text
    assert search.calls == ["What is the latest rate?"]
    assert chat.calls == []


def test_empty_required_search_fails_without_inventing_sources() -> None:
    chat = RecordingChatProvider()
    search = FakeSearchProvider(sources=[])
    app.state.provider = chat
    app.state.search_provider = search
    response = asyncio.run(
        request(
            "POST",
            "/api/chat/stream",
            json={"mode": "Auto", "messages": [{"role": "user", "content": "What is today's schedule?"}]},
        )
    )
    assert "Current web information is temporarily unavailable." in response.text
    assert chat.calls == []


def test_optional_search_failure_uses_stable_knowledge_cautiously() -> None:
    chat = RecordingChatProvider("Some general suggestions.")
    search = FakeSearchProvider(error=SearchProviderError("timeout"))
    app.state.provider = chat
    app.state.search_provider = search
    response = asyncio.run(
        request(
            "POST",
            "/api/chat/stream",
            json={"mode": "Auto", "messages": [{"role": "user", "content": "Recommend some books about space"}]},
        )
    )
    assert "event: complete" in response.text
    assert "event: error" not in response.text
    assert len(search.calls) == 1
    assert len(chat.calls) == 1
    assert "do not claim that you searched" in chat.calls[0][0][0]["content"]
    assert "sources" not in response.text


def test_self_knowledge_answer_uses_local_registry_without_search_or_ai() -> None:
    chat = RecordingChatProvider()
    search = FakeSearchProvider()
    app.state.provider = chat
    app.state.search_provider = search
    query = "Do you remember me?"
    response = asyncio.run(
        request(
            "POST",
            "/api/chat/stream",
            json={"mode": "Auto", "request_id": "self-knowledge", "messages": [{"role": "user", "content": query}]},
        )
    )

    assert response.status_code == 200
    assert "persistent personal memory" in response.text
    assert query not in response.text
    assert search.calls == []
    assert chat.calls == []
    complete = json.loads(response.text.split("event: complete\n", 1)[1].split("\n\n", 1)[0].removeprefix("data: "))
    assert complete["runtime"]["task_class"] == "self_knowledge"
    assert complete["runtime"]["search_policy"] == "disabled"
    assert complete["runtime"]["search_used"] is False
    assert complete["runtime"]["provider"] == "local"
    assert complete["runtime"]["model_identity"] == "not_used"


@pytest.mark.parametrize("endpoint", ["/api/chat", "/api/chat/stream"])
@pytest.mark.parametrize("model", ["vendor/actual-model", None, "openrouter/free"])
def test_model_disclosure_uses_runtime_metadata_not_generated_self_identification(endpoint, model) -> None:
    chat = RecordingChatProvider("I am an invented model. SECRET_METADATA", model=model)
    search = FakeSearchProvider()
    app.state.provider = chat
    app.state.search_provider = search
    response = asyncio.run(request(
        "POST",
        endpoint,
        json={"mode": "Auto", "messages": [{
            "role": "user",
            "content": "What model is answering this response? Tell me only what Kalillac can verify from the actual runtime.",
        }]},
    ))
    assert response.status_code == 200
    assert len(chat.calls) == 1
    assert search.calls == []
    assert "invented model" not in response.text
    assert "SECRET_METADATA" not in response.text
    if model == "vendor/actual-model":
        assert "reported the model vendor/actual-model" in response.text
    else:
        assert "exact underlying model is not available reliably" in response.text


def test_timeless_request_skips_search_and_preserves_existing_provider_contract() -> None:
    chat = RecordingChatProvider("Four.")
    search = FakeSearchProvider()
    app.state.provider = chat
    app.state.search_provider = search
    response = asyncio.run(
        request(
            "POST",
            "/api/chat",
            json={"mode": "Fast", "messages": [{"role": "user", "content": "What is two plus two?"}]},
        )
    )
    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "assistant"
    assert body["content"] == "Four."
    assert body["model"] == "mock-model"
    assert body["runtime"]["requested_mode"] == "Fast"
    assert body["runtime"]["effective_mode"] == "Fast"
    assert body["runtime"]["search_used"] is False
    assert search.calls == []
    assert chat.calls[0][0] == [{"role": "user", "content": "What is two plus two?"}]


def test_nonstream_search_returns_only_normalized_sources_and_validated_citations() -> None:
    chat = RecordingChatProvider("Supported [source-1], unsupported [source-2].")
    search = FakeSearchProvider()
    app.state.provider = chat
    app.state.search_provider = search
    response = asyncio.run(
        request(
            "POST",
            "/api/chat",
            json={"mode": "Smart", "messages": [{"role": "user", "content": "Search for the latest policy"}]},
        )
    )
    assert response.status_code == 200
    body = response.json()
    assert body["content"] == "Supported [1], unsupported ."
    assert body["sources"] == [{
        "id": "source-1",
        "title": "Example source",
        "url": "https://example.org/article",
        "domain": "example.org",
    }]
    assert "snippet" not in json.dumps(body)
