"""Separate standalone safety classifications from customer text.

This is output formatting, not a safety decision: upstream safety handling and
refusals are unchanged. Fenced/indented code and ordinary text are preserved.
"""
from __future__ import annotations

import re

_CLASSIFICATION = re.compile(
    r"^ {0,3}(?:\*\*)?(User Safety|Response Safety)(?:\*\*)?\s*:"
    r"(?:\*\*)?\s*(?:\*\*)?(safe|unsafe)(?:\*\*)?\s*$", re.IGNORECASE
)
_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r?\n)?$")


class CustomerTextNormalizer:
    def __init__(self) -> None:
        self.safety_metadata: dict[str, str] = {}
        self._pending = ""
        self._passing_line = False
        self._fence: tuple[str, int] | None = None

    def _must_hold(self, text: str) -> bool:
        if text.startswith(("    ", "\t")):
            return False
        prefix = text.lstrip(" ")
        if not prefix or prefix.startswith(("`", "~")):
            return True
        if self._fence:
            return False
        compact = re.sub(r"[\s*]", "", prefix).lower()
        return any(label.startswith(compact) or compact.startswith(label)
                   for label in ("usersafety:", "responsesafety:"))

    def _finish_line(self, text: str) -> str:
        fence = _FENCE.match(text)
        if fence:
            run, info = fence.groups()
            if self._fence is None:
                if run[0] != "`" or "`" not in info:
                    self._fence = (run[0], len(run))
            elif run[0] == self._fence[0] and len(run) >= self._fence[1] and not info.strip():
                self._fence = None
            return text
        if self._fence is None:
            classification = _CLASSIFICATION.fullmatch(text.rstrip("\r\n"))
            if classification:
                name, value = classification.groups()
                self.safety_metadata[name.lower().replace(" ", "_")] = value.lower()
                return ""
        return text

    def feed(self, text: str) -> str:
        output: list[str] = []
        # splitlines would treat other Unicode line separators as Markdown
        # newlines. Split only on LF so all ordinary/code bytes stay intact.
        parts = text.split("\n")
        for index, part in enumerate(parts):
            has_newline = index < len(parts) - 1
            piece = part + ("\n" if has_newline else "")
            if self._passing_line:
                output.append(piece)
            else:
                self._pending += piece
                if has_newline:
                    output.append(self._finish_line(self._pending))
                    self._pending = ""
                elif not self._must_hold(self._pending):
                    output.append(self._pending)
                    self._pending = ""
                    self._passing_line = True
            if has_newline:
                self._passing_line = False
        return "".join(output)

    def finish(self) -> str:
        text = self._finish_line(self._pending)
        self._pending = ""
        return text


def normalize_customer_text(text: str) -> tuple[str, dict[str, str]]:
    normalizer = CustomerTextNormalizer()
    visible = normalizer.feed(text) + normalizer.finish()
    return visible, normalizer.safety_metadata
