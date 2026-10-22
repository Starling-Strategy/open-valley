"""Deterministic evaluators over the public /v1/ask response."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from pydantic_evals.evaluators import EvaluationReason, Evaluator, EvaluatorContext

from schools_assistant.validation import evidence_tokens, number_tokens

_RENDERED_MARKER = re.compile(r"\[(\d+)\]")


def _question(ctx: EvaluatorContext[Any, dict, Any]) -> str:
    return " ".join(m["content"] for m in ctx.inputs.messages if m["role"] == "user")


@dataclass
class AnswerKindIn(Evaluator[Any, dict, Any]):
    kinds: tuple[str, ...]

    def evaluate(self, ctx: EvaluatorContext[Any, dict, Any]) -> EvaluationReason:
        kind = ctx.output.get("answer_kind")
        return EvaluationReason(kind in self.kinds, f"answer_kind={kind}, expected one of {self.kinds}")


@dataclass
class CitationsConsistent(Evaluator[Any, dict, Any]):
    """Grounded kinds cite something; every [n] marker has a citation; declines cite nothing."""

    def evaluate(self, ctx: EvaluatorContext[Any, dict, Any]) -> EvaluationReason:
        kind = ctx.output.get("answer_kind")
        citations = ctx.output.get("citations") or []
        used = {int(n) for n in _RENDERED_MARKER.findall(ctx.output.get("text", ""))}
        markers = {c["marker"] for c in citations}
        if kind in ("answered", "documents_found") and not citations:
            return EvaluationReason(False, f"{kind} without citations")
        if kind in ("declined", "homes_redirect") and citations:
            return EvaluationReason(False, f"{kind} with citations")
        if used != markers:
            return EvaluationReason(False, f"markers {sorted(used)} != citations {sorted(markers)}")
        return EvaluationReason(True)


@dataclass
class NoUrls(Evaluator[Any, dict, Any]):
    def evaluate(self, ctx: EvaluatorContext[Any, dict, Any]) -> bool:
        return not re.search(r"https?://|\bwww\.", ctx.output.get("text", ""))


@dataclass
class NumbersGrounded(Evaluator[Any, dict, Any]):
    """Every number in a model answer appears in a citation quote or the question.

    Heuristic from the client side: quotes are excerpts, so a failure means "check by hand",
    not necessarily an invented figure. The service's own validator checks full evidence text.
    """

    def evaluate(self, ctx: EvaluatorContext[Any, dict, Any]) -> EvaluationReason:
        if ctx.output.get("answer_kind") != "answered":
            return EvaluationReason(True, "not a generated answer")
        text = _RENDERED_MARKER.sub(" ", ctx.output.get("text", ""))
        citations = ctx.output.get("citations") or []
        evidence = [f"{c.get('quote') or ''} {c.get('title') or ''} {c.get('document_date') or ''}" for c in citations]
        missing = sorted(number_tokens(text) - evidence_tokens([*evidence, _question(ctx)]))
        return EvaluationReason(not missing, f"numbers not in quotes: {missing}" if missing else None)


@dataclass
class MentionsAny(Evaluator[Any, dict, Any]):
    terms: tuple[str, ...]

    def evaluate(self, ctx: EvaluatorContext[Any, dict, Any]) -> bool:
        text = ctx.output.get("text", "").casefold()
        return any(term.casefold() in text for term in self.terms)
