from __future__ import annotations

from citation_validation import StreamingCitationValidator, validate_citations


def test_valid_single_and_multiple_ids_are_mapped_to_the_source_list_order() -> None:
    assert validate_citations(
        "One claim [source-1], another [source-2].",
        {"source-1", "source-2"},
    ) == "One claim [1], another [2]."


def test_unknown_and_malformed_ids_are_removed_without_fabricating_sources() -> None:
    assert validate_citations(
        "Known [source-1], unknown [source-9], malformed [source-nope], ordinary [example].",
        {"source-1"},
    ) == "Known [1], unknown , malformed , ordinary [example]."


def test_citations_split_across_stream_chunks_match_complete_validation() -> None:
    validator = StreamingCitationValidator({"source-1", "source-2"})
    chunks = ["A [sou", "rce-1] and [source-", "2]. Bad [source-99]"]
    streamed = "".join(validator.feed(chunk) for chunk in chunks) + validator.finish()
    assert streamed == "A [1] and [2]. Bad "
    assert streamed == validate_citations("".join(chunks), {"source-1", "source-2"})


def test_citation_like_text_in_inline_and_fenced_code_is_preserved() -> None:
    answer = (
        "Use `[source-9]` as a literal.\n"
        "```text\n[source-8]\n```\n"
        "~~~~python\n[source-7]\n~~~~\n"
        "Actual citation [source-1]."
    )
    expected = (
        "Use `[source-9]` as a literal.\n"
        "```text\n[source-8]\n```\n"
        "~~~~python\n[source-7]\n~~~~\n"
        "Actual citation [1]."
    )
    assert validate_citations(answer, {"source-1"}) == expected


def test_incomplete_unknown_citation_is_removed_but_unrelated_bracket_is_preserved() -> None:
    validator = StreamingCitationValidator({"source-1"})
    output = validator.feed("Visible [source-404")
    assert output == "Visible "
    assert validator.finish() == ""
    assert validate_citations("Literal [placeholder", set()) == "Literal [placeholder"


def test_extremely_long_source_number_is_rejected_without_integer_conversion() -> None:
    assert validate_citations(f"Bad [source-{'9' * 5000}].", {"source-1"}) == "Bad ."
