from __future__ import annotations

import pytest

from product_knowledge import (
    ProductTopic,
    answer_product_question,
    identify_product_question,
    render_product_context,
)


@pytest.mark.parametrize(
    ("question", "topic"),
    [
        ("What are you?", ProductTopic.IDENTITY),
        ("What is Kalillac?", ProductTopic.IDENTITY),
        ("Do you save my chats?", ProductTopic.TEMPORARY_CHATS),
        ("What happens when I save this?", ProductTopic.SAVED_CHATS),
        ("Where are saved chats stored?", ProductTopic.SAVED_CHATS),
        ("Is this end-to-end encrypted?", ProductTopic.ENCRYPTION),
        ("Do you remember me?", ProductTopic.MEMORY),
        ("Do you have persistent personal memory?", ProductTopic.MEMORY),
        ("Can you search the internet?", ProductTopic.SEARCH),
        ("What is Auto mode?", ProductTopic.MODE_AUTO),
        ("What is Fast mode?", ProductTopic.MODE_FAST),
        ("What is Smart mode?", ProductTopic.MODE_SMART),
        ("What is Deep mode?", ProductTopic.MODE_DEEP),
        ("What model answered me?", ProductTopic.MODEL_PROVIDER),
        ("What model is answering this response? Tell me only what Kalillac can verify from the actual runtime.", ProductTopic.MODEL_PROVIDER),
        ("Can you read PDFs?", ProductTopic.ATTACHMENTS),
        ("Do you have voice?", ProductTopic.VOICE),
        ("Do I need an account?", ProductTopic.ACCOUNT),
    ],
)
def test_recognizes_product_self_knowledge_questions(question, topic) -> None:
    assert identify_product_question(question) is topic


def test_searching_the_web_for_information_is_not_misclassified_as_self_knowledge() -> None:
    assert identify_product_question("Search the web for current public information.") is None


def test_registry_has_structured_capabilities_and_data_handling_facts() -> None:
    registry = render_product_context()
    assert registry["identity"]["name"] == "Kalillac AI"
    assert registry["chat"]["default_storage"] == "temporary"
    assert registry["saved_chats"]["storage"] == "local encrypted storage on this device"
    assert registry["data_processing"]["ordinary_chat_end_to_end_encrypted"] is False
    assert registry["data_processing"]["chat_prompt_sent_to_kalillac_backend"] is True
    assert registry["capabilities"]["persistent_memory"] is False
    assert registry["capabilities"]["cloud_sync"] is False
    assert registry["capabilities"]["pdf_ingestion"] is False
    assert registry["capabilities"]["voice"] is False
    assert "nothing leaves your phone" in registry["prohibited_claims"]


def test_false_privacy_and_capability_claims_are_absent_from_product_answers() -> None:
    answers = [
        answer_product_question(
            topic,
            configured_provider="openrouter",
            configured_model="openrouter/free",
        )
        for topic in ProductTopic
    ]
    text = "\n".join(answers).lower()
    false_claims = (
        "nothing leaves your phone",
        "no server ever sees",
        "no third party processes",
        "every conversation is end-to-end encrypted",
        "i never send data to an ai provider",
        "automatically remember previous chats",
        "all your conversations are permanently stored",
        "saved chats automatically sync to the cloud",
    )
    for claim in false_claims:
        assert claim not in text
    assert "ordinary ai chat is not end-to-end encrypted" in text
    assert "stored locally on this device" in text


def test_model_disclosure_does_not_confuse_configured_route_with_exact_model() -> None:
    answer = answer_product_question(
        ProductTopic.MODEL_PROVIDER,
        configured_provider="openrouter",
        configured_model="openrouter/free",
    )
    assert "configured route Openrouter using the configured route openrouter/free" not in answer
    assert "configured route openrouter/free" in answer.lower()
    assert "exact underlying model is not available reliably" in answer
    assert "dynamic route label is not an exact model identity" in answer.lower()


def test_known_returned_model_is_used_for_model_disclosure() -> None:
    answer = answer_product_question(
        ProductTopic.MODEL_PROVIDER,
        configured_provider="openrouter",
        configured_model="openrouter/free",
        returned_model="vendor/actual-model",
    )
    assert "OpenRouter reported the model vendor/actual-model" in answer
    assert "returned runtime metadata" in answer


def test_product_answers_explain_modes_saving_data_and_current_limitations() -> None:
    def answer(topic: ProductTopic) -> str:
        return answer_product_question(
            topic,
            configured_provider="openrouter",
            configured_model="openrouter/free",
        ).lower()

    assert "temporary by default" in answer(ProductTopic.TEMPORARY_CHATS)
    saved = answer(ProductTopic.SAVED_CHATS)
    assert "encrypted saved copy" in saved
    assert "locally on this device" in saved
    assert "update saved copy" in saved
    assert "linked-conversation" in saved
    assert "backend" in answer(ProductTopic.ENCRYPTION)
    assert "search the web" in answer(ProductTopic.SEARCH)
    assert "deterministic request signals" in answer(ProductTopic.MODE_AUTO)
    assert "concise response budget" in answer(ProductTopic.MODE_FAST)
    assert "balanced response budget" in answer(ProductTopic.MODE_SMART)
    assert "bounded response budget" in answer(ProductTopic.MODE_DEEP)
    assert "not currently available" in answer(ProductTopic.ATTACHMENTS)
    assert "not currently available" in answer(ProductTopic.VOICE)
    assert "not currently available" in answer(ProductTopic.IMAGE_GENERATION)
    assert "account is not currently required" in answer(ProductTopic.ACCOUNT)
