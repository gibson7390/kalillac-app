from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Any

from runtime_config import DYNAMIC_MODEL_ROUTES

class ProductTopic(str, Enum):
    IDENTITY = "identity"
    TEMPORARY_CHATS = "temporary-chats"
    SAVED_CHATS = "saved-chats"
    ENCRYPTION = "encryption"
    MEMORY = "memory"
    SEARCH = "search"
    MODE_AUTO = "mode-auto"
    MODE_FAST = "mode-fast"
    MODE_SMART = "mode-smart"
    MODE_DEEP = "mode-deep"
    MODEL_PROVIDER = "model-provider"
    ACCOUNT = "account"
    ATTACHMENTS = "attachments"
    VOICE = "voice"
    IMAGE_GENERATION = "image-generation"
    CLOUD_SYNC = "cloud-sync"


@dataclass(frozen=True)
class ProductCapabilities:
    web_search: bool = True
    citations: bool = True
    local_encrypted_saved: bool = True
    persistent_memory: bool = False
    cloud_sync: bool = False
    attachments: bool = False
    pdf_ingestion: bool = False
    voice: bool = False
    image_generation: bool = False
    account_required: bool = False

    def as_dict(self) -> dict[str, bool]:
        return {
            "web_search": self.web_search,
            "citations": self.citations,
            "local_encrypted_saved": self.local_encrypted_saved,
            "persistent_memory": self.persistent_memory,
            "cloud_sync": self.cloud_sync,
            "attachments": self.attachments,
            "pdf_ingestion": self.pdf_ingestion,
            "voice": self.voice,
            "image_generation": self.image_generation,
            "account_required": self.account_required,
        }


PRODUCT_CAPABILITIES = ProductCapabilities()

# This registry is application-owned and structured so facts can be updated
# without editing provider instructions or relying on the model's prior knowledge.
PRODUCT_REGISTRY: dict[str, Any] = {
    "identity": {
        "name": "Kalillac AI",
        "description": "A general-purpose AI assistant with a privacy-first design.",
    },
    "chat": {
        "default_storage": "temporary",
        "account_required": False,
        "temporary_chats_become_history_automatically": False,
        "later_turns_update_saved_copy_automatically": False,
    },
    "saved_chats": {
        "requires_explicit_save": True,
        "update_requires_explicit_action": True,
        "storage": "local encrypted storage on this device",
        "encryption": "AES-256-GCM for saved copies on device",
        "deletion": "follows current linked-conversation semantics",
    },
    "data_processing": {
        "chat_prompt_sent_to_kalillac_backend": True,
        "backend_sends_text_to_configured_ai_provider": True,
        "ordinary_chat_end_to_end_encrypted": False,
        "saved_copy_encrypted_locally": True,
    },
    "capabilities": PRODUCT_CAPABILITIES.as_dict(),
    "limitations": [
        "no persistent personal memory across unrelated conversations",
        "no cloud synchronization",
        "no production-ready file or PDF ingestion",
        "no voice",
        "no image generation",
    ],
    "prohibited_claims": [
        "nothing leaves your phone",
        "no server ever sees your messages",
        "no third party processes your prompts",
        "every conversation is end-to-end encrypted",
        "I never send data to an AI provider",
        "I automatically remember previous chats",
        "all your conversations are permanently stored",
        "saved chats automatically sync to the cloud",
        "Kalillac can read production PDF attachments",
        "Kalillac currently offers voice or image generation",
    ],
}


_PATTERNS: tuple[tuple[ProductTopic, re.Pattern[str]], ...] = (
    (ProductTopic.ENCRYPTION, re.compile(
        r"\b(?:is this|are my chats|are conversations|does kalillac|do you|how are saved copies)\b"
        r".{0,70}\b(?:end[ -]to[ -]end|e2ee|encrypt(?:ed|ion)?|privacy)\b|"
        r"\b(?:end[ -]to[ -]end encrypted|e2ee)\b",
        re.I,
    )),
    (ProductTopic.MEMORY, re.compile(
        r"\b(?:do you remember|do you have (?:(?:persistent|personal) )*(?:a )?memory|remember me|"
        r"memory across (?:chats|conversations)|persistent personal memory|"
        r"learn from (?:my|our) chats)\b",
        re.I,
    )),
    (ProductTopic.MODE_AUTO, re.compile(r"\bauto mode\b|\bwhat is auto\b", re.I)),
    (ProductTopic.MODE_FAST, re.compile(r"\bfast mode\b|\bwhat is fast\b", re.I)),
    (ProductTopic.MODE_SMART, re.compile(r"\bsmart mode\b|\bwhat is smart\b", re.I)),
    (ProductTopic.MODE_DEEP, re.compile(r"\bdeep mode\b|\bwhat is deep\b", re.I)),
    (ProductTopic.MODEL_PROVIDER, re.compile(
        r"\b(?:what|which) model (?:answered|are you using|powers you)\b|"
        r"\b(?:what|which) model (?:is )?(?:answering|responding to) (?:this|my|your) (?:response|reply)\b|"
        r"\bmodel (?:answered|powers) (?:me|this|your response)\b|"
        r"\bwho powers (?:this|your) response\b|\b(?:are you|do you use) (?:openai|openrouter)\b|"
        r"\bwhat ai provider (?:do you use|is configured)\b|\bai provider for kalillac\b",
        re.I,
    )),
    (ProductTopic.SEARCH, re.compile(
        r"\b(?:can you|do you|does kalillac|can kalillac)\b.{0,50}\b(?:search|browse|internet|web)\b|"
        r"\bhow does (?:your|kalillac's) (?:web )?search work\b",
        re.I,
    )),
    (ProductTopic.ACCOUNT, re.compile(
        r"\b(?:do i need|is an account required|does kalillac require|"
        r"do i have to create)\b.{0,45}\b(?:account|sign up|register)\b|"
        r"\bkalillac account\b",
        re.I,
    )),
    (ProductTopic.ATTACHMENTS, re.compile(
        r"\b(?:can you|can kalillac|does kalillac|do you)\b.{0,60}\b"
        r"(?:attachments?|files?|pdfs?|read pdf)\b|\bproduction.ready pdf\b",
        re.I,
    )),
    (ProductTopic.VOICE, re.compile(
        r"\b(?:do you|does kalillac|can kalillac|is there)\b.{0,50}\b(?:voice|speech|audio)\b",
        re.I,
    )),
    (ProductTopic.IMAGE_GENERATION, re.compile(
        r"\b(?:do you|does kalillac|can kalillac)\b.{0,50}\b(?:image generation|generate images|make images)\b",
        re.I,
    )),
    (ProductTopic.CLOUD_SYNC, re.compile(
        r"\b(?:do saved chats|do you|does kalillac)\b.{0,60}\b"
        r"(?:cloud sync|sync across devices|cross[ -]device)\b|"
        r"\bsaved chats? (?:sync|synchronize)\b",
        re.I,
    )),
    (ProductTopic.SAVED_CHATS, re.compile(
        r"\b(?:save (?:this|my|our) (?:chat|conversation)|save this|"
        r"what happens when i save|saved chats?|saved copy|update saved copy|"
        r"delete saved|where (?:are|do) saved chats?)\b",
        re.I,
    )),
    (ProductTopic.TEMPORARY_CHATS, re.compile(
        r"\b(?:temporary chats?|chat history|save my chats|do you save my chats)\b",
        re.I,
    )),
    (ProductTopic.IDENTITY, re.compile(
        r"\b(?:what are you|who are you|what is kalillac|what's kalillac|"
        r"tell me about kalillac|what does kalillac do)\b",
        re.I,
    )),
)


def identify_product_question(query: str) -> ProductTopic | None:
    """Return a stable product topic without sending the question to web search."""
    for topic, pattern in _PATTERNS:
        if pattern.search(query):
            return topic
    return None


def answer_product_question(
    topic: ProductTopic,
    *,
    configured_provider: str,
    configured_model: str,
    returned_model: str | None = None,
) -> str:
    provider_label = "OpenRouter" if configured_provider == "openrouter" else configured_provider
    if topic is ProductTopic.IDENTITY:
        return (
            "Kalillac AI is a general-purpose AI assistant designed with privacy in mind. "
            "Ordinary chat is temporary by default; an explicit Save creates an encrypted copy stored on this device."
        )
    if topic is ProductTopic.TEMPORARY_CHATS:
        return (
            "Chats are temporary by default and do not automatically become permanent history. "
            "You do not need a Kalillac account for normal chat. Saving a copy is an explicit action."
        )
    if topic is ProductTopic.SAVED_CHATS:
        return (
            "Choose Save to create an encrypted Saved copy stored locally on this device. "
            "Later turns remain temporary unless you explicitly choose Update Saved Copy. "
            "Deleting a saved copy follows the current linked-conversation behavior."
        )
    if topic is ProductTopic.ENCRYPTION:
        return (
            "Saved copies are encrypted locally on this device. Ordinary AI chat is not end-to-end encrypted: "
            "the prompt is sent to the Kalillac backend, which sends the text needed to answer to its configured AI provider."
        )
    if topic is ProductTopic.MEMORY:
        return (
            "Kalillac does not currently have persistent personal memory across unrelated conversations or automatic remembering. "
            "Chats are temporary by default; Save creates a local encrypted copy but does not enable cross-chat memory."
        )
    if topic is ProductTopic.SEARCH:
        return (
            "Kalillac can search the web when current information is needed, and searched answers may include citations and sources. "
            "Search is handled through the Kalillac backend. Product questions like this are answered without web search."
        )
    if topic is ProductTopic.MODE_AUTO:
        return (
            "Auto uses deterministic request signals to choose a response policy: simple questions use a concise policy, "
            "ordinary writing or explanations use a balanced policy, and complex work can use the bounded Deep policy. "
            "Current-information requests can trigger web search."
        )
    if topic is ProductTopic.MODE_FAST:
        return (
            "Fast favors a concise response budget and avoids unnecessary elaboration. "
            "It still searches when you explicitly request a search or current information is required."
        )
    if topic is ProductTopic.MODE_SMART:
        return (
            "Smart uses a balanced response budget and reasoning policy. It searches when current or external verification "
            "materially improves the answer."
        )
    if topic is ProductTopic.MODE_DEEP:
        return (
            "Deep uses a larger but bounded response budget and allows more context for difficult reasoning, research, or coding. "
            "It does not mean unlimited output or a guaranteed different underlying model."
        )
    if topic is ProductTopic.MODEL_PROVIDER:
        if returned_model and returned_model.casefold() not in DYNAMIC_MODEL_ROUTES:
            return (
                f"You are chatting with Kalillac AI. For the provider request for this response, {provider_label} reported the model {returned_model}. "
                "That identification comes from returned runtime metadata, not the model's self-description. "
                "It does not establish which model generated an earlier reply."
            )
        return (
            f"You are chatting with Kalillac AI. Kalillac routes ordinary AI-generated chat through {provider_label} using the configured route "
            f"{configured_model}. The exact underlying model is not available reliably for this response. "
            "A dynamic route label is not an exact model identity, and I cannot identify a prior reply's model "
            "without verified metadata for that reply."
        )
    if topic is ProductTopic.ACCOUNT:
        return "A Kalillac account is not currently required for normal chat. Saved copies stay encrypted on this device; cloud sync is not available."
    if topic is ProductTopic.ATTACHMENTS:
        return "Production-ready attachment and PDF ingestion are not currently available. Do not send files expecting Kalillac to read them."
    if topic is ProductTopic.VOICE:
        return "Voice input and voice output are not currently available in Kalillac."
    if topic is ProductTopic.IMAGE_GENERATION:
        return "Image generation is not currently available in Kalillac."
    if topic is ProductTopic.CLOUD_SYNC:
        return "Saved chats are stored locally on this device. Cloud sync and cross-device saved-chat access are not currently available."
    raise ValueError("Unsupported product knowledge topic")


def render_product_context() -> dict[str, Any]:
    """Return a fresh JSON-safe copy for provider system context."""
    return {
        **PRODUCT_REGISTRY,
        "capabilities": dict(PRODUCT_REGISTRY["capabilities"]),
        "limitations": list(PRODUCT_REGISTRY["limitations"]),
    }
