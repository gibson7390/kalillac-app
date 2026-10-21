from __future__ import annotations

import re


_CITATION = re.compile(r"source-(\d{1,3})", re.IGNORECASE)


class StreamingCitationValidator:
    """Validates citation tokens as chunks arrive while preserving Markdown code."""

    def __init__(self, source_ids: set[str]) -> None:
        self._source_ids = source_ids
        self._pending_token: str | None = None
        self._discard_until_close = False
        self._pending_marker: str | None = None
        self._marker_count = 0
        self._line_prefix_spaces = 0
        self._at_line_prefix = True
        self._fence_marker: str | None = None
        self._fence_length = 0
        self._inline_ticks = 0

    def feed(self, text: str) -> str:
        output: list[str] = []
        index = 0
        while index < len(text):
            char = text[index]
            if self._pending_token is not None:
                self._pending_token += char
                if char == "]":
                    output.append(self._validated_token(self._pending_token))
                    self._pending_token = None
                elif len(self._pending_token) >= 128:
                    if self._pending_token[1:].lower().startswith("source"):
                        self._pending_token = None
                        self._discard_until_close = True
                    else:
                        output.append(self._pending_token)
                        self._pending_token = None
                        self._discard_until_close = False
                index += 1
                continue

            if self._discard_until_close:
                if char == "]":
                    self._discard_until_close = False
                index += 1
                continue

            if self._pending_marker is not None:
                if char == self._pending_marker:
                    self._marker_count += 1
                    index += 1
                    continue
                output.append(self._resolve_marker())
                continue

            if char == "`" or (
                char == "~" and (self._fence_marker == "~" or self._at_line_prefix)
            ):
                self._pending_marker = char
                self._marker_count = 1
                index += 1
                continue

            in_code = self._fence_marker is not None or self._inline_ticks > 0
            if char == "[" and not in_code:
                self._pending_token = "["
                self._at_line_prefix = False
                index += 1
                continue

            output.append(char)
            self._advance_line_prefix(char)
            index += 1

        return "".join(output)

    def finish(self) -> str:
        output: list[str] = []
        if self._pending_marker is not None:
            output.append(self._resolve_marker())
        if self._discard_until_close:
            self._discard_until_close = False
        if self._pending_token is not None:
            token = self._pending_token
            if not token[1:].lower().startswith("source"):
                output.append(token)
            self._pending_token = None
        return "".join(output)

    def _validated_token(self, token: str) -> str:
        inner = token[1:-1]
        match = _CITATION.fullmatch(inner)
        if match:
            source_id = f"source-{int(match.group(1))}"
            if source_id in self._source_ids:
                return f"[{int(match.group(1))}]"
            return ""
        if inner.lower().startswith("source"):
            return ""
        return token

    def _resolve_marker(self) -> str:
        marker = self._pending_marker or "`"
        count = self._marker_count
        self._pending_marker = None
        self._marker_count = 0
        allowed_prefix = self._at_line_prefix
        if self._fence_marker is not None:
            if marker == self._fence_marker and allowed_prefix and count >= self._fence_length:
                self._fence_marker = None
                self._fence_length = 0
            return marker * count
        if marker == "~":
            if allowed_prefix and count >= 3:
                self._fence_marker = marker
                self._fence_length = count
            return marker * count
        if allowed_prefix and count >= 3:
            self._fence_marker = marker
            self._fence_length = count
            return marker * count
        if self._inline_ticks == 0:
            self._inline_ticks = count
        elif self._inline_ticks == count:
            self._inline_ticks = 0
        self._at_line_prefix = False
        return marker * count

    def _advance_line_prefix(self, char: str) -> None:
        if char == "\n":
            self._line_prefix_spaces = 0
            self._at_line_prefix = True
        elif self._at_line_prefix and char == " " and self._line_prefix_spaces < 3:
            self._line_prefix_spaces += 1
        elif self._at_line_prefix and char == "\t" and self._line_prefix_spaces < 3:
            self._line_prefix_spaces += 1
        else:
            self._at_line_prefix = False


def validate_citations(text: str, source_ids: set[str]) -> str:
    validator = StreamingCitationValidator(source_ids)
    return validator.feed(text) + validator.finish()
