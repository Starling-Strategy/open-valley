"""Run the eval dataset against a live service.

    uv run python -m evals.run --url http://127.0.0.1:8787
    uv run python -m evals.run --url http://127.0.0.1:8787 --judge-model anthropic/claude-sonnet-5.5

The judge is opt-in and uses OPENROUTER_API_KEY (or OPENROUTER_API_KEY_FILE).
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys

import httpx
from pydantic_evals.evaluators import LLMJudge

from .dataset import DATASET, AskInputs


def _judge_model(model_name: str):
    from pydantic_ai.models.openrouter import OpenRouterModel
    from pydantic_ai.providers.openrouter import OpenRouterProvider

    from schools_assistant.config import Settings

    key = Settings().openrouter_key
    if not key:
        raise SystemExit("--judge-model needs OPENROUTER_API_KEY or OPENROUTER_API_KEY_FILE")
    return OpenRouterModel(model_name, provider=OpenRouterProvider(api_key=key))


async def evaluate(client: httpx.AsyncClient, dataset=DATASET, *, concurrency: int = 1):
    async def ask(inputs: AskInputs) -> dict:
        for _ in range(5):
            response = await client.post("/v1/ask", json={"messages": inputs.messages})
            if response.status_code != 429:
                break
            await asyncio.sleep(int(response.headers.get("retry-after", "10")))
        response.raise_for_status()
        return response.json()

    return await dataset.evaluate(ask, max_concurrency=concurrency, progress=False)


def failed_cases(report) -> list[str]:
    failed = [c.name for c in report.cases if not all(a.value for a in c.assertions.values())]
    return failed + [f.name for f in report.failures]


async def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", required=True, help="Service base URL, e.g. http://127.0.0.1:8787")
    parser.add_argument("--judge-model", help="OpenRouter model for rubric judging (optional)")
    parser.add_argument("--concurrency", type=int, default=1, help="Concurrent requests (keep under the rate limit)")
    parser.add_argument("--case", action="append", help="Run only the named case(s)")
    args = parser.parse_args(argv)
    os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

    dataset = DATASET
    if args.case:
        dataset = type(DATASET)(name=DATASET.name, cases=[c for c in DATASET.cases if c.name in args.case])
    if args.judge_model:
        model = _judge_model(args.judge_model)
        for case in dataset.cases:
            if case.metadata and case.metadata.rubric:
                case.evaluators = [*case.evaluators, LLMJudge(rubric=case.metadata.rubric, model=model,
                                                              include_input=True)]

    async with httpx.AsyncClient(base_url=args.url.rstrip("/"), timeout=90) as client:
        report = await evaluate(client, dataset, concurrency=args.concurrency)
    report.print(include_input=False, include_output=False, include_durations=True, include_reasons=True)
    failed = failed_cases(report)
    if failed:
        print(f"{len(failed)} case(s) with failing assertions: {', '.join(failed)}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
