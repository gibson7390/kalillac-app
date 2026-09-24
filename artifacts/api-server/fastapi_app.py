from __future__ import annotations

import asyncio
import json
import uuid
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
)


ChatRole = Literal["user", "assistant"]
ChatMode = Literal["Auto", "Fast", "Smart", "Deep"]


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: ChatRole
    content: str = Field(min_length=1, max_length=12_000)

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("content must not be blank")
        return value


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: list[ChatMessage] = Field(min_length=1, max_length=40)
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
        total_chars = sum(len(message.content) for message in self.messages)
        if total_chars > 50_000:
            raise ValueError("conversation is too large")
        return self


class ChatResponse(BaseModel):
    role: Literal["assistant"] = "assistant"
    content: str
    request_id: str
    model: str | None = None


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


@app.post("/api/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    provider: Annotated[ChatProvider, Depends(get_provider)],
    x_request_id: Annotated[str | None, Header()] = None,
) -> ChatResponse:
    request_id = payload.request_id or x_request_id or uuid.uuid4().hex
    result = await provider.complete(
        [message.model_dump() for message in payload.messages],
        mode=payload.mode,
        request_id=request_id,
    )
    return ChatResponse(
        content=result.content,
        request_id=request_id,
        model=result.model,
    )


def encode_stream_event(
    event_type: str,
    *,
    request_id: str,
    text: str | None = None,
    model: str | None = None,
    code: str | None = None,
    message: str | None = None,
) -> str:
    payload: dict[str, str] = {"type": event_type, "request_id": request_id}
    if text is not None:
        payload["text"] = text
    if model is not None:
        payload["model"] = model
    if code is not None:
        payload["code"] = code
    if message is not None:
        payload["message"] = message
    return f"event: {event_type}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"


@app.post("/api/chat/stream")
async def chat_stream(
    payload: ChatRequest,
    provider: Annotated[ChatProvider, Depends(get_provider)],
    x_request_id: Annotated[str | None, Header()] = None,
) -> StreamingResponse:
    request_id = payload.request_id or x_request_id or uuid.uuid4().hex

    async def events() -> AsyncIterator[str]:
        try:
            completed = False
            async for event in provider.stream(
                [message.model_dump() for message in payload.messages],
                mode=payload.mode,
                request_id=request_id,
            ):
                if event.kind == "delta":
                    if event.text:
                        yield encode_stream_event(
                            "delta",
                            request_id=request_id,
                            text=event.text,
                        )
                elif event.kind == "complete":
                    completed = True
                    yield encode_stream_event(
                        "complete",
                        request_id=request_id,
                        model=event.model,
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
