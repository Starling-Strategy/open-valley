import struct

import numpy as np

from schools_assistant.db import _Float4ArrayLoader
from schools_assistant.evidence import EvidenceRegistry
from schools_assistant.index import Passage
from schools_assistant.validation import check_answer, markers, number_tokens, quote, render_markers


def registry() -> EvidenceRegistry:
    reg = EvidenceRegistry()
    reg.add_passage(Passage("p1", "s1", 0, 1, 1, "The board voted 7-2 to adopt a budget of $54,321,000 on 2026-03-11."))
    reg.add_fact("s2", "HUUSD (district), 2025-26, grades K-12: 1578 (reported headcount).")
    return reg


def codes(answer: str, cited: list[str], status: str = "answered", context: tuple[str, ...] = ()) -> set[str]:
    return {f.code for f in check_answer(status=status, answer=answer, cited=cited, registry=registry(),
                                         allowed_context=context)}


def test_accepts_grounded_answer() -> None:
    answer = "The board adopted a $54,321,000 budget by a 7-2 vote on March 11, 2026 [P1]. Enrollment was 1,578 [F1]."
    assert codes(answer, ["P1", "F1"]) == set()


def test_rejects_unregistered_marker() -> None:
    assert "unregistered_marker" in codes("Something [P7].", ["P7"])


def test_rejects_invented_number() -> None:
    assert "unsupported_number" in codes("Enrollment fell by 34 students [F1].", ["F1"])


def test_number_must_be_in_cited_evidence_not_just_any_evidence() -> None:
    assert "unsupported_number" in codes("Enrollment was 1578 [P1].", ["P1"])


def test_rejects_url() -> None:
    assert "url" in codes("See https://huusd.org for more [P1].", ["P1"])
    assert "url" in codes("See huusd.org for more [P1].", ["P1"])


def test_rejects_uncited_answer() -> None:
    assert "uncited_answer" in codes("The board adopted a budget.", [])


def test_not_in_record_may_be_uncited() -> None:
    assert codes("The record does not say when the next meeting is.", [], status="not_in_record") == set()


def test_cited_must_match_markers() -> None:
    assert "cited_mismatch" in codes("Adopted [P1].", ["P1", "F1"])


def test_numbered_markers_rejected() -> None:
    assert "bad_marker" in codes("Adopted [1].", [])


def test_question_numbers_allowed() -> None:
    assert codes("The record has nothing about 2019 [P1].", ["P1"], context=("What happened in 2019?",)) == set()


def test_school_year_forms_and_list_numbers() -> None:
    reg = EvidenceRegistry()
    reg.add_fact("s", "Warren, 2025-26, grades K-6: 164.")
    answer = "Enrollment:\n\n1. In 2025–2026 Warren had 164 students in grades K–6 [F1]."
    assert check_answer(status="answered", answer=answer, cited=["F1"], registry=reg, allowed_context=[]) == []


def test_number_normalization() -> None:
    assert number_tokens("1,578 and 1578.0 and [P12]") == {"1578"}


def test_marker_groups_and_rendering() -> None:
    answer = "A [P2, F1]. B [P1][P2]. C [F1]."
    assert markers(answer) == ["P2", "F1", "P1"]
    text, order = render_markers(answer)
    assert text == "A [1][2]. B [3][1]. C [2]."
    assert order == ["P2", "F1", "P1"]


def test_quote_is_relevant_and_bounded() -> None:
    text = ("Intro sentence about nothing. " * 5 + "The board adopted the budget of $54,321,000. "
            + "Filler words here. " * 40)
    excerpt = quote(text, ["adopted budget 54,321,000"])
    assert "The board adopted the budget of $54,321,000." in excerpt and len(excerpt) <= 454


def test_quote_finds_cited_figure_in_unpunctuated_table_text() -> None:
    # Extracted tables have no sentence punctuation; the cited figure must still be shown.
    text = " ".join(f"School{i} {100 + i} {90 + i} -{i}" for i in range(80)) + " Warren 93 86 -7 " + "Total 1 2 3 " * 30
    excerpt = quote(text, ["Warren had a preliminary count of 86 [P1]"])
    assert "Warren 93 86" in excerpt and len(excerpt) <= 454


def test_quote_joins_snippets_so_every_cited_figure_is_visible() -> None:
    text = ("Births fell from 121 to 104. " + "Unrelated narrative words. " * 60
            + "The 2033-34 projection is 1497 students.")
    excerpt = quote(text, ["births fell from 121 to 104 [P1]", "projected 1497 in 2033-34 [P1]"])
    assert all(figure in excerpt for figure in ("121", "104", "1497")) and "… …" in excerpt
    assert len(excerpt) <= 454


def test_float4_binary_loader() -> None:
    values = np.array([0.5, -1.25, 3.0], dtype=np.float32)
    data = struct.pack(">iiIii", 1, 0, 700, 3, 1) + b"".join(struct.pack(">if", 4, v) for v in values)
    loaded = _Float4ArrayLoader(700).load(data)
    assert loaded.dtype == np.float32 and np.allclose(loaded, values)
