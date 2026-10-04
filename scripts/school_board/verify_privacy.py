"""Verify deletion bytes, archive members, cached excerpts and active catalogs.

This checks known exclusions, not whether unscreened content is confidential.
"""
import argparse
import hashlib
import json
from pathlib import Path
import tarfile
import zipfile
from privacy_rules import canonical_id, load_rules


def verify(root):
    root = root.resolve()
    rules = load_rules(root / "reports/privacy-exclusions.json")
    report = json.loads((root / "reports/privacy-deletions.json").read_text())
    hashes = set(rules["sha256"])
    ids = {canonical_id(value) for value in rules["source_ids"]}
    errors = []
    files_checked = 0
    archive_members_checked = 0
    files = [path for path in root.parent.rglob("*") if path.is_file()]
    for path in files:
        files_checked += 1
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest in hashes:
            errors.append("deleted_bytes_retained:" + str(path))
        if path.suffix == ".zip" and not path.name.startswith("._"):
            with zipfile.ZipFile(path) as archive:
                for member in archive.infolist():
                    if member.is_dir():
                        continue
                    archive_members_checked += 1
                    with archive.open(member) as stream:
                        digest = hashlib.file_digest(stream, "sha256").hexdigest()
                    if digest in hashes:
                        errors.append("deleted_archive_member:" + str(path) + ":" + member.filename)
        elif path.name.endswith(".tar.gz"):
            with tarfile.open(path) as archive:
                for member in archive:
                    if not member.isfile():
                        continue
                    archive_members_checked += 1
                    with archive.extractfile(member) as stream:
                        digest = hashlib.file_digest(stream, "sha256").hexdigest()
                    if digest in hashes:
                        errors.append("deleted_archive_member:" + str(path) + ":" + member.name)
    for relative in rules["paths"]:
        if (root / relative).exists():
            errors.append("deleted_path_exists:" + relative)
    for path in (root / "notion/search").glob("*.json"):
        data = json.loads(path.read_text())
        for item in data.get("results", []):
            if canonical_id(item.get("id", "")) in ids and item.get("highlight"):
                errors.append("excluded_source_cached_excerpt:" + str(path.relative_to(root)))
    for row in json.loads((root / "catalog/sources.json").read_text()):
        if canonical_id(row["source_id"]) in ids:
            errors.append("excluded_source_in_catalog:" + row["source_id"])
        for item in row["files"]:
            if item["local_path"] in rules["paths"] or item["sha256"] in hashes:
                errors.append("excluded_file_in_catalog:" + item["local_path"])
    for row in json.loads((root / "catalog/meetings.json").read_text()):
        for item in row.get("evidence", []):
            if canonical_id(item.get("source_id")) in ids:
                errors.append("excluded_meeting_evidence:" + item["source_id"])
    if (root.parent / "school-board-private-review").exists():
        errors.append("private_review_directory_recreated")
    return {"passed": not errors, "status": "deleted_not_quarantined",
            "files_checked": files_checked, "archive_members_checked": archive_members_checked,
            "deleted_files": len(report["deleted_files"]), "excluded_source_ids": len(ids),
            "errors": sorted(set(errors)),
            "scope": "Known excluded bytes, archive members, cached source excerpts and catalog references; not full OCR/audio clearance or forensic erasure."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    result = verify(args.root)
    (args.root / "reports/privacy-verification.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    raise SystemExit(not result["passed"])
