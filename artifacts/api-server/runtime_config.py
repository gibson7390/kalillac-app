from __future__ import annotations

import os


def bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name)
    value = default if raw is None else int(raw)
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def bounded_float(name: str, default: float, minimum: float, maximum: float) -> float:
    raw = os.getenv(name)
    value = default if raw is None else float(raw)
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def ai_timeout_seconds() -> float:
    return bounded_float("KALILLAC_AI_PROVIDER_TIMEOUT_SECONDS", 45.0, 0.1, 120.0)


def max_user_input_chars() -> int:
    return bounded_int("KALILLAC_MAX_USER_INPUT_CHARS", 12_000, 100, 50_000)


def max_total_input_chars() -> int:
    return bounded_int("KALILLAC_MAX_TOTAL_INPUT_CHARS", 50_000, 100, 100_000)
