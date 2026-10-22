"""Single-process limits. Defaults deliberately do not retry generation."""
from dataclasses import dataclass

from runtime_config import ai_timeout_seconds, bounded_float, bounded_int


@dataclass(frozen=True)
class ReliabilitySettings:
    timeout_seconds: float = 45
    retries: int = 0
    max_attempts: int = 2
    max_fallbacks: int = 1
    backoff_seconds: float = 0.1
    failure_threshold: int = 3
    cooldown_seconds: float = 30
    active_generations: int = 4
    active_searches: int = 2
    search_timeout_seconds: float = 8
    max_search_calls: int = 1
    max_output_tokens: int = 8192
    max_prepared_input_chars: int = 100000
    max_body_bytes: int = 600000
    rate_requests: int = 20
    global_rate_requests: int = 120
    rate_window_seconds: float = 60
    max_sessions: int = 2048
    ledger_capacity: int = 500

    def __post_init__(self):
        if not (0 <= self.retries <= 2 and 1 <= self.max_attempts <= 4 and 0 <= self.max_fallbacks <= 3):
            raise ValueError("Invalid attempt limits")
        if not (0 < self.timeout_seconds <= 120 and 0 <= self.backoff_seconds <= 2):
            raise ValueError("Invalid timing limits")
        if min(self.failure_threshold, self.active_generations, self.active_searches,
               self.rate_requests, self.global_rate_requests, self.max_sessions, self.ledger_capacity) < 1:
            raise ValueError("Limits must be positive")
        if not (0 <= self.max_search_calls <= 1 and 256 <= self.max_output_tokens <= 8192):
            raise ValueError("Invalid request budget")
        if min(self.cooldown_seconds, self.rate_window_seconds, self.search_timeout_seconds) <= 0:
            raise ValueError("Durations must be positive")

    @classmethod
    def from_env(cls):
        return cls(
            timeout_seconds=ai_timeout_seconds(),
            retries=bounded_int("KALILLAC_PROVIDER_RETRIES", 0, 0, 2),
            max_attempts=bounded_int("KALILLAC_MAX_PROVIDER_ATTEMPTS", 2, 1, 4),
            max_fallbacks=bounded_int("KALILLAC_MAX_FALLBACKS", 1, 0, 3),
            backoff_seconds=bounded_float("KALILLAC_RETRY_BACKOFF_SECONDS", .1, 0, 2),
            failure_threshold=bounded_int("KALILLAC_CIRCUIT_FAILURE_THRESHOLD", 3, 1, 100),
            cooldown_seconds=bounded_float("KALILLAC_CIRCUIT_COOLDOWN_SECONDS", 30, .01, 3600),
            active_generations=bounded_int("KALILLAC_MAX_ACTIVE_GENERATIONS", 4, 1, 100),
            active_searches=bounded_int("KALILLAC_MAX_ACTIVE_SEARCHES", 2, 1, 100),
            search_timeout_seconds=bounded_float("KALILLAC_TAVILY_TIMEOUT_SECONDS", 8, .1, 30),
            max_search_calls=bounded_int("KALILLAC_MAX_SEARCH_CALLS", 1, 0, 1),
            max_output_tokens=bounded_int("KALILLAC_MAX_REQUEST_OUTPUT_TOKENS", 8192, 256, 8192),
            max_prepared_input_chars=bounded_int("KALILLAC_MAX_PREPARED_INPUT_CHARS", 100000, 100, 200000),
            max_body_bytes=bounded_int("KALILLAC_MAX_REQUEST_BODY_BYTES", 600000, 1000, 2000000),
            rate_requests=bounded_int("KALILLAC_RATE_REQUESTS", 20, 1, 10000),
            global_rate_requests=bounded_int("KALILLAC_GLOBAL_RATE_REQUESTS", 120, 1, 100000),
            rate_window_seconds=bounded_float("KALILLAC_RATE_WINDOW_SECONDS", 60, .1, 3600),
            max_sessions=bounded_int("KALILLAC_RATE_MAX_SESSIONS", 2048, 1, 100000),
            ledger_capacity=bounded_int("KALILLAC_LEDGER_CAPACITY", 500, 1, 10000),
        )
