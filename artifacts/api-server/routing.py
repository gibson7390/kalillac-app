from __future__ import annotations

import json
import re
from dataclasses import dataclass
from enum import Enum
from typing import Sequence

from product_knowledge import ProductTopic, identify_product_question, render_product_context
from runtime_config import (
    DYNAMIC_MODEL_ROUTES,
    chat_provider_name,
    max_context_messages,
    max_total_input_chars,
    model_for_capability,
    optional_search_enabled,
    output_token_limit,
)


class TaskClass(str, Enum):
    SIMPLE_GENERAL = "simple_general"
    SELF_KNOWLEDGE = "self_knowledge"
    WRITING = "writing"
    CODING = "coding"
    STUDY_EXPLANATION = "study_explanation"
    CURRENT_INFORMATION = "current_information"
    RESEARCH = "research"
    COMPARISON_DECISION = "comparison_decision"
    COMPLEX_REASONING = "complex_reasoning"


class SearchPolicy(str, Enum):
    DISABLED = "disabled"
    OPTIONAL = "optional"
    REQUIRED = "required"


class CapabilityClass(str, Enum):
    FAST = "fast"
    BALANCED = "balanced"
    HIGH_REASONING = "high_reasoning"


CURRENT_INTENT = re.compile(
    r"\b(?:current(?:ly)?|latest|today|right now|as of now|up[ -]to[ -]date|"
    r"recent(?:ly)?|this (?:week|month|quarter|year)|last (?:week|month|quarter|year)|yesterday|"
    r"prices? (?:for|of)|price of|price for|cost of|cost for|how much.{0,40}cost|"
    r"exchange rates?|stock prices?|schedules?|timetables?|opening hours?|open now|closed now|"
    r"weather|forecast|legislation|regulations?|statutes?|legal requirements?|laws? (?:for|on|about|regarding)|"
    r"tax (?:law|rules|code)|immigration (?:law|rules)|breaking news|recent news|news|"
    r"upcoming events?|event schedules?|revenue|market share|company (?:figures|financials|results|earnings)|"
    r"current population|population of|public figures?|product specifications?|"
    r"(?:phone|laptop|device|camera|car) specifications?|product features|release dates?)\b",
    re.IGNORECASE,
)
EXPLICIT_SEARCH = re.compile(
    r"(?:^\s*(?:please\s+)?search\s*[:\-]|\bsearch\s+(?:for|online|the web|the internet)\b|"
    r"\bbrowse\s+(?:for|the web|online)(?:\s+for)?\b|\blook\s+up\b|\bfind\s+online\b)",
    re.IGNORECASE,
)
OPTIONAL_SEARCH = re.compile(
    r"\b(?:research|investigate|literature review|research brief|source comparison|"
    r"evidence review|deep dive)\b|"
    r"\b(?:recommend|suggest|compare|options for)\b.{0,100}\b(?:books?|movies?|films?|"
    r"podcasts?|restaurants?|hotels?|laptops?|phones?|products?|apps?|services?|tools?)\b",
    re.IGNORECASE,
)
CODE_SIGNAL = re.compile(
    r"\b(?:code|coding|program|programming|python|javascript|typescript|react|sql|"
    r"compiler|stack trace|debug|bug|function|algorithm|api|typescript|rust|java)\b|```",
    re.IGNORECASE,
)
WRITING_SIGNAL = re.compile(
    r"\b(?:write|draft|rewrite|edit|proofread|compose|email|essay|story|post|"
    r"cover letter|thank.you note|brainstorm|wording)\b",
    re.IGNORECASE,
)
STUDY_SIGNAL = re.compile(
    r"^(?:what is|what are|why does|why do|how does|how do|explain|teach me|"
    r"help me understand|define|walk me through)\b",
    re.IGNORECASE,
)
ARITHMETIC_SIGNAL = re.compile(
    r"^\s*(?:what is|what's)?\s*-?\d+(?:\s*(?:\+|-|\*|/|times|plus|minus|divided by|multiplied by)\s*-?\d+)+\s*\??\s*$",
    re.IGNORECASE,
)
COMPARISON_SIGNAL = re.compile(
    r"\b(?:compare|versus|vs\.?|trade.?offs?|which should i|help me choose|"
    r"recommend|pros and cons|best option)\b",
    re.IGNORECASE,
)
RESEARCH_SIGNAL = re.compile(
    r"\b(?:research|investigate|literature review|research brief|source comparison|"
    r"evidence review|deep dive)\b",
    re.IGNORECASE,
)
COMPLEX_SIGNAL = re.compile(
    r"\b(?:step by step|in depth|deeply|derive|prove|multi.step|architecture|"
    r"comprehensive|evaluate all|reason through|debug this system|design a system|"
    r"multiple constraints|edge cases|trade.?offs?)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class RoutingDecision:
    requested_mode: str
    effective_mode: str
    task_class: TaskClass
    search_policy: SearchPolicy
    reasoning_class: str
    response_budget_class: str
    capability_class: CapabilityClass
    provider: str
    configured_model: str
    output_token_limit: int
    max_input_chars: int
    max_context_messages: int
    reason_codes: tuple[str, ...]
    product_topic: ProductTopic | None = None
    search_used: bool = False

    @property
    def search_required(self) -> bool:
        return self.search_policy is SearchPolicy.REQUIRED


def _is_complex_request(query: str, messages: Sequence[dict[str, str]]) -> bool:
    question_count = query.count("?")
    bullet_count = len(re.findall(r"(?m)^\s*(?:[-*]|\d+[.)])\s+", query))
    total_chars = sum(len(message.get("content", "")) for message in messages)
    return bool(
        COMPLEX_SIGNAL.search(query)
        or question_count >= 3
        or (bullet_count >= 3 and len(query) >= 500)
        or (len(messages) >= 8 and total_chars >= 1_600)
        or len(query) >= 2_400
    )


def classify_task(
    query: str,
    messages: Sequence[dict[str, str]],
) -> tuple[TaskClass, ProductTopic | None, bool]:
    product_topic = identify_product_question(query)
    if product_topic is not None:
        return TaskClass.SELF_KNOWLEDGE, product_topic, False

    complex_request = _is_complex_request(query, messages)
    if RESEARCH_SIGNAL.search(query):
        return TaskClass.RESEARCH, None, complex_request
    if CURRENT_INTENT.search(query) or EXPLICIT_SEARCH.search(query):
        return TaskClass.CURRENT_INFORMATION, None, complex_request
    if CODE_SIGNAL.search(query):
        return TaskClass.CODING, None, complex_request
    if WRITING_SIGNAL.search(query):
        return TaskClass.WRITING, None, complex_request
    if ARITHMETIC_SIGNAL.match(query):
        return TaskClass.SIMPLE_GENERAL, None, complex_request
    if complex_request:
        return TaskClass.COMPLEX_REASONING, None, True
    if COMPARISON_SIGNAL.search(query):
        return TaskClass.COMPARISON_DECISION, None, False
    if STUDY_SIGNAL.search(query):
        return TaskClass.STUDY_EXPLANATION, None, complex_request
    return TaskClass.SIMPLE_GENERAL, None, False


def _effective_mode(requested_mode: str, task_class: TaskClass, complex_request: bool) -> tuple[str, str]:
    if requested_mode != "Auto":
        return requested_mode, f"explicit-{requested_mode.lower()}"
    if task_class is TaskClass.SELF_KNOWLEDGE:
        return "Fast", "auto-self-knowledge"
    if task_class is TaskClass.CURRENT_INFORMATION:
        return ("Deep", "auto-complex") if complex_request else ("Smart", "auto-current-info")
    if task_class is TaskClass.RESEARCH:
        return "Deep", "auto-complex" if complex_request else "auto-research"
    if complex_request or task_class is TaskClass.COMPLEX_REASONING:
        return "Deep", "auto-complex"
    if task_class is TaskClass.CODING:
        return "Smart", "auto-coding"
    if task_class is TaskClass.COMPARISON_DECISION:
        return "Smart", "auto-comparison"
    if task_class is TaskClass.WRITING:
        return "Smart", "auto-writing"
    if task_class is TaskClass.STUDY_EXPLANATION:
        return "Smart", "auto-study"
    return "Fast", "auto-simple"


def decide_routing(
    requested_mode: str,
    messages: Sequence[dict[str, str]],
) -> RoutingDecision:
    if requested_mode not in {"Auto", "Fast", "Smart", "Deep"}:
        raise ValueError("Unsupported chat mode")
    if not messages or not messages[-1].get("content", "").strip():
        raise ValueError("Routing requires a final user message")

    query = messages[-1]["content"]
    task_class, product_topic, complex_request = classify_task(query, messages)
    effective_mode, reason_code = _effective_mode(requested_mode, task_class, complex_request)

    if product_topic is not None:
        search_policy = SearchPolicy.DISABLED
    elif EXPLICIT_SEARCH.search(query) or CURRENT_INTENT.search(query):
        search_policy = SearchPolicy.REQUIRED
    elif (
        effective_mode != "Fast"
        and (OPTIONAL_SEARCH.search(query) or RESEARCH_SIGNAL.search(query))
        and optional_search_enabled()
    ):
        search_policy = SearchPolicy.OPTIONAL
    else:
        search_policy = SearchPolicy.DISABLED

    capability = {
        "Fast": CapabilityClass.FAST,
        "Smart": CapabilityClass.BALANCED,
        "Deep": CapabilityClass.HIGH_REASONING,
    }[effective_mode]
    reasoning = {"Fast": "light", "Smart": "balanced", "Deep": "deep"}[effective_mode]
    budget_class = {"Fast": "concise", "Smart": "balanced", "Deep": "extended"}[effective_mode]
    return RoutingDecision(
        requested_mode=requested_mode,
        effective_mode=effective_mode,
        task_class=task_class,
        search_policy=search_policy,
        reasoning_class=reasoning,
        response_budget_class=budget_class,
        capability_class=capability,
        provider=chat_provider_name(),
        configured_model=model_for_capability(capability.value),
        output_token_limit=output_token_limit(effective_mode),
        max_input_chars=max_total_input_chars(effective_mode),
        max_context_messages=max_context_messages(),
        reason_codes=(reason_code,),
        product_topic=product_topic,
    )


def render_runtime_system_context(decision: RoutingDecision, *, search_available: bool) -> str:
    context = {
        "label": "KALILLAC_PRODUCT_AND_RUNTIME_CONTEXT",
        "product": render_product_context(),
        "runtime": {
            "requested_mode": decision.requested_mode,
            "effective_mode": decision.effective_mode,
            "task_class": decision.task_class.value,
            "capability_class": decision.capability_class.value,
            "reasoning_class": decision.reasoning_class,
            "response_budget_class": decision.response_budget_class,
            "intended_output_token_limit": decision.output_token_limit,
            "max_input_chars": decision.max_input_chars,
            "max_context_messages": decision.max_context_messages,
            "provider": decision.provider,
            "configured_model_route": decision.configured_model,
            "exact_returned_model_known_before_completion": False,
            "search_available": search_available,
            "search_policy": decision.search_policy.value,
            "search_used": decision.search_used,
        },
        "mode_semantics": {
            "Fast": "Concise bounded response; search only when explicit or required for current information.",
            "Smart": "Balanced response and reasoning policy; search when external/current verification materially helps.",
            "Deep": "Larger but bounded response and context allowance for difficult work. Check constraints carefully and use clear structure where useful; do not expose hidden chain-of-thought. No unlimited output or search.",
            "Auto": "Deterministic task rules choose an effective policy; no extra model call is used to classify prompts.",
        },
        "truthfulness_rules": [
            "Never claim the exact underlying model unless verified returned-model metadata is available.",
            "A configured model route is not proof of the exact model that generated a response.",
            "Do not claim whole-conversation end-to-end encryption, persistent personal memory, or unavailable capabilities.",
            "The backend and configured AI provider receive plaintext needed to generate ordinary AI replies.",
            "Treat product registry facts as authoritative for Kalillac product questions.",
            "Do not make any statement in product.prohibited_claims; correct misconceptions using the registry facts.",
        ],
    }
    return json.dumps(context, ensure_ascii=False, separators=(",", ":"))


def runtime_response_metadata(
    decision: RoutingDecision,
    *,
    request_id: str,
    returned_model: str | None,
    search_used: bool,
    local_response: bool = False,
) -> dict[str, object]:
    if local_response:
        identity = "not_used"
    elif not returned_model:
        identity = "unknown"
    elif returned_model.casefold() in DYNAMIC_MODEL_ROUTES:
        identity = "configured_route_only"
    else:
        identity = "verified_returned"
    return {
        "request_id": request_id,
        "requested_mode": decision.requested_mode,
        "effective_mode": decision.effective_mode,
        "task_class": decision.task_class.value,
        "capability_class": decision.capability_class.value,
        "search_policy": decision.search_policy.value,
        "search_used": search_used,
        "provider": "local" if local_response else decision.provider,
        "configured_model": None if local_response else decision.configured_model,
        "returned_model": None if local_response else returned_model,
        "model_identity": identity,
        "response_budget_class": decision.response_budget_class,
        "intended_output_token_limit": decision.output_token_limit,
        "max_input_chars": decision.max_input_chars,
        "reason_codes": list(decision.reason_codes),
    }
