"""Synthetic publication, fake store and fake embedder. No test touches the network."""

from __future__ import annotations

import copy
import hashlib
import re
from dataclasses import dataclass, field

import numpy as np
import pytest

from schools_assistant.db import PassageRow, Snapshot
from schools_assistant.retrieval import EmbeddingError

MODEL = "baai/bge-m3"
DIMS = 1024


def hashed_vector(text: str) -> np.ndarray:
    vector = np.zeros(DIMS, dtype=np.float32)
    for token in re.findall(r"[a-z0-9]+", text.lower()):
        digest = hashlib.sha256(token.encode()).digest()
        vector[int.from_bytes(digest[:4], "big") % DIMS] += 1.0
    norm = np.linalg.norm(vector)
    return vector / norm if norm else vector


class FakeEmbedder:
    def __init__(self, model: str = MODEL, *, fail: bool = False) -> None:
        self.model = model
        self.fail = fail
        self.calls = 0

    async def embed(self, text: str) -> np.ndarray:
        self.calls += 1
        if self.fail:
            raise EmbeddingError("simulated")
        return hashed_vector(text)


def library(category, body, kind, date, meetings=(), collections=("meetings",)):
    return {"category": category, "body": body, "kind": kind,
            "school_year": "2025-26" if date and date >= "2025-07-01" else "2024-25", "document_date": date,
            "meetings": [{"date": d, "body": b, "status": s} for d, b, s in meetings],
            "collections": list(collections) if meetings else ["core"]}


def source(source_id, title, *, lib=None, locators=(), published_at=None):
    item = {"source_id": source_id, "title": title, "url": f"https://example.org/{source_id}",
            "published_at": published_at, "reviewed_at": "2026-10-04", "locators": list(locators)}
    if lib:
        item["library"] = lib
    return item


def make_payload() -> dict:
    sources = [
        source("warren-about", "Warren School — About", lib=library("Schools", "HUUSD", "Reference", None)),
        source("fayston-about", "Fayston Elementary — About", lib=library("Schools", "HUUSD", "Reference", None)),
        source("huusd-about", "HUUSD — About the district", lib=library("Schools", "HUUSD", "Reference", None)),
        source("enroll-2025", "October 2025 enrollment report",
               lib=library("Enrollment", "HUUSD", "Report", "2025-11-12")),
        source("nesdec-2026", "NESDEC enrollment projections, January 2026",
               lib=library("Enrollment", "HUUSD", "Report", "2026-01-09")),
        source("board-min-2026-03-11", "HUUSD Board minutes, March 11, 2026",
               lib=library("Meetings", "HUUSD Board", "Minutes", "2026-03-11",
                           meetings=[("2026-03-11", "HUUSD Board", "held")])),
        source("board-agenda-2026-11-04", "HUUSD Board agenda, November 4, 2026",
               lib=library("Meetings", "HUUSD Board", "Agenda", "2026-10-30",
                           meetings=[("2026-11-04", "HUUSD Board", "scheduled")])),
        source("buv-report", "Building Use & Visioning Committee final report",
               lib=library("Facilities", "Building Use & Visioning Committee", "Report", "2026-02-20",
                           collections=("building_use_visioning",))),
        source("finance-min-2026-01", "Finance Committee minutes, January 2026",
               lib=library("Meetings", "Finance Committee", "Minutes", "2026-01-15",
                           meetings=[("2026-01-15", "Finance Committee", "held")])),
        source("bare-source", "Untitled supporting document"),
    ]
    schools = [
        {"school_id": "warren", "name": "Warren School", "campus_id": "warren-campus", "directory_school_id": "warren",
         "state_school_id": "PS1", "aliases": ["Warren Elementary"],
         "grade_configurations": [{"school_year": "2026-27", "grade_scope": "PK-6", "verified_at": "2026-10-04",
                                   "source_id": "warren-about", "source_locator": "About"}],
         "usual_next_school_ids": ["harwood-middle"], "pathway_note": "Usual next school is Harwood Union Middle.",
         "sources": [{"source_id": "warren-about", "source_locator": "About"}],
         "latest_attending_enrollment_ref": {"series_id": "attending-october", "entity_id": "warren",
                                             "school_year": "2025-26", "grade_scope": "K-6"},
         "current_enrollment_ref": None},
        {"school_id": "fayston", "name": "Fayston Elementary School", "campus_id": "fayston-campus",
         "directory_school_id": "fayston", "state_school_id": "PS2", "aliases": [],
         "grade_configurations": [{"school_year": "2026-27", "grade_scope": "K-6", "verified_at": "2026-10-04",
                                   "source_id": "fayston-about", "source_locator": "About"}],
         "usual_next_school_ids": [], "pathway_note": "", "sources": [
             {"source_id": "fayston-about", "source_locator": "About"}],
         "latest_attending_enrollment_ref": None, "current_enrollment_ref": None},
        {"school_id": "harwood-middle", "name": "Harwood Union Middle School", "campus_id": "harwood-campus",
         "directory_school_id": "harwood", "state_school_id": "PS3", "aliases": [], "grade_configurations": [],
         "usual_next_school_ids": [], "pathway_note": "", "sources": [
             {"source_id": "huusd-about", "source_locator": "Structure"}],
         "latest_attending_enrollment_ref": None, "current_enrollment_ref": None},
    ]
    campuses = [
        {"campus_id": "warren-campus", "name": "Warren School", "address": "42 School Road", "physical_town": "Warren",
         "latitude": 44.1, "longitude": -72.8, "state_school_id": "PS1",
         "sources": [{"source_id": "warren-about", "source_locator": "Contact"}], "notes": ""},
        {"campus_id": "fayston-campus", "name": "Fayston Elementary", "address": "1 German Flats Road",
         "physical_town": "Fayston", "latitude": 44.2, "longitude": -72.9, "state_school_id": "PS2",
         "sources": [{"source_id": "fayston-about", "source_locator": "Contact"}], "notes": ""},
    ]
    enrollment = [
        {"series_id": "attending-october", "entity_id": "huusd", "school_year": "2024-25", "grade_scope": "K-12",
         "reference_date": "2024-10-01", "reference_date_status": "known",
         "population_basis": "attending_excludes_early_college", "count_basis": "reported_headcount",
         "value": 1612, "value_state": "observed", "status": "observed", "source_id": "enroll-2025",
         "source_locator": "p2", "notes": "", "observation_id": "a|huusd|2024-25"},
        {"series_id": "attending-october", "entity_id": "huusd", "school_year": "2025-26", "grade_scope": "K-12",
         "reference_date": "2025-10-01", "reference_date_status": "known",
         "population_basis": "attending_excludes_early_college", "count_basis": "reported_headcount",
         "value": 1578, "value_state": "observed", "status": "observed", "source_id": "enroll-2025",
         "source_locator": "p2", "notes": "Excludes Early College", "observation_id": "a|huusd|2025-26"},
        {"series_id": "attending-october", "entity_id": "warren", "school_year": "2025-26", "grade_scope": "K-6",
         "reference_date": "2025-10-01", "reference_date_status": "known",
         "population_basis": "attending_excludes_early_college", "count_basis": "reported_headcount",
         "value": 164, "value_state": "observed", "status": "observed", "source_id": "enroll-2025",
         "source_locator": "p3", "notes": "", "observation_id": "a|warren|2025-26"},
    ]
    projections = [
        {"series_id": "nesdec-2026-k12", "entity_id": "huusd", "school_year": "2026-27", "grade_scope": "K-12",
         "reference_date": None, "reference_date_status": "unknown",
         "population_basis": "nesdec_2026_projected_enrollment", "count_basis": "projected_headcount",
         "value": 1581, "value_state": "observed", "status": "projection", "source_id": "nesdec-2026",
         "source_locator": "p6", "observation_id": "n|2026-27",
         "notes": "Its base of 1591 includes Early College; the attending count of 1578 excludes Early College.",
         "forecast_vintage": "2026-01-09-v2", "author": "NESDEC", "base_year": "2025-26",
         "horizon": "2026-27 through 2035-36", "assumptions": "Cohort survival"},
    ]
    series = [
        {"series_key": "a|huusd", "series_id": "attending-october", "entity_id": "huusd", "grade_scope": "K-12",
         "population_basis": "attending_excludes_early_college", "count_basis": "reported_headcount",
         "kind": "history", "connect_points": True,
         "description": "October 1 counts of students attending grades K-12, excluding Early College.",
         "observation_ids": ["a|huusd|2024-25", "a|huusd|2025-26"]},
        {"series_key": "a|warren", "series_id": "attending-october", "entity_id": "warren", "grade_scope": "K-6",
         "population_basis": "attending_excludes_early_college", "count_basis": "reported_headcount",
         "kind": "history", "connect_points": True,
         "description": "October 1 counts of students attending grades K-12, excluding Early College.",
         "observation_ids": ["a|warren|2025-26"]},
    ]
    return {"schema_version": 1, "dataset_date": "2026-10-04", "content_digest": "0" * 64, "campuses": campuses,
            "schools": schools, "programs": [], "notes": [], "enrollment": enrollment, "projections": projections,
            "sources": sources, "series": series}


PASSAGE_TEXTS = [
    ("board-min-2026-03-11", 2, "The board voted 7-2 to adopt the fiscal year 2027 budget of $54,321,000. "
                                "The motion carried."),
    ("board-min-2026-03-11", 3, "Members discussed a proposal to reconfigure Fayston and Waitsfield. "
                                "No vote was taken on reconfiguration."),
    ("buv-report", 1, "The Building Use & Visioning Committee recommends that the board study three "
                      "reconfiguration options for elementary schools."),
    ("buv-report", 2, "Option A would merge Fayston and Waitsfield elementary schools into one campus."),
    ("buv-report", 3, "Option B would keep all elementary schools open and share staff across campuses."),
    ("buv-report", 4, "Option C would move grade 6 to Harwood Union Middle School."),
    ("buv-report", 5, "Reconfiguration options were presented for community feedback, not adopted."),
    ("finance-min-2026-01", 1, "The Finance Committee reviewed budget drivers including health insurance."),
    ("board-agenda-2026-11-04", 1, "Agenda: approve minutes; enrollment update; reconfiguration discussion."),
    ("unknown-source", 1, "This passage belongs to no payload source and must never be served."),
]


def make_rows(model_vectors: bool = True) -> list[PassageRow]:
    rows = []
    for i, (source_id, ordinal, text) in enumerate(PASSAGE_TEXTS):
        rows.append(PassageRow(passage_id=f"{i:032x}", source_id=source_id, ordinal=ordinal,
                               page_start=ordinal, page_end=ordinal, text=text,
                               embedding=hashed_vector(text) if model_vectors else None))
    return rows


def make_snapshot(release_id: str = "release-1", *, model: str = MODEL, dims: int = DIMS,
                  payload: dict | None = None) -> Snapshot:
    return Snapshot(release_id=release_id, payload=payload or make_payload(), embedding_model=model, dims=dims,
                    passages=make_rows())


@dataclass
class FakeStore:
    snapshot: Snapshot | None = field(default_factory=make_snapshot)
    loads: int = 0
    reads: int = 0

    async def active_release_id(self) -> str | None:
        self.reads += 1
        return self.snapshot.release_id if self.snapshot else None

    async def load_snapshot(self) -> Snapshot | None:
        self.loads += 1
        return copy.deepcopy(self.snapshot)


@pytest.fixture
def store() -> FakeStore:
    return FakeStore()


@pytest.fixture
def embedder() -> FakeEmbedder:
    return FakeEmbedder()
