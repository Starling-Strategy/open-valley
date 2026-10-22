"""Structured facts from the publication payload. Values are copied, never computed."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

DISTRICT_ID = "huusd"
_GENERIC = {"school", "schools", "primary", "middle", "elementary", "high", "learning", "center", "the", "and"}


@dataclass(frozen=True)
class Fact:
    source_id: str
    text: str


def entity_names(payload: dict[str, Any]) -> dict[str, str]:
    names = {DISTRICT_ID: "HUUSD (district)"}
    names.update({s["school_id"]: s["name"] for s in payload.get("schools", [])})
    return names


def match_schools(payload: dict[str, Any], query: str | None) -> list[dict[str, Any]]:
    """Schools named by `query` (name, ID, alias, campus or town). Empty query means all schools."""
    schools = payload.get("schools", [])
    if not query or not query.strip():
        return list(schools)
    q = query.casefold().strip()
    campuses = {c["campus_id"]: c for c in payload.get("campuses", [])}
    words = {w for w in re.findall(r"[a-z0-9]+", q) if w not in _GENERIC and len(w) >= 3}
    matched = []
    for school in schools:
        campus = campuses.get(school.get("campus_id"), {})
        labels = [school["name"], school["school_id"], *school.get("aliases", []),
                  campus.get("name", ""), campus.get("physical_town", "")]
        folded = [label.casefold() for label in labels if label]
        if any(label == q or (len(label) > 3 and label in q) or (len(q) > 3 and q in label) for label in folded):
            matched.append(school)
            continue
        label_words = {w for label in folded for w in re.findall(r"[a-z0-9]+", label)} - _GENERIC
        if words & label_words:
            matched.append(school)
    return matched


def _value(row: dict[str, Any]) -> str:
    if row.get("value_state") == "observed" and row.get("value") is not None:
        return str(row["value"])
    return str(row.get("value_state", "missing")).replace("_", " ")


def enrollment_fact(row: dict[str, Any], names: dict[str, str]) -> Fact:
    date = row.get("reference_date") if row.get("reference_date_status") == "known" else None
    text = (
        f"{names.get(row['entity_id'], row['entity_id'])}, {row['school_year']}, grades {row['grade_scope']}: "
        f"{_value(row)} ({row['count_basis'].replace('_', ' ')}; status {row['status']}; "
        f"population basis {row['population_basis']}; count date {date or 'not stated'}; "
        f"series {row['series_id']})."
    )
    if row.get("notes"):
        text += f" Notes: {row['notes']}"
    return Fact(row["source_id"], text)


def _year(value: str | None) -> int | None:
    match = re.match(r"\s*(\d{4})", value or "")
    return int(match.group(1)) if match else None


def _in_years(row: dict[str, Any], from_year: str | None, to_year: str | None) -> bool:
    year = _year(row.get("school_year"))
    low, high = _year(from_year), _year(to_year)
    if year is None:
        return low is None and high is None
    return (low is None or year >= low) and (high is None or year <= high)


def _resolve(payload: dict[str, Any], ref: dict[str, Any] | None) -> dict[str, Any] | None:
    if not ref:
        return None
    for row in payload.get("enrollment", []):
        if all(row.get(k) == ref.get(k) for k in ("series_id", "entity_id", "school_year", "grade_scope")):
            return row
    return None


def school_facts(payload: dict[str, Any], school: str | None) -> list[Fact]:
    names = entity_names(payload)
    campuses = {c["campus_id"]: c for c in payload.get("campuses", [])}
    schools = match_schools(payload, school)
    facts: list[Fact] = []
    for item in schools:
        name = item["name"]
        primary = (item.get("sources") or [{}])[0].get("source_id")
        for config in item.get("grade_configurations", []):
            facts.append(Fact(config["source_id"], f"{name} serves grades {config['grade_scope']} in "
                                                   f"{config['school_year']} (checked {config['verified_at']})."))
        campus = campuses.get(item.get("campus_id"))
        if campus and campus.get("sources"):
            text = f"{name} campus: {campus['name']}, {campus['address']} (town: {campus['physical_town']})."
            shared = [s["name"] for s in payload.get("schools", [])
                      if s["campus_id"] == item["campus_id"] and s["school_id"] != item["school_id"]]
            if shared:
                text += f" It shares that campus with {', '.join(shared)}."
            if campus.get("notes"):
                text += f" {campus['notes']}"
            facts.append(Fact(campus["sources"][0]["source_id"], text))
        if primary:
            nexts = [names.get(i, i) for i in item.get("usual_next_school_ids", [])]
            text = f"{name}" + (f" (also known as {', '.join(item['aliases'])})" if item.get("aliases") else "")
            text += f": usual next school {', '.join(nexts)}." if nexts else ": no usual next school is listed."
            if item.get("pathway_note"):
                text += f" {item['pathway_note']}"
            facts.append(Fact(primary, text))
        for ref in (item.get("latest_attending_enrollment_ref"), item.get("current_enrollment_ref")):
            row = _resolve(payload, ref)
            if row:
                facts.append(enrollment_fact(row, names))
        for program in payload.get("programs", []):
            if program.get("school_id") != item["school_id"] or not program.get("sources"):
                continue
            text = (f"{program['name']} ({name}): grade scope {program.get('grade_scope') or 'not stated'}, "
                    f"{program['school_year']}; enrollment {str(program.get('value_state')).replace('_', ' ')}.")
            if program.get("notes"):
                text += f" {program['notes']}"
            facts.append(Fact(program["sources"][0]["source_id"], text))
    return facts


def enrollment_facts(payload: dict[str, Any], entity: str | None, from_year: str | None,
                     to_year: str | None, *, limit: int = 60) -> list[Fact]:
    names = entity_names(payload)
    if entity and entity.strip() and not re.search(r"huusd|district|harwood unified", entity, re.I):
        entities = {s["school_id"] for s in match_schools(payload, entity)}
    else:
        entities = {DISTRICT_ID}
    series = {(s["series_id"], s["entity_id"], s["grade_scope"]): s for s in payload.get("series", [])
              if s.get("kind") == "history"}
    facts: list[Fact] = []
    described: set[tuple[str, str]] = set()
    rows = [r for r in payload.get("enrollment", [])
            if r["entity_id"] in entities and _in_years(r, from_year, to_year)]
    rows.sort(key=lambda r: (r["entity_id"], r["series_id"], r["grade_scope"], r["school_year"]))
    for row in rows:
        group = series.get((row["series_id"], row["entity_id"], row["grade_scope"]))
        key = (row["series_id"], row.get("population_basis", ""))
        if group and key not in described:
            described.add(key)
            facts.append(Fact(row["source_id"], f"Series {row['series_id']} definition: {group['description']}"))
        facts.append(enrollment_fact(row, names))
    return facts[-limit:] if len(facts) > limit else facts


def projection_facts(payload: dict[str, Any], entity: str | None = None, *, limit: int = 40) -> list[Fact]:
    names = entity_names(payload)
    entities = ({s["school_id"] for s in match_schools(payload, entity)}
                if entity and not re.search(r"huusd|district", entity, re.I) else {DISTRICT_ID})
    facts: list[Fact] = []
    described: set[str] = set()
    rows = sorted((r for r in payload.get("projections", []) if r["entity_id"] in entities),
                  key=lambda r: (r["series_id"], r["grade_scope"], r["school_year"]))
    for row in rows:
        if row["series_id"] not in described:
            described.add(row["series_id"])
            facts.append(Fact(row["source_id"], (
                f"Forecast {row['series_id']} by {row['author']}: forecast vintage {row['forecast_vintage']}, "
                f"base year {row['base_year']}, horizon {row['horizon']}. These are projections, not observed "
                f"counts. Assumptions: {row['assumptions']}")))
        text = (f"Projection for {names.get(row['entity_id'], row['entity_id'])}, {row['school_year']}, grades "
                f"{row['grade_scope']}: {_value(row)} (projected headcount; series {row['series_id']}; "
                f"population basis {row['population_basis']}).")
        if row.get("notes"):
            text += f" Notes: {row['notes']}"
        facts.append(Fact(row["source_id"], text))
    return facts[:limit]
