import asyncio
import json

import httpx
import pytest

from provider import OpenRouterProvider
from response_text import CustomerTextNormalizer, normalize_customer_text


@pytest.mark.parametrize("text", [
    "Hello.\nUser Safety: safe\nResponse Safety: safe",
    "User Safety: unsafe\nA refusal remains unchanged.\nResponse Safety: safe\n",
    "**User Safety**: **safe**\nHello.\n**Response Safety**: safe\n",
    "**User Safety:** safe\nHello.\n**Response Safety:** safe\n",
])
def test_safety_classifications_are_structured_not_visible(text):
    visible, metadata = normalize_customer_text(text)
    assert "User Safety:" not in visible
    assert "Response Safety:" not in visible
    assert metadata["response_safety"] == "safe"
    assert "user_safety" in metadata
    if "refusal" in text:
        assert "A refusal remains unchanged." in visible


@pytest.mark.parametrize("text", [
    "Normal prose with no labels.",
    "A user safety discussion is still visible.\nMore prose.\n",
    "```text\nUser Safety: safe\nResponse Safety: safe\n```\n",
    "~~~~text\nUser Safety: unsafe\n~~~~\n",
    "    User Safety: safe\n\tResponse Safety: safe\n",
    "```html\n" + "\n".join(f'<div id="{i}">long code</div>' for i in range(12000)),
])
def test_ordinary_text_and_complete_or_incomplete_code_are_byte_preserved(text):
    for size in (1, 7, 1024, len(text)):
        normalizer = CustomerTextNormalizer()
        visible = "".join(normalizer.feed(text[i:i + size]) for i in range(0, len(text), size))
        visible += normalizer.finish()
        assert visible == text
        assert normalizer.safety_metadata == {}


def test_split_labels_never_leak_during_streaming():
    text = "User Safety: safe\nVisible answer.\nResponse Safety: safe"
    for split in range(1, len(text)):
        normalizer = CustomerTextNormalizer()
        visible = normalizer.feed(text[:split])
        assert "User Safety:" not in visible
        assert "Response Safety:" not in visible
        visible += normalizer.feed(text[split:]) + normalizer.finish()
        assert visible == "Visible answer.\n"
        assert normalizer.safety_metadata == {"user_safety": "safe", "response_safety": "safe"}


def test_provider_complete_retains_safety_metadata_internally():
    async def run():
        def upstream(_request):
            return httpx.Response(200, json={
                "model": "fixture",
                "choices": [{"message": {"content": "User Safety: safe\nAnswer.\nResponse Safety: safe"}}],
            })
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            return await OpenRouterProvider(api_key="test-only", client=client).complete(
                [{"role": "user", "content": "fixture"}], mode="Auto", request_id="fixture",
            )
    result = asyncio.run(run())
    assert result.content == "Answer."
    assert result.safety_metadata == {"user_safety": "safe", "response_safety": "safe"}


def test_provider_stream_normalizes_actual_content_not_only_metadata_fields():
    async def run():
        chunks = ["User Sa", "fety: safe\n", "The answer.\nRes", "ponse Safety: safe"]
        body = "".join("data: " + json.dumps({
            "model": "fixture", "choices": [{"delta": {"content": chunk, "reasoning": "internal-only"}}],
        }) + "\n\n" for chunk in chunks) + "data: [DONE]\n\n"
        def upstream(_request):
            return httpx.Response(200, text=body)
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            provider = OpenRouterProvider(api_key="test-only", client=client)
            return [event async for event in provider.stream(
                [{"role": "user", "content": "fixture"}], mode="Auto", request_id="fixture",
            )]
    events = asyncio.run(run())
    assert "".join(event.text for event in events if event.kind == "delta") == "The answer.\n"
    assert events[-1].safety_metadata == {"user_safety": "safe", "response_safety": "safe"}
