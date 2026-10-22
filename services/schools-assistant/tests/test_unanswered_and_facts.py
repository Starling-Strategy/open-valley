import pytest

from schools_assistant import facts
from schools_assistant.unanswered import redact

from .conftest import make_payload


@pytest.mark.parametrize(("question", "hidden", "kept"), [
    ("Email jane.doe@example.com about Warren", ["jane.doe@example.com"], ["Warren"]),
    ("Call me at (802) 555-1234 or 802.555.9876", ["555-1234", "555.9876"], ["Call me"]),
    ("Is the student named Riley Park enrolled?", ["Riley", "Park"], ["student named"]),
    ("What did Mr. Thompson say about the budget?", ["Thompson"], ["budget"]),
    ("Did Sarah Connor speak at the HUUSD Board meeting?", ["Sarah", "Connor"], ["HUUSD Board"]),
    ("Will Fayston Elementary close in March?", [], ["Fayston Elementary", "March"]),
    ("When does Alex start at Harwood?", ["Alex"], ["Harwood"]),
])
def test_redaction(question: str, hidden: list[str], kept: list[str]) -> None:
    result = redact(question)
    for item in hidden:
        assert item not in result
    for item in kept:
        assert item in result


def test_redaction_bounds_length() -> None:
    assert len(redact("a" * 2000)) == 500


def test_school_matching_by_alias_town_and_name() -> None:
    payload = make_payload()
    assert [s["school_id"] for s in facts.match_schools(payload, "Warren Elementary")] == ["warren"]
    assert [s["school_id"] for s in facts.match_schools(payload, "fayston")] == ["fayston"]
    assert len(facts.match_schools(payload, None)) == 3


def test_enrollment_defaults_to_district_and_copies_values() -> None:
    rows = facts.enrollment_facts(make_payload(), None, None, None)
    assert all(f.source_id == "enroll-2025" for f in rows)
    assert any("1578" in f.text for f in rows) and not any("164" in f.text for f in rows)
    assert rows[0].text.startswith("Series attending-october definition")


def test_enrollment_year_filter() -> None:
    rows = facts.enrollment_facts(make_payload(), "HUUSD", "2025", "2025-26")
    assert any("2025-26" in f.text for f in rows) and not any("2024-25, grades" in f.text for f in rows)


def test_projection_facts_are_labelled_projections() -> None:
    rows = facts.projection_facts(make_payload())
    assert "not observed counts" in rows[0].text and "1581" in rows[1].text and "1591" in rows[1].text
