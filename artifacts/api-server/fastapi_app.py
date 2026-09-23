from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from provider import ChatProvider, OpenRouterProvider, ProviderError


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