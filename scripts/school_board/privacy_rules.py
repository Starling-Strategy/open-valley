"""Validated exclusion metadata and source-type-aware identity normalization."""
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tempfile


def canonical_id(value):
    value = str(value)
    if re.fullmatch(r"[0-9a-fA-F]{32}|[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", value):
        return value.replace("-", "").lower()
    return value  # Drive/YouTube punctuation and case are significant.


def load_rules(path):
    rules = json.loads(Path(path).read_text())
    if not isinstance(rules, dict) or rules.get("schema_version", 1) != 1:
        raise ValueError("Invalid exclusion manifest schema")
    for name in ("source_ids", "paths", "sha256"):
        values = rules.get(name)
        if not isinstance(values, list) or any(not isinstance(v, str) or not v for v in values):
            raise ValueError("Exclusion manifest requires a string array: " + name)
    if any(not re.fullmatch(r"[0-9a-f]{64}", value) for value in rules["sha256"]):
        raise ValueError("Invalid exclusion content hash")
    if any(PurePosixPath(value).is_absolute() or ".." in PurePosixPath(value).parts or "\\" in value for value in rules["paths"]):
        raise ValueError("Exclusion paths must be collection-relative")
    return rules


def write_json(path, value):
    """Atomic replacement, following the collection's versioned metadata links."""
    path = Path(path).resolve()
    mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else None
    fd, name = tempfile.mkstemp(prefix=".privacy-metadata-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        if mode is not None:
            temporary.chmod(mode)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
