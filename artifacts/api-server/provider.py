from __future__ import annotations

import os
import json
from dataclasses import dataclass
from typing import Any, AsyncIterator, Protocol, Sequence

import httpx


OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
KALILLAC_SYSTEM_INSTRUCTION = (
    "You are Kalillac, a capable general-purpose AI assistant. "
    "Answer the user's actual question directly and accurately. "
    "Use readable Markdown when useful. "
    "Do not claim persistent memory or knowledge of previous sessions. "
    "Do not tell users that temporary conversations will be remembered later. "
    "Follow existing safety expectations without unnecessary lecturing."
)


class ProviderError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class ProviderResult:
    content: str
    model: str | None


@dataclass(frozen=True)
class ProviderStreamEvent:
    kind: str
    text: str = ""
    model: str | None = None


class ChatProvider(Protocol):
    async def complete(
        self,
        messages: Sequence[dict[str, str]],
        *,
        mode: str,
        request_id: str,
    ) -> ProviderResult:
        ...

    def stream(
        self,
        messages: Sequence[dict[str, str]],
        *,
        mode: str,
        request_id: str,
    ) -> AsyncIterator[ProviderStreamEvent]:
        ...


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
        mode: str,
        request_id: str,
    ) -> ProviderResult:
        if not self.api_key:
            raise ProviderError(
                "provider-not-configured",
                "The AI provider is not configured.",
                status_code=503,
            )

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": KALILLAC_SYSTEM_INSTRUCTION},
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
                async with httpx.AsyncClient(timeout=45.0) as client:
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
            content = body["choices"][0]["message"]["content"]
            returned_model = body.get("model")
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
            )

        return ProviderResult(
            content=content.strip(),
            model=returned_model if isinstance(returned_model, str) else None,
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
                    candidate_model = body.get("model")
                    if isinstance(candidate_model, str):
                        returned_model = candidate_model
                    choices = body["choices"]
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
                    yield ProviderStreamEvent("delta", text=content, model=returned_model)
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

        yield ProviderStreamEvent("complete", model=returned_model)

    async def stream(
        self,
        messages: Sequence[dict[str, str]],
        *,
        mode: str,
        request_id: str,
    ) -> AsyncIterator[ProviderStreamEvent]:
        if not self.api_key:
            raise ProviderError(
                "provider-not-configured",
                "The AI provider is not configured.",
                status_code=503,
            )

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": KALILLAC_SYSTEM_INSTRUCTION},
                *messages,
            ],
            "stream": True,
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
                    async for event in self._stream_response(response):
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
            async for event in consume(self._client):
                yield event
            return

        async with httpx.AsyncClient(timeout=45.0) as client:
            async for event in consume(client):
                yield event