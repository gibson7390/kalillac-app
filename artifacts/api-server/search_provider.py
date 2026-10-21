from __future__ import annotations

import asyncio
import ipaddress
import json
import os
import re
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlsplit, urlunsplit

import httpx
from runtime_config import bounded_float, bounded_int


TAVILY_SEARCH_URL = "https://api.tavily.com/search"
SEARCH_UNAVAILABLE_MESSAGE = "Current web information is temporarily unavailable."


class SearchProviderError(Exception):
    """Provider-neutral failure; never includes a query or upstream response body."""

    def __init__(self, error_class: str) -> None:
        super().__init__(SEARCH_UNAVAILABLE_MESSAGE)
        self.error_class = error_class


@dataclass(frozen=True)
class SearchSettings:
    max_query_chars: int = 400
    max_results: int = 5
    max_result_chars: int = 1200
    max_total_grounding_chars: int = 5000
    timeout_seconds: float = 8.0
    max_response_bytes: int = 256_000

    def __post_init__(self) -> None:
        if not 1 <= self.max_query_chars <= 1000:
            raise ValueError("max_query_chars must be between 1 and 1000")
        if not 1 <= self.max_results <= 10:
            raise ValueError("max_results must be between 1 and 10")
        if not 1 <= self.max_result_chars <= 5000:
            raise ValueError("max_result_chars must be between 1 and 5000")
        if not 1 <= self.max_total_grounding_chars <= 20_000:
            raise ValueError("max_total_grounding_chars must be between 1 and 20000")
        if not 0.1 <= self.timeout_seconds <= 30:
            raise ValueError("timeout_seconds must be between 0.1 and 30")
        if not 1024 <= self.max_response_bytes <= 1_000_000:
            raise ValueError("max_response_bytes must be between 1024 and 1000000")

    @classmethod
    def from_env(cls) -> "SearchSettings":
        return cls(
            max_query_chars=bounded_int("KALILLAC_MAX_SEARCH_QUERY_CHARS", 400, 1, 1000),
            max_results=bounded_int("KALILLAC_TAVILY_MAX_RESULTS", 5, 1, 10),
            max_result_chars=bounded_int("KALILLAC_MAX_GROUNDING_CHARS_PER_RESULT", 1200, 1, 5000),
            max_total_grounding_chars=bounded_int("KALILLAC_MAX_TOTAL_GROUNDING_CHARS", 5000, 1, 20_000),
            timeout_seconds=bounded_float("KALILLAC_TAVILY_TIMEOUT_SECONDS", 8.0, 0.1, 30.0),
            max_response_bytes=bounded_int("KALILLAC_TAVILY_MAX_RESPONSE_BYTES", 256_000, 1024, 1_000_000),
        )


@dataclass(frozen=True)
class NormalizedSource:
    id: str
    title: str
    url: str
    domain: str
    snippet: str
    rank: int

    def customer_fields(self) -> dict[str, str]:
        return {
            "id": self.id,
            "title": self.title,
            "url": self.url,
            "domain": self.domain,
        }


class SearchProvider(Protocol):
    async def search(self, query: str) -> list[NormalizedSource]:
        ...
def _clean_text(value: Any, max_chars: int) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", "".join(char for char in value if char.isprintable())).strip()[:max_chars]


def _validated_url(value: Any) -> tuple[str, str] | None:
    if (
        not isinstance(value, str)
        or len(value) > 2048
        or "\\" in value
        or any(ord(char) < 0x20 for char in value)
    ):
        return None
    try:
        parsed = urlsplit(value.strip())
        if parsed.scheme.lower() not in {"http", "https"}:
            return None
        if not parsed.hostname or parsed.username is not None or parsed.password is not None:
            return None
        domain = parsed.hostname.encode("idna").decode("ascii").lower().rstrip(".")
        if not domain or any(char.isspace() for char in domain):
            return None
        port = parsed.port
        try:
            address = ipaddress.ip_address(domain)
            if not address.is_global:
                return None
        except ValueError:
            if domain == "localhost" or domain.endswith((".localhost", ".local", ".internal")):
                return None
        netloc = domain + (f":{port}" if port is not None else "")
        safe_url = urlunsplit((parsed.scheme.lower(), netloc, parsed.path, parsed.query, parsed.fragment))
        return safe_url, domain
    except (UnicodeError, ValueError):
        return None


class TavilySearchProvider:
    """Backend-only Tavily adapter with bounded I/O and a mockable httpx boundary."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        client: httpx.AsyncClient | None = None,
        settings: SearchSettings | None = None,
    ) -> None:
        self._api_key = api_key if api_key is not None else os.getenv("TAVILY_API_KEY")
        self._client = client
        self.settings = settings or SearchSettings.from_env()

    async def search(self, query: str) -> list[NormalizedSource]:
        normalized_query = query.strip()
        if not normalized_query or len(normalized_query) > self.settings.max_query_chars:
            raise SearchProviderError("query-limit")
        if not self._api_key:
            raise SearchProviderError("not-configured")

        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "query": normalized_query,
            "search_depth": "basic",
            "topic": "general",
            "max_results": self.settings.max_results,
            "include_answer": False,
            "include_raw_content": False,
            "include_images": False,
            "include_favicon": False,
            "include_usage": False,
        }

        try:
            if self._client is not None:
                async with self._client.stream(
                    "POST",
                    TAVILY_SEARCH_URL,
                    headers=headers,
                    json=body,
                    timeout=self.settings.timeout_seconds,
                ) as response:
                    raw = await self._read_response(response)
            else:
                async with httpx.AsyncClient(timeout=self.settings.timeout_seconds) as client:
                    async with client.stream(
                        "POST",
                        TAVILY_SEARCH_URL,
                        headers=headers,
                        json=body,
                    ) as response:
                        raw = await self._read_response(response)
        except SearchProviderError:
            raise
        except httpx.TimeoutException as exc:
            raise SearchProviderError("timeout") from exc
        except httpx.HTTPError as exc:
            raise SearchProviderError("unavailable") from exc
        except asyncio.CancelledError:
            raise

        try:
            payload: Any = json.loads(raw)
        except (ValueError, TypeError) as exc:
            raise SearchProviderError("invalid-response") from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
            raise SearchProviderError("invalid-response")
        return self._normalize_results(payload["results"])

    async def _read_response(self, response: httpx.Response) -> bytes:
        if response.status_code in {401, 403}:
            raise SearchProviderError("authentication")
        if response.status_code in {429, 432, 433}:
            raise SearchProviderError("rate-limited")
        if response.status_code >= 400:
            raise SearchProviderError("upstream-failure")
        content_length = response.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > self.settings.max_response_bytes:
                    raise SearchProviderError("response-too-large")
            except ValueError:
                pass

        chunks = bytearray()
        async for chunk in response.aiter_bytes():
            chunks.extend(chunk)
            if len(chunks) > self.settings.max_response_bytes:
                raise SearchProviderError("response-too-large")
        return bytes(chunks)

    def _normalize_results(self, results: list[Any]) -> list[NormalizedSource]:
        normalized: list[NormalizedSource] = []
        total_grounding = 0
        for item in results:
            if len(normalized) >= self.settings.max_results:
                break
            if not isinstance(item, dict):
                continue
            title = _clean_text(item.get("title"), 180)
            snippet = _clean_text(item.get("content"), self.settings.max_result_chars)
            validated_url = _validated_url(item.get("url"))
            if not title or not snippet or not validated_url:
                continue
            remaining = self.settings.max_total_grounding_chars - total_grounding
            if remaining <= 0:
                break
            snippet = snippet[:remaining]
            if not snippet:
                break
            rank = len(normalized) + 1
            normalized.append(
                NormalizedSource(
                    id=f"source-{rank}",
                    title=title,
                    url=validated_url[0],
                    domain=validated_url[1],
                    snippet=snippet,
                    rank=rank,
                )
            )
            total_grounding += len(snippet)
        return normalized
