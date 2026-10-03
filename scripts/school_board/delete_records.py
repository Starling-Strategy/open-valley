"""Apply reviewed exclusions, delete duplicates, and sanitize the input ZIP.

The request contains only source_ids and collection-relative paths. This command
deletes whole records; it does not classify content or retain quarantine copies.
"""
import argparse
import fcntl
from datetime import datetime, timezone
import hashlib
import json
import os
import stat
from pathlib import Path, PurePosixPath
import tempfile
import zipfile
from privacy_rules import canonical_id, load_rules, write_json


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def local_path(root, relative):
    path = root / relative
    if Path(relative).is_absolute() or ".." in Path(relative).parts or not path.resolve().is_relative_to(root):
        raise ValueError("Deletion path must stay inside the collection")
    if path.is_symlink():
        raise ValueError("Deletion requests must not name symbolic links")
    return path


def sanitize_archive(archive, paths, hashes):
    members = {path.removeprefix("archive/") for path in paths if path.startswith("archive/")}
    previous = sha256(archive)
    original_mode = stat.S_IMODE(archive.stat().st_mode)
    removed = []
    retained = {}
    fd, name = tempfile.mkstemp(prefix=".privacy-cleanup-", suffix=".zip", dir=archive.parent)
    os.close(fd)
    temporary = Path(name)
    try:
        with zipfile.ZipFile(archive) as source, zipfile.ZipFile(temporary, "w") as destination:
            for info in source.infolist():
                normalized = info.filename
                if normalized.startswith("__MACOSX/"):
                    path = PurePosixPath(normalized.removeprefix("__MACOSX/"))
                    normalized = str(path.with_name(path.name.removeprefix("._")))
                data = source.read(info)
                digest = hashlib.sha256(data).hexdigest()
                if normalized in members or digest in hashes:
                    removed.append(info.filename)
                    continue
                destination.writestr(info, data)
                retained[info.filename] = digest
        with zipfile.ZipFile(temporary) as result:
            if result.testzip() or set(result.namelist()) != set(retained):
                raise ValueError("Sanitized archive failed integrity verification")
            for member, digest in retained.items():
                if hashlib.sha256(result.read(member)).hexdigest() != digest:
                    raise ValueError("Retained archive member changed")
        temporary.chmod(original_mode)
        os.replace(temporary, archive)
    finally:
        temporary.unlink(missing_ok=True)
    return {"previous_sha256": previous, "sanitized_sha256": sha256(archive),
            "removed_members": removed, "retained_member_hashes_verified": len(retained)}


def _apply(root, request, archive):
    root = root.resolve()
    archive = archive.resolve()
    if archive.parent != root.parent or archive.name != "huusd-board.zip":
        raise ValueError("Expected the collection's sibling huusd-board.zip")
    manifest_path = root / "reports/privacy-exclusions.json"
    report_path = root / "reports/privacy-deletions.json"
    extraction_path = root / "reports/extraction.json"
    rules = load_rules(manifest_path)
    report = json.loads(report_path.read_text())
    extraction = json.loads(extraction_path.read_text())
    catalog = json.loads((root / "catalog/sources.json").read_text())
    if not isinstance(request, dict):
        raise ValueError("Deletion request must be an object")
    for key in ("paths", "source_ids"):
        if not isinstance(request.get(key, []), list) or any(not isinstance(v, str) or not v for v in request.get(key, [])):
            raise ValueError("Deletion request requires string arrays")
    paths = set(request.get("paths", []))
    ids = {canonical_id(value) for value in request.get("source_ids", [])}
    # A previous attempt may have saved tombstones and rebuilt the catalog before
    # all unlinks completed. Retry outstanding exclusions even without that catalog.
    paths.update(relative for relative in rules["paths"] if local_path(root, relative).is_file())
    for row in catalog:
        if canonical_id(row["source_id"]) in ids:
            paths.update(item["local_path"] for item in row["files"])
    for relative in paths:
        local_path(root, relative)
    hashes = set(rules["sha256"]) | {sha256(local_path(root, relative)) for relative in paths if local_path(root, relative).is_file()}
    ids.update(canonical_id(value) for value in rules["source_ids"])
    file_hashes = {}
    artifact_specs = {item["local_path"]: item for row in catalog for item in row["files"]}
    for path in root.rglob("*"):
        if path.is_file() and not path.is_symlink():
            file_hashes[str(path.relative_to(root))] = sha256(path)
    while True:
        before = (len(paths), len(ids), len(hashes))
        paths.update(relative for relative, digest in file_hashes.items() if digest in hashes)
        for row in catalog:
            identity = canonical_id(row["source_id"])
            if identity in ids or any(item["local_path"] in paths or item["sha256"] in hashes for item in row["files"]):
                ids.add(identity)
                paths.update(item["local_path"] for item in row["files"])
                hashes.update(item["sha256"] for item in row["files"])
        hashes.update(file_hashes[relative] for relative in paths if relative in file_hashes)
        if before == (len(paths), len(ids), len(hashes)):
            break
    receipts = []
    prior = {row["original_path"]: row for row in report["deleted_files"]}
    with zipfile.ZipFile(archive) as source:
        archive_names = set(source.namelist())
        for relative in sorted(paths):
            path = local_path(root, relative)
            member = relative.removeprefix("archive/") if relative.startswith("archive/") else None
            if path.is_file():
                info = {"sha256": sha256(path), "bytes": path.stat().st_size}
            elif member in archive_names:
                data = source.read(member)
                info = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
                expected = artifact_specs.get(relative, {}).get("sha256")
                if expected and expected != info["sha256"]:
                    raise ValueError("Archive-only format checksum mismatch: " + relative)
                hashes.add(info["sha256"])
            elif relative in prior:
                continue
            else:
                raise ValueError("Requested record is absent from files, archive and receipts: " + relative)
            receipts.append({"original_path": relative, **info, "disposition": "deleted"})
    stamp = datetime.now(timezone.utc).isoformat()
    rules.update({"source_ids": sorted({canonical_id(value) for value in rules["source_ids"]} | ids),
                  "paths": sorted(set(rules["paths"]) | paths),
                  "sha256": sorted(set(rules["sha256"]) | hashes), "updated_at": stamp})
    # Save non-content tombstones first so an interrupted cleanup cannot reindex
    # the selected sources. Verification still fails if their bytes remain.
    report["deleted_files"] = list({row["original_path"]: row for row in report["deleted_files"] + receipts}.values())
    write_json(manifest_path, rules)
    write_json(report_path, report)
    # Include prior exclusions too, making an interrupted archive rewrite retryable.
    archive_result = sanitize_archive(archive, set(rules["paths"]), set(rules["sha256"]))
    for relative in paths:
        local_path(root, relative).unlink(missing_ok=True)
    if any(local_path(root, relative).exists() for relative in rules["paths"]):
        raise RuntimeError("Excluded paths remain after deletion")
    event = {"completed_at": stamp, "deleted_files": len(receipts), "source_ids": sorted(ids),
             "archive": archive_result}
    report.setdefault("additional_reviews", []).append(event)
    report["completed_at"] = stamp
    report["archive"].update({"sanitized_sha256": archive_result["sanitized_sha256"],
                              "retained_member_hashes_verified": archive_result["retained_member_hashes_verified"]})
    report["archive"]["removed_members"].extend(archive_result["removed_members"])
    write_json(report_path, report)
    for item in extraction["inputs"]:
        if Path(item["path"]).resolve() == archive:
            item.update({"sha256": archive_result["sanitized_sha256"], "bytes": archive.stat().st_size,
                         "status": "sanitized_after_user_requested_deletion"})
    write_json(extraction_path, extraction)
    return event


def apply(root, request, archive):
    root = root.resolve()
    with (root.parent / ".school-board-cleanup.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("Another cleanup is updating this collection") from error
        return _apply(root, request, archive)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(apply(args.root, json.loads(args.request.read_text()), args.archive), indent=2))
