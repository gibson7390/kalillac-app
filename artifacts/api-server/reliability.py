"""Provider-independent, bounded execution. No content is retained in operational state."""
import asyncio
from collections import OrderedDict
from contextlib import asynccontextmanager, aclosing
from dataclasses import dataclass, replace
import hashlib
import hmac
import re
import secrets
import threading
import time

from provider import ProviderError, normalize_model_id
from reliability_config import ReliabilitySettings
from usage_accounting import AttemptRecord, CostCatalog, OperationalLedger
from search_provider import SearchProviderError


RETRYABLE = {
    "provider-timeout", "provider-unavailable", "provider-rate-limited",
    "provider-invalid-response", "provider-empty-response", "provider-invalid-stream",
    "provider-stream-failed", "provider-stream-incomplete",
}
NON_RETRYABLE = {
    "invalid-request", "request-budget-exceeded", "provider-request-failed",
    "provider-authentication-failed", "provider-not-configured", "policy-refusal",
}
PUBLIC_MESSAGES = {
    "provider-timeout": "The request timed out. Please try again.",
    "provider-rate-limited": "Responses are temporarily unavailable. Please try again.",
    "rate-limited": "Too many requests. Please try again shortly.",
    "server-busy": "The server is busy. Please try again shortly.",
    "invalid-request": "The chat request is invalid.",
    "request-budget-exceeded": "The request exceeds the allowed limits.",
    "current-information-unavailable": "Current web information is temporarily unavailable.",
    "policy-refusal": "This request could not be completed.",
}
SAFE_CODES = RETRYABLE | NON_RETRYABLE | set(PUBLIC_MESSAGES) | {"stream-failed"}


def retryable(error):
    if error.code in NON_RETRYABLE:
        return False
    return error.code in RETRYABLE or error.status_code == 429 or error.status_code >= 500


def public_error(error):
    code = error.code if error.code in SAFE_CODES else "provider-unavailable"
    return ProviderError(code, PUBLIC_MESSAGES.get(code, "Responses are temporarily unavailable. Please try again."),
                         error.status_code)


class CircuitBreaker:
    """One exclusive half-open probe; process-local, never shared across workers."""
    def __init__(self, threshold, cooldown, clock=time.monotonic):
        self.threshold, self.cooldown, self.clock = threshold, cooldown, clock
        self.failures = 0
        self.open_until = 0
        self.probing = False
        self._lock = threading.Lock()

    @property
    def state(self):
        with self._lock:
            if self.probing:
                return "half-open"
            if self.open_until:
                return "open" if self.clock() < self.open_until else "half-open"
            return "closed"

    def enter(self):
        with self._lock:
            if self.probing or (self.open_until and self.clock() < self.open_until):
                return None
            probe = bool(self.open_until)
            if probe:
                self.probing = True
            return probe

    @property
    def available(self):
        with self._lock:
            return not self.probing and (not self.open_until or self.clock() >= self.open_until)

    def success(self, probe):
        with self._lock:
            if probe or not self.open_until:
                self.failures, self.open_until, self.probing = 0, 0, False

    def failure(self, probe):
        with self._lock:
            self.failures += 1
            if probe or self.failures >= self.threshold:
                self.open_until = self.clock() + self.cooldown
            self.probing = False

    def abandon(self, probe):
        if probe:
            with self._lock:
                self.probing = False
                self.open_until = self.clock() + self.cooldown


class Capacity:
    """Fail-fast async lease: zero queued requests, thread-safe across event loops."""
    def __init__(self, maximum):
        self.maximum, self.active = maximum, 0
        self._lock = threading.Lock()

    @property
    def overloaded(self):
        with self._lock:
            return self.active >= self.maximum

    @asynccontextmanager
    async def lease(self):
        with self._lock:
            if self.active >= self.maximum:
                raise ProviderError("server-busy", PUBLIC_MESSAGES["server-busy"], 503)
            self.active += 1
        try:
            yield
        finally:
            with self._lock:
                self.active -= 1


class RateLimiter:
    """Global bound plus advisory ephemeral-session windows. No IP identity/storage."""
    def __init__(self, settings, clock=time.monotonic):
        self.settings, self.clock = settings, clock
        self._key = secrets.token_bytes(32)
        self._sessions = OrderedDict()
        self._global = (0., 0)
        self._lock = threading.Lock()

    def check(self, session):
        # Only UUID-like random session tokens. Missing/invalid headers share one bucket.
        value = session if session and re.fullmatch(r"[a-fA-F0-9-]{32,36}", session) else "anonymous"
        key = hmac.new(self._key, value.encode(), hashlib.sha256).digest()
        now, window = self.clock(), self.settings.rate_window_seconds
        with self._lock:
            global_start, global_count = self._global
            if now - global_start >= window:
                global_start, global_count = now, 0
            start, count = self._sessions.get(key, (now, 0))
            if now - start >= window:
                start, count = now, 0
            if global_count >= self.settings.global_rate_requests or count >= self.settings.rate_requests:
                raise ProviderError("rate-limited", PUBLIC_MESSAGES["rate-limited"], 429)
            self._global = (global_start, global_count + 1)
            self._sessions[key] = (start, count + 1)
            self._sessions.move_to_end(key)
            while len(self._sessions) > self.settings.max_sessions:
                self._sessions.popitem(last=False)


@dataclass(frozen=True)
class ProviderCandidate:
    id: str
    provider_name: str
    provider: object
    configured_model: str | None = None

    def __post_init__(self):
        for value in (self.id, self.provider_name):
            if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", value):
                raise ValueError("Invalid provider candidate identifier")
        if self.configured_model is not None and normalize_model_id(self.configured_model) is None:
            raise ValueError("Invalid candidate model")


class ProviderExecutor:
    def __init__(self, candidates, settings=None, breakers=None, clock=time.monotonic, sleep=asyncio.sleep):
        self.settings = settings or ReliabilitySettings()
        self.candidates = tuple(candidates)
        if len({c.id for c in self.candidates}) != len(self.candidates):
            raise ValueError("Candidate IDs must be unique")
        self.breakers = breakers if breakers is not None else {}
        for candidate in self.candidates:
            self.breakers.setdefault(candidate.id, CircuitBreaker(
                self.settings.failure_threshold, self.settings.cooldown_seconds, clock))
        self.clock, self.sleep = clock, sleep

    def ensure_available(self):
        if not any(self.breakers[c.id].available
                   for c in self.candidates[:self.settings.max_fallbacks + 1]):
            raise ProviderError("provider-unavailable", "Responses are temporarily unavailable.", 503)

    async def _execute(self, messages, decision, request_id, operation, streaming, managed_visibility,
                       allow_metadata_only=False):
        last_error = ProviderError("provider-unavailable", "Temporarily unavailable.", 503)
        candidates = self.candidates[:self.settings.max_fallbacks + 1]
        for index, candidate in enumerate(candidates):
            # Prefer the next candidate to identical retries when a fallback exists.
            retries = 0 if index + 1 < len(candidates) else self.settings.retries
            for retry in range(retries + 1):
                if len(operation.attempts) >= self.settings.max_attempts:
                    raise public_error(last_error)
                breaker = self.breakers[candidate.id]
                probe = breaker.enter()
                if probe is None:
                    break
                actual = replace(decision, provider=candidate.provider_name,
                                 configured_model=candidate.configured_model or decision.configured_model)
                operation.actual_decision = actual
                attempt = AttemptRecord(candidate.id, candidate.provider_name, actual.configured_model,
                                        len(operation.attempts) + 1, index > 0)
                operation.attempts.append(attempt)
                operation.fallback_used |= index > 0
                operation.ai_provider = candidate.provider_name
                operation.configured_model = actual.configured_model
                started, useful, completed = self.clock(), False, False
                try:
                    async with asyncio.timeout(self.settings.timeout_seconds):
                        if not streaming:
                            result = await candidate.provider.complete(messages, decision=actual, request_id=request_id)
                            if not result.content.strip():
                                raise ProviderError("provider-empty-response", "Empty response.", 502)
                            attempt.returned_model = normalize_model_id(result.model)
                            attempt.usage = result.usage
                            completed = True
                            yield result
                        else:
                            stream = candidate.provider.stream(messages, decision=actual, request_id=request_id)
                            async with aclosing(stream):
                                async for event in stream:
                                    if event.kind == "usage":
                                        # Operational metadata only, never sent as customer prose.
                                        attempt.usage = event.usage
                                        attempt.returned_model = normalize_model_id(event.model)
                                        continue
                                    if event.kind == "delta":
                                        useful |= bool(event.text.strip())
                                        if not managed_visibility and event.text.strip():
                                            operation.visible = True
                                    elif event.kind == "complete":
                                        if not useful and not allow_metadata_only:
                                            raise ProviderError("provider-empty-response", "Empty response.", 502)
                                        completed = True
                                        attempt.returned_model = normalize_model_id(event.model)
                                        if event.usage.kind != "unknown":
                                            attempt.usage = event.usage
                                    else:
                                        raise ProviderError("provider-invalid-stream", "Invalid stream.", 502)
                                    yield event
                                    if completed:
                                        break
                            if not completed:
                                raise ProviderError("provider-stream-incomplete", "Incomplete stream.", 502)
                    attempt.outcome = "success"
                    operation.returned_model = attempt.returned_model
                    breaker.success(probe)
                    return
                except (asyncio.CancelledError, GeneratorExit):
                    attempt.outcome = "cancelled"
                    breaker.abandon(probe)
                    raise
                except Exception as exc:
                    # Exception objects/messages never enter diagnostics or ledger.
                    if isinstance(exc, TimeoutError):
                        error = ProviderError("provider-timeout", PUBLIC_MESSAGES["provider-timeout"], 504)
                    elif isinstance(exc, ProviderError):
                        error = exc
                        if exc.usage.kind != "unknown":
                            attempt.usage = exc.usage
                        if exc.returned_model:
                            attempt.returned_model = normalize_model_id(exc.returned_model)
                    else:
                        error = ProviderError("provider-unavailable", "Temporarily unavailable.", 502)
                    attempt.outcome = public_error(error).code
                    operation.returned_model = attempt.returned_model
                    if retryable(error):
                        breaker.failure(probe)
                    else:
                        breaker.abandon(probe)
                    if operation.visible or not retryable(error):
                        raise public_error(error) from None
                    last_error = error
                    if retry < retries and self.settings.backoff_seconds:
                        await self.sleep(min(2, self.settings.backoff_seconds * (2 ** retry)))
                finally:
                    attempt.latency_ms = max(0, int((self.clock() - started) * 1000))
        raise public_error(last_error)

    async def complete(self, messages, *, decision, request_id, operation):
        result = None
        async for item in self._execute(messages, decision, request_id, operation, False, False):
            result = item
        return result

    async def stream(self, messages, *, decision, request_id, operation, managed_visibility=False,
                     allow_metadata_only=False):
        iterator = self._execute(messages, decision, request_id, operation, True, managed_visibility,
                                 allow_metadata_only)
        async with aclosing(iterator):
            async for event in iterator:
                yield event


class BudgetedSearch:
    def __init__(self, provider, runtime, operation, provider_name="search"):
        self.provider, self.runtime, self.operation = provider, runtime, operation
        self.provider_name = provider_name

    async def search(self, query):
        op, runtime = self.operation, self.runtime
        if op.search_calls >= runtime.settings.max_search_calls:
            raise SearchProviderError("budget-exceeded")
        try:
            async with runtime.search_capacity.lease():
                op.search_calls += 1
                op.search_provider = self.provider_name
                async with asyncio.timeout(runtime.settings.search_timeout_seconds):
                    sources = await self.provider.search(query)
                op.search_used = bool(sources)
                return sources
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            code = exc.error_class if isinstance(exc, SearchProviderError) else (
                "timeout" if isinstance(exc, TimeoutError) else "unavailable")
            op.search_error = code if code in {
                "timeout", "unavailable", "authentication", "rate-limited", "empty-results",
                "not-configured", "query-limit", "invalid-response", "response-too-large",
                "upstream-failure", "budget-exceeded",
            } else "unavailable"
            raise SearchProviderError(op.search_error) from None


class ReliabilityRuntime:
    def __init__(self, settings=None, catalog=None, clock=time.monotonic):
        self.settings = settings or ReliabilitySettings.from_env()
        self.catalog = catalog or CostCatalog.from_env()
        self.ledger = OperationalLedger(self.settings.ledger_capacity)
        self.rate = RateLimiter(self.settings, clock)
        self.capacity = Capacity(self.settings.active_generations)
        self.search_capacity = Capacity(self.settings.active_searches)
        self.breakers = {}

    def budget(self, decision, messages):
        if (sum(len(m["content"]) for m in messages) > min(decision.max_input_chars, self.settings.max_prepared_input_chars)
                or len(messages) > decision.max_context_messages
                or decision.output_token_limit > self.settings.max_output_tokens):
            raise ProviderError("request-budget-exceeded", PUBLIC_MESSAGES["request-budget-exceeded"], 422)
        if decision.search_required and not self.settings.max_search_calls:
            raise ProviderError("current-information-unavailable",
                                PUBLIC_MESSAGES["current-information-unavailable"], 503)

    def prepared_budget(self, decision, messages):
        if (sum(len(m["content"]) for m in messages) > self.settings.max_prepared_input_chars
                or len(messages) > decision.max_context_messages + 2):
            raise ProviderError("request-budget-exceeded", PUBLIC_MESSAGES["request-budget-exceeded"], 422)

    @asynccontextmanager
    async def request(self, decision, messages, session):
        from usage_accounting import Operation
        operation = Operation.for_decision(decision)
        try:
            self.rate.check(session)
            self.budget(decision, messages)
            yield operation
            operation.outcome = "success"
        except (asyncio.CancelledError, GeneratorExit):
            operation.outcome = "cancelled"
            raise
        except ProviderError as exc:
            operation.outcome = public_error(exc).code
            raise
        except Exception:
            operation.outcome = "internal-error"
            raise
        finally:
            self.ledger.append(operation, self.catalog)

    def executor(self, candidates):
        return ProviderExecutor(candidates, self.settings, self.breakers)
