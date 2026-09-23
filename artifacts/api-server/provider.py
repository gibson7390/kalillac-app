from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Protocol, Sequence

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


class ChatProvider(Protocol):
    async def complete(
        self,
        messages: Sequence[dict[str, str]],
        *,
        mode: str,
        request_id: str,
    ) -> ProviderResult:
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