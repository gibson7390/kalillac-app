"""Bound incoming JSON before parsing. Buffered body exists only for this request."""
from fastapi.responses import JSONResponse
from runtime_config import bounded_int


class RequestBodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path") not in {"/api/chat", "/api/chat/stream"}:
            return await self.app(scope, receive, send)
        limit = bounded_int("KALILLAC_MAX_REQUEST_BODY_BYTES", 600000, 1000, 2000000)
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > limit:
                response = JSONResponse(status_code=413, content={"error": {
                    "code": "invalid-request", "message": "The chat request is too large.",
                }})
                return await response(scope, receive, send)
            if not message.get("more_body", False):
                break
        replayed = False
        async def replay():
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()
        await self.app(scope, replay, send)
