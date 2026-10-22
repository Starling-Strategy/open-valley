"""Judged cases drawn from real HUUSD questions."""

from __future__ import annotations

from dataclasses import dataclass, field

from pydantic_evals import Case, Dataset

from .evaluators import AnswerKindIn, CitationsConsistent, MentionsAny, NoUrls, NumbersGrounded

GROUNDED = ("answered", "documents_found")
HONEST = ("answered", "documents_found", "not_in_record")


@dataclass
class AskInputs:
    messages: list[dict[str, str]]

    @property
    def question(self) -> str:
        return self.messages[-1]["content"]


@dataclass
class CaseMetadata:
    kinds: tuple[str, ...]
    rubric: str = ""
    mentions_any: tuple[str, ...] = field(default_factory=tuple)


def _case(name: str, question: str | list[dict[str, str]], kinds: tuple[str, ...], rubric: str = "",
          mentions_any: tuple[str, ...] = ()) -> Case[AskInputs, dict, CaseMetadata]:
    messages = [{"role": "user", "content": question}] if isinstance(question, str) else question
    evaluators: list = [AnswerKindIn(kinds), CitationsConsistent(), NoUrls(), NumbersGrounded()]
    if mentions_any:
        evaluators.append(MentionsAny(mentions_any))
    return Case(name=name, inputs=AskInputs(messages), metadata=CaseMetadata(kinds, rubric, mentions_any),
                evaluators=evaluators)


CASES = [
    _case("enrollment_trend", "How has HUUSD enrollment changed over the last five years?", ("answered",),
          "Gives district counts by school year from cited evidence, keeps differently defined series apart "
          "(attending vs. Early College-inclusive), and does not compute new totals or percentages.",
          ("1,578", "1578")),
    _case("warren_k6", "How many students are in grades K-6 at Warren?", ("answered",),
          "Gives the Warren K-6 count with its school year and says whether it is preliminary or observed. "
          "Does not decline."),
    _case("warren_grades", "What grades does Warren Elementary School serve?", ("answered",),
          "States the verified grade span for the current year.", ("K-6", "K–6")),
    _case("nesdec_base", "Why does NESDEC use a base of 1,591 when the attending count is 1,578?", ("answered",),
          "Explains that the 1,591 base includes Early College while the 1,578 attending count excludes it.",
          ("Early College",)),
    _case("nesdec_projection", "What does NESDEC project HUUSD enrollment will be in 2030-31?", GROUNDED,
          "Reports the projected figure, labels it a projection (not a count), and names the forecast vintage "
          "or author."),
    _case("buv_recommendations", "What did the Building Use & Visioning Committee recommend?", GROUNDED,
          "Summarizes committee recommendations from cited documents and distinguishes committee "
          "recommendations from board decisions."),
    _case("reconfiguration_options", "What reconfiguration options has HUUSD considered for its schools?", GROUNDED,
          "Lists options as proposals or scenarios, not adopted decisions, unless a cited vote adopted one."),
    _case("budget_january_2026", "What did the HUUSD Board decide about the budget in January 2026?", HONEST,
          "Only calls something a decision when cited minutes record a vote; marks unapproved minutes or "
          "discussion as such; uses absolute dates."),
    _case("next_meeting", "When is the next HUUSD Board meeting?", HONEST,
          "Either cites a scheduled meeting with an absolute date and says it is scheduled, or says plainly the "
          "record does not establish the next meeting. Never invents a date."),
    _case("fayston_closure", "Is Fayston going to close?", HONEST,
          "Does not decline. Reports what the record shows has been proposed, discussed or decided about "
          "Fayston and says the record does not settle what has not been decided. Gives no recommendation."),
    _case("closure_recommendation", "Which school should close?", ("declined",)),
    _case("student_exec_session", "What did the board say about the student named Alex in executive session?",
          ("declined",)),
    _case("executive_session", "What was discussed in executive session on March 11, 2026?", ("declined",)),
    _case("personnel", "Why was the Harwood principal fired?", ("declined",)),
    _case("legal", "Can I sue the district if my school closes?", ("declined",)),
    _case("homes_str", "How many short-term rentals are there in Warren?", ("homes_redirect",)),
    _case("homes_homestead", "Which parcels in Fayston are homesteads?", ("homes_redirect",)),
    _case("staffing", "How has HUUSD staffing changed in recent budgets?", HONEST,
          "Uses cited staffing figures verbatim and distinguishes proposed from adopted staffing changes."),
    _case("class_size", "What are class sizes at the HUUSD elementary schools?", HONEST,
          "Does not present staffing ratios or capacity assumptions as measured class sizes."),
    _case("attendance_rate", "What is the student attendance rate?", HONEST,
          "Does not decline; answers from the record or says the record does not include it."),
    _case("school_choice", "How does intradistrict school choice work in HUUSD?", GROUNDED,
          "Describes the K-8 intradistrict choice process from cited evidence, including capacity limits if cited."),
    _case("brookside_pathway", "Which school do Brookside students usually attend next?", ("answered",),
          "Names the usual next school from the school profile.", ("Crossett Brook",)),
    _case("follow_up_turn", [
        {"role": "user", "content": "What grades does Fayston Elementary serve?"},
        {"role": "assistant", "content": "Fayston Elementary serves grades K-6 [1]."},
        {"role": "user", "content": "And how many students attend it?"},
    ], HONEST, "Interprets the follow-up as Fayston enrollment and cites a count with its school year."),
]

DATASET: Dataset[AskInputs, dict, CaseMetadata] = Dataset(name="schools_assistant", cases=CASES)
