"""Shared exclusions for the local school-board catalog and ingestion tools."""
import os
from pathlib import Path
from privacy_rules import canonical_id, load_rules

ROOT = Path(os.environ.get("SCHOOL_BOARD_ROOT", "/rocky/open-valley/school-board")).resolve()
MANIFEST = ROOT / "reports/privacy-exclusions.json"
RULES = load_rules(MANIFEST)
SOURCE_IDS = {canonical_id(value) for value in RULES["source_ids"]}
PATHS = set(RULES["paths"])
HASHES = set(RULES["sha256"])


def excluded(source_id=None, path=None, digest=None):
    return canonical_id(source_id) in SOURCE_IDS or str(path) in PATHS or digest in HASHES
