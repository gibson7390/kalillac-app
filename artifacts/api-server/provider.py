from __future__ import annotations

import os
import json
import re
from dataclasses import dataclass, field
from contextlib import aclosing
from typing import Any, AsyncIterator, Protocol, Sequence

import httpx
from response_text import CustomerTextNormalizer, normalize_customer_text
from routing import RoutingDecision, render_runtime_system_context
from runtime_config import ai_timeout_seconds
from usage_accounting import TokenUsage


OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
KALILLAC_SYSTEM_INSTRUCTION = (
    "You are Kalillac, a capable general-purpose AI assistant. "
    "Answer the user's actual question directly and accurately. "
    "Use readable Markdown when useful. "
    "Do not claim persistent memory or knowledge of previous sessions. "
    "Do not tell users that temporary conversations will be remembered later. "
    "Follow existing safety expectations without unnecessary lecturing. "
    "Do not include internal safety classifications or reasoning metadata in the customer-facing answer."
)


class ProviderError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 502,
                 *, usage: TokenUsage | None = None, model: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.usage = usage or TokenUsage()
        self.returned_model = model


@dataclass(frozen=True)
class ProviderResult:
    content: str
    model: str | None
    safety_metadata: dict[str, str] = field(default_factory=dict)
    usage: TokenUsage = field(default_factory=TokenUsage)


@dataclass(frozen=True)
class ProviderStreamEvent:
    kind: str
    text: str = ""
    model: str | None = None
    safety_metadata: dict[str, str] = field(default_factory=dict)
    usage: TokenUsage = field(default_factory=TokenUsage)


class ChatProvider(Protocol):
    async def complete(
        self,
        messages: Sequence[dict[str, str]],
        *,
        decision: RoutingDecision,
        request_id: str,
    ) -> ProviderResult:
        ...

    def stream(
        self,
        messages: Sequence[dict[str, str]],
        *,
        decision: RoutingDecision,
        request_id: str,
    ) -> AsyncIterator[ProviderStreamEvent]:
        ...


_MODEL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$")


def normalize_model_id(value: object) -> str | None:
    if isinstance(value, str):
        candidate = value.strip()
        lowered = candidate.lower()
        looks_like_credential = (
            lowered.startswith(("sk-", "or-v1-", "bearer "))
            or any(marker in lowered for marker in ("api_key", "api-key", "secret", "token"))
        )
        if _MODEL_ID.fullmatch(candidate) and not looks_like_credential:
            return candidate
    return None


def _check_embedded_error(body: Any) -> None:
    """Normalize 200/SSE error envelopes without retaining raw provider payloads."""
    error = body.get("error") if isinstance(body, dict) else None
    if not isinstance(error, dict):
        return
    code = error.get("code")
    if code in {"content_filter", "policy_refusal"}:
        raise ProviderError("policy-refusal", "This request could not be completed.", 400)
    if code in {401, 403}:
        raise ProviderError("provider-authentication-failed", "Temporarily unavailable.", 502)
    if code == 429:
        raise ProviderError("provider-rate-limited", "Temporarily unavailable.", 503)
    if code in {400, 422}:
        raise ProviderError("provider-request-failed", "This request could not be completed.", 400)
    raise ProviderError("provider-unavailable", "Temporarily unavailable.", 502)


class OpenRouterProvider:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.api_key = api_key if api_key is not None else os.getenv("OPENROUTER_API_KEY")
        self.model = model or os.getenv("KALILLAC_MODEL", "openrouter/free")
        self._client = client

    async def complete(
        self,
        messages: Sequence[dict[str, str]],
        *,
        decision: RoutingDecision,
        request_id: str,
    ) -> ProviderResult:
        if not self.api_key:
            raise ProviderError(
                "provider-not-configured",
                "The AI provider is not configured.",
                status_code=503,
            )

        system_context = render_runtime_system_context(
            decision,
            search_available=bool(os.getenv("TAVILY_API_KEY")),
        )
        payload = {
            "model": decision.configured_model or self.model,
            "max_tokens": decision.output_token_limit,
            "messages": [
                {
                    "role": "system",
                    "content": f"{KALILLAC_SYSTEM_INSTRUCTION}\n\n{system_context}",
                },
                *messages,
            ],
            "stream": False,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://kalillac.app",
            "X-Title": "Kalillac",
        }

        try:
            if self._client is not None:
                response = await self._client.post(
                    OPENROUTER_URL,
                    headers=headers,
                    json=payload,
                )
            else:
                async with httpx.AsyncClient(timeout=ai_timeout_seconds()) as client:
                    response = await client.post(
                        OPENROUTER_URL,
                        headers=headers,
                        json=payload,
                    )
        except httpx.TimeoutException as exc:
            raise ProviderError(
                "provider-timeout",
                "The AI provider timed out.",
                status_code=504,
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(
                "provider-unavailable",
                "The AI provider is unavailable.",
                status_code=502,
            ) from exc

        if response.status_code in {401, 403}:
            raise ProviderError(
                "provider-authentication-failed",
                "The AI provider rejected the server credentials.",
                status_code=502,
            )
        if response.status_code == 429:
            raise ProviderError(
                "provider-rate-limited",
                "The AI provider is temporarily rate limited.",
                status_code=503,
            )
        if response.status_code >= 500:
            raise ProviderError(
                "provider-unavailable",
                "The AI provider is temporarily unavailable.",
                status_code=502,
            )
        if response.status_code >= 400:
            raise ProviderError(
                "provider-request-failed",
                "The AI provider rejected the request.",
                status_code=502,
            )

        try:
            body: Any = response.json()
            _check_embedded_error(body)
            if body["choices"][0].get("finish_reason") == "content_filter":
                raise ProviderError("policy-refusal", "This request could not be completed.", 400,
                                    usage=TokenUsage.from_provider(body.get("usage")), model=body.get("model"))
            content = body["choices"][0]["message"]["content"]
            returned_model = normalize_model_id(body.get("model"))
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise ProviderError(
                "provider-invalid-response",
                "The AI provider returned an invalid response.",
                status_code=502,
            ) from exc

        if not isinstance(content, str) or not content.strip():
            raise ProviderError(
                "provider-empty-response",
                "The AI provider returned an empty response.",
                status_code=502,
                usage=TokenUsage.from_provider(body.get("usage")),
                model=returned_model,
            )

        visible, safety_metadata = normalize_customer_text(content)
        if not visible.strip():
            raise ProviderError("provider-empty-response", "The AI provider returned an empty response.",
                                usage=TokenUsage.from_provider(body.get("usage")), model=returned_model)
        return ProviderResult(
            content=visible.strip(),
            model=returned_model,
            safety_metadata=safety_metadata,
            usage=TokenUsage.from_provider(body.get("usage")),
        )

    async def _stream_response(
        self,
        response: httpx.Response,
    ) -> AsyncIterator[ProviderStreamEvent]:
        if response.status_code == 401 or response.status_code == 403:
            raise ProviderError(
                "provider-authentication-failed",
                "The AI provider rejected the server credentials.",
                status_code=502,
            )
        if response.status_code == 429:
            raise ProviderError(
                "provider-rate-limited",
                "The AI provider is temporarily rate limited.",
                status_code=503,
            )
        if response.status_code >= 500:
            raise ProviderError(
                "provider-unavailable",
                "The AI provider is temporarily unavailable.",
                status_code=502,
            )
        if response.status_code >= 400:
            raise ProviderError(
                "provider-request-failed",
                "The AI provider rejected the request.",
                status_code=502,
            )

        returned_model: str | None = None
        completed = False
        normalizer = CustomerTextNormalizer()
        usage = TokenUsage()
        try:
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data:
                    continue
                if data == "[DONE]":
                    completed = True
                    break

                try:
                    body: Any = json.loads(data)
                    if not isinstance(body, dict):
                        raise TypeError
                    _check_embedded_error(body)
                    candidate_model = body.get("model")
                    if isinstance(candidate_model, str):
                        returned_model = normalize_model_id(candidate_model)
                    if isinstance(body.get("usage"), dict):
                        usage = TokenUsage.from_provider(body["usage"])
                        yield ProviderStreamEvent("usage", model=returned_model, usage=usage)
                    choices = body["choices"]
                    # Providers may report usage in a final choices=[] frame.
                    if choices == [] and isinstance(body.get("usage"), dict):
                        continue
                    if choices[0].get("finish_reason") == "content_filter":
                        raise ProviderError("policy-refusal", "This request could not be completed.", 400)
                    delta = choices[0]["delta"]
                    content = delta.get("content", "")
                except (ValueError, KeyError, IndexError, TypeError):
                    raise ProviderError(
                        "provider-invalid-stream",
                        "The AI provider returned an invalid stream.",
                        status_code=502,
                    ) from None

                if content is None:
                    continue
                if not isinstance(content, str):
                    raise ProviderError(
                        "provider-invalid-stream",
                        "The AI provider returned an invalid stream.",
                        status_code=502,
                    )
                if content:
                    visible = normalizer.feed(content)
                    if visible:
                        yield ProviderStreamEvent("delta", text=visible, model=returned_model)
        except ProviderError:
            raise
        except httpx.TimeoutException as exc:
            raise ProviderError(
                "provider-timeout",
                "The AI provider timed out.",
                status_code=504,
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(
                "provider-stream-failed",
                "The AI provider stream was interrupted.",
                status_code=502,
            ) from exc

        if not completed:
            raise ProviderError(
                "provider-stream-incomplete",
                "The AI provider stream ended unexpectedly.",
                status_code=502,
            )

        remaining = normalizer.finish()
        if remaining:
            yield ProviderStreamEvent("delta", text=remaining, model=returned_model)
        yield ProviderStreamEvent("complete", model=returned_model, safety_metadata=normalizer.safety_metadata, usage=usage)

    async def stream(
        self,
        messages: Sequence[dict[str, str]],
        *,
        decision: RoutingDecision,
        request_id: str,
    ) -> AsyncIterator[ProviderStreamEvent]:
        if not self.api_key:
            raise ProviderError(
                "provider-not-configured",
                "The AI provider is not configured.",
                status_code=503,
            )

        system_context = render_runtime_system_context(
            decision,
            search_available=bool(os.getenv("TAVILY_API_KEY")),
        )
        payload = {
            "model": decision.configured_model or self.model,
            "max_tokens": decision.output_token_limit,
            "messages": [
                {
                    "role": "system",
                    "content": f"{KALILLAC_SYSTEM_INSTRUCTION}\n\n{system_context}",
                },
                *messages,
            ],
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://kalillac.app",
            "X-Title": "Kalillac",
        }

        async def consume(
            client: httpx.AsyncClient,
        ) -> AsyncIterator[ProviderStreamEvent]:
            try:
                async with client.stream(
                    "POST",
                    OPENROUTER_URL,
                    headers=headers,
                    json=payload,
                ) as response:
                    async with aclosing(self._stream_response(response)) as events:
                        async for event in events:
                            yield event
            except ProviderError:
                raise
            except httpx.TimeoutException as exc:
                raise ProviderError(
                    "provider-timeout",
                    "The AI provider timed out.",
                    status_code=504,
                ) from exc
            except httpx.HTTPError as exc:
                raise ProviderError(
                    "provider-stream-failed",
                    "The AI provider stream was interrupted.",
                    status_code=502,
                ) from exc

        if self._client is not None:
            async with aclosing(consume(self._client)) as events:
                async for event in events:
                    yield event
            return

        async with httpx.AsyncClient(timeout=ai_timeout_seconds()) as client:
            async with aclosing(consume(client)) as events:
                async for event in events:
                    yield event