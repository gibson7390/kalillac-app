from __future__ import annotations

import os
import re


DEFAULT_CHAT_MODEL = "openrouter/free"
DEFAULT_CHAT_PROVIDER = "openrouter"
DYNAMIC_MODEL_ROUTES = frozenset({"openrouter/free", "openrouter/auto"})
MODEL_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$")
OUTPUT_TOKEN_LIMITS = {
    "Fast": ("KALILLAC_MAX_OUTPUT_TOKENS_FAST", 900),
    "Smart": ("KALILLAC_MAX_OUTPUT_TOKENS_SMART", 1_800),
    "Deep": ("KALILLAC_MAX_OUTPUT_TOKENS_DEEP", 3_600),
}
INPUT_CHAR_LIMITS = {
    "Fast": ("KALILLAC_MAX_INPUT_CHARS_FAST", 16_000),
    "Smart": ("KALILLAC_MAX_INPUT_CHARS_SMART", 32_000),
    "Deep": ("KALILLAC_MAX_INPUT_CHARS_DEEP", None),
}
CAPABILITY_MODEL_SETTINGS = {
    "fast": "KALILLAC_MODEL_FAST",
    "balanced": "KALILLAC_MODEL_BALANCED",
    "high_reasoning": "KALILLAC_MODEL_HIGH_REASONING",
}


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


def max_total_input_chars(mode: str | None = None) -> int:
    global_limit = bounded_int("KALILLAC_MAX_TOTAL_INPUT_CHARS", 50_000, 100, 100_000)
    if mode is None:
        return global_limit
    setting = INPUT_CHAR_LIMITS.get(mode)
    if setting is None:
        raise ValueError("Unknown input-budget mode")
    name, default = setting
    configured_default = global_limit if default is None else min(global_limit, default)
    mode_limit = bounded_int(name, configured_default, 100, 100_000)
    if mode_limit > global_limit:
        raise ValueError(f"{name} cannot exceed KALILLAC_MAX_TOTAL_INPUT_CHARS")
    return mode_limit


def max_context_messages() -> int:
    return bounded_int("KALILLAC_MAX_CONTEXT_MESSAGES", 40, 1, 40)


def chat_provider_name() -> str:
    provider = os.getenv("KALILLAC_CHAT_PROVIDER", DEFAULT_CHAT_PROVIDER).strip().lower()
    if provider != DEFAULT_CHAT_PROVIDER:
        raise ValueError("KALILLAC_CHAT_PROVIDER is not supported by this development build")
    return provider


def model_for_capability(capability_class: str) -> str:
    setting = CAPABILITY_MODEL_SETTINGS.get(capability_class)
    if setting is None:
        raise ValueError("Unknown model capability class")
    base_model = os.getenv("KALILLAC_MODEL", DEFAULT_CHAT_MODEL).strip()
    configured_model = os.getenv(setting, base_model).strip()
    lowered = configured_model.lower()
    looks_like_credential = (
        lowered.startswith(("sk-", "or-v1-", "bearer "))
        or any(marker in lowered for marker in ("api_key", "api-key", "secret", "token"))
    )
    if not MODEL_ID_PATTERN.fullmatch(configured_model) or looks_like_credential:
        raise ValueError(f"{setting} must be a valid model identifier")
    return configured_model


def output_token_limit(mode: str) -> int:
    setting = OUTPUT_TOKEN_LIMITS.get(mode)
    if setting is None:
        raise ValueError("Unknown response mode")
    name, default = setting
    return bounded_int(name, default, 256, 8_192)


def optional_search_enabled() -> bool:
    raw = os.getenv("KALILLAC_OPTIONAL_SEARCH_ENABLED", "true").strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    raise ValueError("KALILLAC_OPTIONAL_SEARCH_ENABLED must be a boolean value")
