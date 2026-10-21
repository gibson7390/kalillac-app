from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import replace
from typing import Annotated, AsyncIterator, Literal

from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from provider import (
    ChatProvider,
    OpenRouterProvider,
    ProviderError,
    normalize_model_id,
)
from product_knowledge import ProductTopic, answer_product_question
from routing import (
    CapabilityClass,
    RoutingDecision,
    SearchPolicy,
    TaskClass,
    decide_routing,
    runtime_response_metadata,
)
from runtime_config import max_context_messages, max_total_input_chars, max_user_input_chars
from search_provider import (
    NormalizedSource,
    SEARCH_UNAVAILABLE_MESSAGE,
    SearchProvider,
    SearchProviderError,
    TavilySearchProvider,
)
from search_routing import PreparedMessages, prepare_messages


MAX_USER_INPUT_CHARS = max_user_input_chars()
MAX_CONTEXT_MESSAGES = max_context_messages()


ChatRole = Literal["user", "assistant"]
ChatMode = Literal["Auto", "Fast", "Smart", "Deep"]


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: ChatRole
    content: str = Field(min_length=1, max_length=MAX_USER_INPUT_CHARS)

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("content must not be blank")
        return value


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_CONTEXT_MESSAGES)
    mode: ChatMode
    request_id: str | None = Field(default=None, max_length=128)

    @field_validator("request_id")
    @classmethod
    def request_id_must_be_opaque(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("request_id must not be blank")
        return value

    @model_validator(mode="after")
    def validate_conversation(self) -> "ChatRequest":
        if self.messages[-1].role != "user":
            raise ValueError("the final message must be from the user")
        routing = decide_routing(
            self.mode,
            [message.model_dump() for message in self.messages],
        )
        total_chars = sum(len(message.content) for message in self.messages)
        if total_chars > min(routing.max_input_chars, max_total_input_chars()):
            raise ValueError("conversation is too large")
        return self


class SourceResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    url: str
    domain: str


class RuntimeMetadataResponse(BaseModel):
    request_id: str
    requested_mode: ChatMode
    effective_mode: ChatMode
    task_class: TaskClass
    capability_class: CapabilityClass
    search_policy: SearchPolicy
    search_used: bool
    provider: str
    configured_model: str | None = None
    returned_model: str | None = None
    model_identity: Literal["verified_returned", "configured_route_only", "unknown", "not_used"]
    response_budget_class: str
    intended_output_token_limit: int
    max_input_chars: int
    reason_codes: list[str]


class ChatResponse(BaseModel):
    role: Literal["assistant"] = "assistant"
    content: str
    request_id: str
    model: str | None = None
    sources: list[SourceResponse] | None = None
    runtime: RuntimeMetadataResponse


class ErrorResponse(BaseModel):
    code: str
    message: str


app = FastAPI(title="Kalillac API", version="2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Request-ID"],
)


def get_provider(request: Request) -> ChatProvider:
    configured_provider = getattr(request.app.state, "provider", None)
    if configured_provider is not None:
        return configured_provider
    return OpenRouterProvider()


def get_search_provider(request: Request) -> SearchProvider:
    configured_provider = getattr(request.app.state, "search_provider", None)
    if configured_provider is not None:
        return configured_provider
    return TavilySearchProvider()


async def prepare_chat_messages(
    payload: ChatRequest,
    search_provider: SearchProvider,
    decision: RoutingDecision | None = None,
) -> PreparedMessages:
    try:
        return await prepare_messages(
            [message.model_dump() for message in payload.messages],
            search_provider,
            decision,
        )
    except SearchProviderError as exc:
        raise ProviderError(
            "current-information-unavailable",
            SEARCH_UNAVAILABLE_MESSAGE,
            status_code=503,
        ) from exc


def public_sources(sources: list[NormalizedSource]) -> list[dict[str, str]]:
    return [source.customer_fields() for source in sources]


@app.exception_handler(RequestValidationError)
async def request_validation_handler(
    _request: Request,
    _exc: RequestValidationError,
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "invalid-request",
                "message": "The chat request is invalid.",
            }
        },
    )


@app.exception_handler(ProviderError)
async def provider_error_handler(_request: Request, exc: ProviderError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message}},
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/healthz")
async def api_health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/chat", response_model=ChatResponse, response_model_exclude_none=True)
async def chat(
    payload: ChatRequest,
    provider: Annotated[ChatProvider, Depends(get_provider)],
    search_provider: Annotated[SearchProvider, Depends(get_search_provider)],
    x_request_id: Annotated[str | None, Header()] = None,
) -> ChatResponse:
    request_id = payload.request_id or x_request_id or uuid.uuid4().hex
    messages = [message.model_dump() for message in payload.messages]
    decision = decide_routing(payload.mode, messages)
    if decision.product_topic is not None and decision.product_topic is not ProductTopic.MODEL_PROVIDER:
        return ChatResponse(
            content=answer_product_question(
                decision.product_topic,
                configured_provider=decision.provider,
                configured_model=decision.configured_model,
            ),
            request_id=request_id,
            runtime=RuntimeMetadataResponse(**runtime_response_metadata(
                decision,
                request_id=request_id,
                returned_model=None,
                search_used=False,
                local_response=True,
            )),
        )

    prepared = await prepare_chat_messages(payload, search_provider, decision)
    decision = replace(decision, search_used=bool(prepared.sources))
    result = await provider.complete(
        prepared.messages,
        decision=decision,
        request_id=request_id,
    )
    content = result.content
    returned_model = normalize_model_id(result.model)
    if decision.product_topic is ProductTopic.MODEL_PROVIDER:
        content = answer_product_question(
            decision.product_topic,
            configured_provider=decision.provider,
            configured_model=decision.configured_model,
            returned_model=returned_model,
        )
    if prepared.sources:
        from citation_validation import validate_citations

        content = validate_citations(content, {source.id for source in prepared.sources})
    return ChatResponse(
        content=content,
        request_id=request_id,
        model=returned_model,
        sources=[SourceResponse(**source) for source in public_sources(prepared.sources)] or None,
        runtime=RuntimeMetadataResponse(**runtime_response_metadata(
            decision,
            request_id=request_id,
            returned_model=returned_model,
            search_used=bool(prepared.sources),
        )),
    )


def encode_stream_event(
    event_type: str,
    *,
    request_id: str,
    text: str | None = None,
    model: str | None = None,
    code: str | None = None,
    message: str | None = None,
    sources: list[dict[str, str]] | None = None,
    runtime: dict[str, object] | None = None,
) -> str:
    payload: dict[str, object] = {"type": event_type, "request_id": request_id}
    if text is not None:
        payload["text"] = text
    if model is not None:
        payload["model"] = model
    if code is not None:
        payload["code"] = code
    if message is not None:
        payload["message"] = message
    if sources is not None:
        payload["sources"] = sources
    if runtime is not None:
        payload["runtime"] = runtime
    return f"event: {event_type}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"


@app.post("/api/chat/stream")
async def chat_stream(
    payload: ChatRequest,
    provider: Annotated[ChatProvider, Depends(get_provider)],
    search_provider: Annotated[SearchProvider, Depends(get_search_provider)],
    x_request_id: Annotated[str | None, Header()] = None,
) -> StreamingResponse:
    request_id = payload.request_id or x_request_id or uuid.uuid4().hex

    async def events() -> AsyncIterator[str]:
        try:
            messages = [message.model_dump() for message in payload.messages]
            decision = decide_routing(payload.mode, messages)
            if decision.product_topic is not None and decision.product_topic is not ProductTopic.MODEL_PROVIDER:
                answer = answer_product_question(
                    decision.product_topic,
                    configured_provider=decision.provider,
                    configured_model=decision.configured_model,
                )
                yield encode_stream_event("delta", request_id=request_id, text=answer)
                yield encode_stream_event(
                    "complete",
                    request_id=request_id,
                    runtime=runtime_response_metadata(
                        decision,
                        request_id=request_id,
                        returned_model=None,
                        search_used=False,
                        local_response=True,
                    ),
                )
                return

            prepared = await prepare_chat_messages(payload, search_provider, decision)
            decision = replace(decision, search_used=bool(prepared.sources))
            source_ids = {source.id for source in prepared.sources}
            citation_validator = None
            if source_ids:
                from citation_validation import StreamingCitationValidator

                citation_validator = StreamingCitationValidator(source_ids)
            completed = False
            async for event in provider.stream(
                prepared.messages,
                decision=decision,
                request_id=request_id,
            ):
                if event.kind == "delta":
                    if decision.product_topic is ProductTopic.MODEL_PROVIDER:
                        # Model self-identification is untrusted. Wait for returned
                        # metadata, then emit an application-owned disclosure.
                        continue
                    text = citation_validator.feed(event.text) if citation_validator else event.text
                    if text:
                        yield encode_stream_event(
                            "delta",
                            request_id=request_id,
                            text=text,
                        )
                elif event.kind == "complete":
                    returned_model = normalize_model_id(event.model)
                    if decision.product_topic is ProductTopic.MODEL_PROVIDER:
                        yield encode_stream_event(
                            "delta",
                            request_id=request_id,
                            text=answer_product_question(
                                decision.product_topic,
                                configured_provider=decision.provider,
                                configured_model=decision.configured_model,
                                returned_model=returned_model,
                            ),
                        )
                    if citation_validator:
                        remaining = citation_validator.finish()
                        if remaining:
                            yield encode_stream_event(
                                "delta",
                                request_id=request_id,
                                text=remaining,
                            )
                    completed = True
                    yield encode_stream_event(
                        "complete",
                        request_id=request_id,
                        model=returned_model,
                        sources=public_sources(prepared.sources) or None,
                        runtime=runtime_response_metadata(
                            decision,
                            request_id=request_id,
                            returned_model=returned_model,
                            search_used=bool(prepared.sources),
                        ),
                    )
                else:
                    raise ProviderError(
                        "provider-invalid-stream",
                        "The AI provider returned an invalid stream.",
                        status_code=502,
                    )

            if not completed:
                raise ProviderError(
                    "provider-stream-incomplete",
                    "The AI provider stream ended unexpectedly.",
                    status_code=502,
                )
        except asyncio.CancelledError:
            raise
        except ProviderError as exc:
            yield encode_stream_event(
                "error",
                request_id=request_id,
                code=exc.code,
                message=exc.message,
            )
        except Exception:
            yield encode_stream_event(
                "error",
                request_id=request_id,
                code="stream-failed",
                message="The Kalillac backend could not complete the response.",
            )

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
