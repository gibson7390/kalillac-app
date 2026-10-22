"""Content-free metrics boundary. No messages, queries, sources or exceptions accepted."""
from collections import deque
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json
import logging
import os
import threading
import time
import uuid
from typing import Literal


@dataclass(frozen=True)
class TokenUsage:
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    cached_input_tokens: int | None = None
    kind: Literal["reported", "estimated", "unknown"] = "unknown"

    @classmethod
    def from_provider(cls, value):
        if not isinstance(value, dict):
            return cls()
        def count(raw):
            return raw if type(raw) is int and 0 <= raw <= 10**9 else None
        inp = count(value.get("prompt_tokens"))
        out = count(value.get("completion_tokens"))
        total = count(value.get("total_tokens"))
        details = value.get("prompt_tokens_details")
        cached = count(details.get("cached_tokens")) if isinstance(details, dict) else None
        if cached is not None and (inp is None or cached > inp):
            cached = None
        return cls(inp, out, total, cached,
                   "reported" if any(n is not None for n in (inp, out, total)) else "unknown")


def price(value):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError("Invalid cost catalog price") from None
    if not result.is_finite() or result < 0 or result > 10**6:
        raise ValueError("Invalid cost catalog price")
    return result


@dataclass(frozen=True)
class ModelPrice:
    input_per_million: Decimal
    output_per_million: Decimal
    cached_input_per_million: Decimal | None = None


class CostCatalog:
    def __init__(self, models=None, searches=None):
        self.models = models if models is not None else {
            ("openrouter", "openrouter/free"): ModelPrice(Decimal(0), Decimal(0)),
        }
        self.searches = searches or {}

    @classmethod
    def from_env(cls):
        catalog = cls()
        raw = os.getenv("KALILLAC_COST_CATALOG_JSON")
        if not raw:
            return catalog
        try:
            config = json.loads(raw)
            for entry in config.get("models", []):
                catalog.models[(entry["provider"], entry["model"])] = ModelPrice(
                    price(entry["input_per_million"]), price(entry["output_per_million"]),
                    price(entry["cached_input_per_million"]) if "cached_input_per_million" in entry else None,
                )
            for provider, value in config.get("search_per_request", {}).items():
                catalog.searches[provider] = price(value)
        except (ValueError, TypeError, KeyError, AttributeError):
            raise ValueError("Invalid KALILLAC_COST_CATALOG_JSON") from None
        return catalog

    def token_cost(self, provider, configured_model, returned_model, usage):
        rate = self.models.get((provider, returned_model)) or self.models.get((provider, configured_model))
        if rate is None:
            return None
        if rate.input_per_million == rate.output_per_million == 0:
            return Decimal(0)
        if usage.input_tokens is None or usage.output_tokens is None:
            return None
        cached = usage.cached_input_tokens or 0
        cached_rate = rate.cached_input_per_million
        input_cost = Decimal(usage.input_tokens - cached) * rate.input_per_million
        input_cost += Decimal(cached) * (cached_rate if cached_rate is not None else rate.input_per_million)
        return (input_cost + Decimal(usage.output_tokens) * rate.output_per_million) / Decimal(1_000_000)


@dataclass
class AttemptRecord:
    provider_id: str
    provider: str
    configured_model: str
    attempt: int
    fallback: bool
    returned_model: str | None = None
    usage: TokenUsage = field(default_factory=TokenUsage)
    outcome: str = "incomplete"
    latency_ms: int = 0


@dataclass
class Operation:
    # Generated internally: caller-controlled correlation IDs are never ledger identifiers.
    request_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    requested_mode: str = ""
    effective_mode: str = ""
    task_class: str = ""
    search_used: bool = False
    search_provider: str | None = None
    search_calls: int = 0
    search_error: str | None = None
    ai_provider: str | None = None
    configured_model: str | None = None
    returned_model: str | None = None
    attempts: list[AttemptRecord] = field(default_factory=list)
    fallback_used: bool = False
    outcome: str = "cancelled"
    latency_ms: int = 0
    visible: bool = False
    actual_decision: object = field(default=None, repr=False)
    started: float = field(default_factory=time.monotonic, repr=False)

    @classmethod
    def for_decision(cls, decision):
        return cls(requested_mode=decision.requested_mode, effective_mode=decision.effective_mode,
                   task_class=decision.task_class.value, configured_model=decision.configured_model,
                   actual_decision=decision)

    def record(self, catalog):
        costs = [catalog.token_cost(a.provider, a.configured_model, a.returned_model, a.usage)
                 for a in self.attempts]
        token_cost = sum(costs, Decimal(0)) if all(c is not None for c in costs) else None
        search_rate = catalog.searches.get(self.search_provider)
        search_cost = Decimal(0) if not self.search_calls else (
            search_rate * self.search_calls if search_rate is not None else None)
        total = token_cost + search_cost if token_cost is not None and search_cost is not None else None
        usages = [a.usage for a in self.attempts]
        usage_kind = "unknown" if not usages or any(u.kind == "unknown" for u in usages) else (
            "reported" if all(u.kind == "reported" for u in usages) else "estimated")
        def aggregate(name):
            values = [getattr(u, name) for u in usages]
            return sum(values) if values and all(v is not None for v in values) else None
        return {
            "request_id": self.request_id, "timestamp": self.timestamp,
            "requested_mode": self.requested_mode, "effective_mode": self.effective_mode,
            "task_class": self.task_class, "search_used": self.search_used,
            "search_provider": self.search_provider, "search_calls": self.search_calls,
            "search_error": self.search_error, "ai_provider": self.ai_provider,
            "configured_model": self.configured_model, "returned_model": self.returned_model,
            "input_tokens": aggregate("input_tokens"), "output_tokens": aggregate("output_tokens"),
            "total_tokens": aggregate("total_tokens"),
            "usage_kind": usage_kind,
            "latency_ms": self.latency_ms, "provider_attempts": len(self.attempts),
            "fallback_used": self.fallback_used, "outcome": self.outcome,
            "attempts": [asdict(a) for a in self.attempts],
            "cost": {"kind": "estimated" if total is not None else "unknown",
                     "token_cost": str(token_cost) if token_cost is not None else None,
                     "search_cost": str(search_cost) if search_cost is not None else None,
                     "total": str(total) if total is not None else None, "currency": "USD"},
        }


class OperationalLedger:
    def __init__(self, capacity=500):
        self._records = deque(maxlen=capacity)
        self._lock = threading.Lock()

    def append(self, operation, catalog):
        operation.latency_ms = max(0, int((time.monotonic() - operation.started) * 1000))
        record = operation.record(catalog)
        with self._lock:
            self._records.append(record)
        logging.getLogger("kalillac.operations").info("request_completed", extra={"operation": record})

    def snapshot(self):
        with self._lock:
            # Copies only the explicit safe schema, never execution objects.
            return json.loads(json.dumps(list(self._records)))
