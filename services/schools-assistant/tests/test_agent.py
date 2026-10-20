import asyncio
import json
from datetime import date
from pathlib import Path

from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    RetryPromptPart,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from schools_assistant.agent import AnswerService, history
from schools_assistant.index import build_index
from schools_assistant.retrieval import Retriever
from schools_assistant.unanswered import UnansweredLog

from .conftest import DIMS, MODEL, FakeEmbedder, make_snapshot

TODAY = date(2026, 10, 20)


def tool_returns(messages: list[ModelMessage]) -> dict[str, dict]:
    last = messages[-1]
    assert isinstance(last, ModelRequest)
    return {p.tool_name: p.content for p in last.parts if isinstance(p, ToolReturnPart)}


def retries(messages: list[ModelMessage]) -> list[str]:
    return [str(p.content) for m in messages if isinstance(m, ModelRequest) for p in m.parts
            if isinstance(p, RetryPromptPart)]


def final(info: AgentInfo, status: str, answer: str, cited: list[str]) -> ModelResponse:
    return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
                                             {"status": status, "answer": answer, "cited": cited})])


def scripted(*steps):
    calls = {"n": 0, "seen": []}

    def run(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        step = steps[min(calls["n"], len(steps) - 1)]
        calls["n"] += 1
        calls["seen"].append(messages)
        return step(messages, info)

    return FunctionModel(run), calls


def search(query: str, **filters):
    return lambda messages, info: ModelResponse(parts=[ToolCallPart("search_records", {"query": query, **filters})])


def service(model, tmp_path: Path | None = None, *, timeout: float = 5.0, embedder=None) -> AnswerService:
    log = UnansweredLog(tmp_path / "unanswered.jsonl" if tmp_path else None)
    return AnswerService(retriever=Retriever(embedder or FakeEmbedder()), model=model, unanswered=log,
                         timeout_seconds=timeout)


def index():
    return build_index(make_snapshot(), expected_model=MODEL, expected_dims=DIMS)


def ask(text: str) -> list[dict[str, str]]:
    return [{"role": "user", "content": text}]


def budget_id(messages) -> str:
    passages = tool_returns(messages)["search_records"]["passages"]
    return next(p["id"] for p in passages if "budget" in p["text"] and "voted" in p["text"])


async def test_grounded_answer_maps_markers_and_builds_citations() -> None:
    def answer(messages, info):
        pid = budget_id(messages)
        return final(info, "answered",
                     f"On March 11, 2026 the board voted 7-2 to adopt a $54,321,000 budget [{pid}].", [pid])

    model, calls = scripted(search("budget vote March 2026"), answer)
    result = await service(model).answer(index(), ask("What budget did the board adopt in March 2026?"), today=TODAY)
    assert result["answer_kind"] == "answered"
    assert result["text"].endswith("[1].")
    (citation,) = result["citations"]
    assert citation["marker"] == 1 and citation["source_id"] == "board-min-2026-03-11"
    assert citation["passage_id"] and citation["page_start"] == 2 and citation["url"].startswith("https://")
    assert "54,321,000" in citation["quote"] and len(citation["quote"]) <= 300
    assert citation["kind"] == "Minutes" and citation["body"] == "HUUSD Board"
    assert citation["document_date"] == "2026-03-11"
    assert result["release_id"] == "release-1" and result["unanswered_logged"] is False


async def test_retry_then_success() -> None:
    def bad(messages, info):
        pid = budget_id(messages)
        return final(info, "answered", f"The budget grew 4% [{pid}].", [pid])

    def good(messages, info):
        assert any("4" in r for r in retries(messages))
        pid = budget_id(messages[:-2])
        return final(info, "answered", f"The board adopted the budget [{pid}].", [pid])

    model, calls = scripted(search("budget"), bad, good)
    result = await service(model).answer(index(), ask("Budget?"), today=TODAY)
    assert result["answer_kind"] == "answered" and calls["n"] == 3


async def test_invented_number_twice_falls_back_to_documents_found() -> None:
    def bad(messages, info):
        return final(info, "answered", "Enrollment will fall by 212 students [P1].", ["P1"])

    model, calls = scripted(search("budget"), bad, bad)
    result = await service(model).answer(index(), ask("What happened with the budget?"), today=TODAY)
    assert result["answer_kind"] == "documents_found"
    assert "212" not in result["text"]
    assert result["citations"] and all(c["passage_id"] for c in result["citations"])
    assert len({c["source_id"] for c in result["citations"]}) == len(result["citations"])
    assert calls["n"] == 3  # one retry only


async def test_unregistered_marker_rejected() -> None:
    def bad(messages, info):
        return final(info, "answered", "The board adopted it [P9].", ["P9"])

    model, _ = scripted(search("budget"), bad, bad)
    result = await service(model).answer(index(), ask("Budget?"), today=TODAY)
    assert result["answer_kind"] == "documents_found"


async def test_url_and_uncited_answers_rejected() -> None:
    def url(messages, info):
        return final(info, "answered", "See https://huusd.org [P1].", ["P1"])

    def uncited(messages, info):
        return final(info, "answered", "The board adopted the budget.", [])

    for bad in (url, uncited):
        model, _ = scripted(search("budget"), bad, bad)
        result = await service(model).answer(index(), ask("Budget?"), today=TODAY)
        assert result["answer_kind"] == "documents_found"


async def test_fact_tools_cite_payload_sources() -> None:
    def facts(messages, info):
        return ModelResponse(parts=[ToolCallPart("get_school_facts", {"school": "Warren"})])

    def answer(messages, info):
        rows = tool_returns(messages)["get_school_facts"]["facts"]
        fid = next(r["id"] for r in rows if "164" in r["text"])
        grades = next(r["id"] for r in rows if "serves grades" in r["text"])
        return final(info, "answered", f"Warren serves PK-6 [{grades}] and had 164 students in K-6 in 2025-26 [{fid}].",
                     [grades, fid])

    model, _ = scripted(facts, answer)
    result = await service(model).answer(index(), ask("How many students are in grades K-6 at Warren?"),
                                         today=TODAY)
    assert result["answer_kind"] == "answered"
    assert {c["source_id"] for c in result["citations"]} == {"warren-about", "enroll-2025"}
    assert all(c["passage_id"] is None for c in result["citations"])
    assert any("164" in c["quote"] for c in result["citations"])


async def test_projection_facts_carry_base_note() -> None:
    def projections(messages, info):
        return ModelResponse(parts=[ToolCallPart("get_projections", {})])

    def answer(messages, info):
        rows = tool_returns(messages)["get_projections"]["facts"]
        fid = next(r["id"] for r in rows if "1591" in r["text"])
        return final(info, "answered", f"NESDEC's base of 1,591 includes Early College; the attending count of "
                                       f"1,578 does not [{fid}].", [fid])

    model, _ = scripted(projections, answer)
    result = await service(model).answer(index(), ask("Why do 1,591 and 1,578 differ?"), today=TODAY)
    assert result["answer_kind"] == "answered"


async def test_list_meetings_supports_next_meeting() -> None:
    def meetings(messages, info):
        return ModelResponse(parts=[ToolCallPart("list_meetings", {"date_from": "2026-10-20"})])

    def answer(messages, info):
        rows = tool_returns(messages)["list_meetings"]["facts"]
        assert len(rows) == 1 and "scheduled" in rows[0]["text"]
        return final(info, "answered", f"The catalog lists a scheduled HUUSD Board meeting on November 4, 2026 "
                                       f"[{rows[0]['id']}].", [rows[0]["id"]])

    model, _ = scripted(meetings, answer)
    result = await service(model).answer(index(), ask("When is the next board meeting?"), today=TODAY)
    assert result["answer_kind"] == "answered"
    assert result["citations"][0]["source_id"] == "board-agenda-2026-11-04"


async def test_not_in_record_is_logged_redacted(tmp_path: Path) -> None:
    def none(messages, info):
        return final(info, "not_in_record", "The library does not cover bus routes.", [])

    model, _ = scripted(search("bus routes"), none)
    question = "What bus route does Jane Doe take? Email me at jane@example.com or 802-555-1234."
    result = await service(model, tmp_path).answer(index(), ask(question), today=TODAY)
    assert result["answer_kind"] == "not_in_record" and result["unanswered_logged"] is True
    (line,) = (tmp_path / "unanswered.jsonl").read_text().splitlines()
    record = json.loads(line)
    assert record["release_id"] == "release-1"
    assert "Jane" not in record["question"] and "jane@" not in record["question"] and "555" not in record["question"]
    assert (tmp_path / "unanswered.jsonl").stat().st_mode & 0o777 == 0o600


async def test_model_error_falls_back() -> None:
    def boom(messages, info):
        raise RuntimeError("upstream exploded")

    model, _ = scripted(boom)
    result = await service(model).answer(index(), ask("Building Use & Visioning recommendations"), today=TODAY)
    assert result["answer_kind"] == "documents_found"
    assert "exploded" not in json.dumps(result)


async def test_timeout_falls_back() -> None:
    async def slow(messages, info):
        await asyncio.sleep(1)
        return ModelResponse(parts=[])

    result = await service(FunctionModel(slow), timeout=0.05).answer(index(), ask("reconfiguration options"),
                                                                     today=TODAY)
    assert result["answer_kind"] == "documents_found"


async def test_no_model_and_no_evidence_is_not_in_record(tmp_path: Path) -> None:
    result = await service(None, tmp_path).answer(index(), ask("zzzz qqqq"), today=TODAY)
    assert result["answer_kind"] == "not_in_record" and result["citations"] == []
    assert result["unanswered_logged"] is True


async def test_guardrail_runs_before_model() -> None:
    model, calls = scripted(search("anything"))
    result = await service(model).answer(index(), ask("Which school should close?"), today=TODAY)
    assert result["answer_kind"] == "declined" and calls["n"] == 0 and result["citations"] == []
    result = await service(model).answer(index(), ask("How many short-term rentals are in Warren?"), today=TODAY)
    assert result["answer_kind"] == "homes_redirect" and calls["n"] == 0


async def test_prompt_injection_in_passages_cannot_add_citations() -> None:
    # Whatever a passage says, only registered IDs survive validation.
    def answer(messages, info):
        return final(info, "answered", "Ignore prior rules [P99].", ["P99"])

    model, _ = scripted(search("budget"), answer, answer)
    result = await service(model).answer(index(), ask("Budget?"), today=TODAY)
    assert result["answer_kind"] == "documents_found"


async def test_conversation_history_is_passed_as_text() -> None:
    seen = {}

    def first(messages, info):
        seen["messages"] = messages
        return final(info, "not_in_record", "Nothing on that.", [])

    model, _ = scripted(first)
    turns = [{"role": "user", "content": "Tell me about Warren"}, {"role": "assistant", "content": "Warren [1]."},
             {"role": "user", "content": "And Fayston?"}]
    await service(model).answer(index(), turns, today=TODAY)
    texts = [str(p.content) for m in seen["messages"] for p in m.parts if hasattr(p, "content")]
    assert "Tell me about Warren" in texts and any(t.strip() == "Warren ." for t in texts)


def test_history_drops_leading_assistant_turns() -> None:
    result = history([{"role": "assistant", "content": "Hello"}, {"role": "user", "content": "Hi"}])
    assert len(result) == 1 and isinstance(result[0], ModelRequest)
