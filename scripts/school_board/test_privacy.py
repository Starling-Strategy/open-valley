"""Synthetic regressions for destructive cleanup and reimport prevention."""
import hashlib
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

from delete_records import apply, local_path
from verify_privacy import verify
from privacy_rules import canonical_id, load_rules
from review_documents import scan


class PrivacyCleanupTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.project = Path(self.temporary.name)
        self.root = self.project / "school-board"
        for name in ("reports", "catalog", "notion/search", "archive/huusd-board"):
            (self.root / name).mkdir(parents=True)
        self.blocked = b"synthetic excluded conversation"
        self.allowed = b"public procedural minutes"
        self.digest = hashlib.sha256(self.blocked).hexdigest()
        (self.root / "archive/huusd-board/closed.txt").write_bytes(self.blocked)
        (self.root / "alias.txt").write_bytes(self.blocked)
        (self.root / "minutes.txt").write_bytes(self.allowed)
        self.archive = self.project / "huusd-board.zip"
        with zipfile.ZipFile(self.archive, "w") as z:
            z.writestr("huusd-board/closed.txt", self.blocked)
            z.writestr("__MACOSX/huusd-board/._closed.txt", b"metadata")
            z.writestr("huusd-board/minutes.txt", self.allowed)
        self.write("reports/privacy-exclusions.json", {"source_ids": [], "paths": [], "sha256": []})
        self.write("reports/privacy-deletions.json", {"deleted_files": [], "archive": {"removed_members": []}})
        self.write("reports/extraction.json", {"inputs": [{"path": str(self.archive)}]})
        self.write("catalog/sources.json", [
            {"source_id": "closed", "files": [{"local_path": "archive/huusd-board/closed.txt", "sha256": self.digest}]},
            {"source_id": "alias", "files": [{"local_path": "alias.txt", "sha256": self.digest}]},
        ])
        self.write("catalog/meetings.json", [])

    def write(self, relative, value):
        (self.root / relative).write_text(json.dumps(value))

    def test_deletes_duplicates_and_archive_members_preserves_public_minutes(self):
        mode = self.archive.stat().st_mode
        result = apply(self.root, {"source_ids": ["closed"]}, self.archive)
        self.assertEqual(result["deleted_files"], 2)
        self.assertFalse((self.root / "alias.txt").exists())
        self.assertEqual((self.root / "minutes.txt").read_bytes(), self.allowed)
        self.assertEqual(self.archive.stat().st_mode, mode)
        with zipfile.ZipFile(self.archive) as z:
            self.assertEqual(z.namelist(), ["huusd-board/minutes.txt"])
            self.assertEqual(z.read(z.namelist()[0]), self.allowed)
        rules = json.loads((self.root / "reports/privacy-exclusions.json").read_text())
        self.assertEqual(set(rules["source_ids"]), {"closed", "alias"})
        self.write("catalog/sources.json", [])
        self.assertTrue(verify(self.root)["passed"])
        again = apply(self.root, {"paths": ["alias.txt"]}, self.archive)
        self.assertEqual(again["deleted_files"], 0)

    def test_rejects_traversal_and_symlink(self):
        with self.assertRaises(ValueError):
            local_path(self.root, "../outside")
        (self.root / "link").symlink_to(self.root / "minutes.txt")
        with self.assertRaises(ValueError):
            local_path(self.root, "link")

    def test_retry_removes_pending_exclusions_after_catalog_rebuild(self):
        self.write("reports/privacy-exclusions.json", {"source_ids": ["closed"],
                   "paths": ["archive/huusd-board/closed.txt"], "sha256": [self.digest]})
        self.write("catalog/sources.json", [])
        result = apply(self.root, {"source_ids": ["closed"]}, self.archive)
        self.assertEqual(result["deleted_files"], 2)
        self.assertFalse((self.root / "archive/huusd-board/closed.txt").exists())
        self.assertFalse((self.root / "alias.txt").exists())

    def test_review_lock_prevents_report_truncation(self):
        output = self.root / "reports/scan.jsonl"
        output.write_text("existing metadata\n")
        with output.with_suffix(".jsonl.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = subprocess.run([sys.executable, str(Path(__file__).with_name("review_documents.py")),
                                     "--root", str(self.root), "--output", str(output)], capture_output=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(output.read_text(), "existing metadata\n")

    def test_cleanup_lock_prevents_concurrent_metadata_updates(self):
        with (self.project / ".school-board-cleanup.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(RuntimeError):
                apply(self.root, {"source_ids": ["closed"]}, self.archive)
        self.assertTrue((self.root / "alias.txt").exists())
        self.assertEqual(load_rules(self.root / "reports/privacy-exclusions.json")["paths"], [])

    def test_caucus_marker_is_screened_without_executive_session_phrase(self):
        path = self.root / "synthetic.html"
        path.write_text("<p>Caucus begins. Synthetic negotiation notes.</p>")
        result = scan((path, self.root, [], hashlib.sha256(path.read_bytes()).hexdigest(), None))
        self.assertEqual(result["matches"][0]["counts"]["closed"], 1)
        self.assertTrue(path.exists())  # Screening never deletes or classifies automatically.

    def test_resume_rechecks_records_from_an_older_analysis(self):
        path = self.root / "supplements/test/source.html"
        path.parent.mkdir(parents=True)
        path.write_text("<p>Synthetic caucus marker.</p>")
        output = self.root / "reports/scan.jsonl"
        output.write_text(json.dumps({"path": "supplements/test/source.html", "errors": [], "matches": [],
                                     "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                                     "analysis_id": "older-patterns", "low_text_pages": []}) + "\n")
        result = subprocess.run([sys.executable, str(Path(__file__).with_name("review_documents.py")),
                                 "--root", str(self.root), "--output", str(output), "--workers", "1", "--resume"],
                                capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        record = json.loads(output.read_text())
        self.assertEqual(record["matches"][0]["counts"]["closed"], 1)

    def test_detects_reintroduced_bytes_and_dashed_id_search_excerpt(self):
        compact = "123456781234123412341234567890ab"
        dashed = "12345678-1234-1234-1234-1234567890ab"
        self.write("reports/privacy-exclusions.json", {"source_ids": [compact], "paths": [], "sha256": [self.digest]})
        self.write("notion/search/cache.json", {"results": [{"id": dashed, "highlight": "synthetic excerpt"}]})
        self.write("catalog/sources.json", [{"source_id": dashed, "files": []}])
        errors = verify(self.root)["errors"]
        self.assertTrue(any(e.startswith("deleted_bytes_retained:") for e in errors))
        self.assertTrue(any(e.startswith("deleted_archive_member:") for e in errors))
        self.assertTrue(any(e.startswith("excluded_source_cached_excerpt:") for e in errors))
        self.assertTrue(any(e.startswith("excluded_source_in_catalog:") for e in errors))

    def test_expands_duplicate_source_alternate_formats_to_fixed_point(self):
        alternate = "archive/huusd-board/alternate.txt"
        (self.root / alternate).write_text("synthetic alternate representation")
        rows = json.loads((self.root / "catalog/sources.json").read_text())
        rows[1]["files"].append({"local_path": alternate,
                                  "sha256": hashlib.sha256((self.root / alternate).read_bytes()).hexdigest()})
        self.write("catalog/sources.json", rows)
        result = apply(self.root, {"source_ids": ["closed"]}, self.archive)
        self.assertEqual(result["deleted_files"], 3)
        self.assertFalse((self.root / alternate).exists())

    def test_manifest_validation_fails_closed_and_preserves_drive_identity(self):
        self.write("reports/privacy-exclusions.json", {})
        with self.assertRaises(ValueError):
            load_rules(self.root / "reports/privacy-exclusions.json")
        self.write("reports/privacy-exclusions.json", {"source_ids": "not-an-array", "paths": [], "sha256": []})
        with self.assertRaises(ValueError):
            load_rules(self.root / "reports/privacy-exclusions.json")
        self.assertNotEqual(canonical_id("drive-A"), canonical_id("driveA"))
        self.assertNotEqual(canonical_id("drive-A"), canonical_id("drive-a"))

    def test_expands_archive_only_alternate_format(self):
        alternate = "archive/huusd-board/alternate.txt"
        payload = b"synthetic alternate representation in archive only"
        digest = hashlib.sha256(payload).hexdigest()
        rows = json.loads((self.root / "catalog/sources.json").read_text())
        rows[1]["files"].append({"local_path": alternate, "sha256": digest})
        self.write("catalog/sources.json", rows)
        with zipfile.ZipFile(self.archive, "a") as z:
            z.writestr("huusd-board/alternate.txt", payload)
        result = apply(self.root, {"source_ids": ["closed"]}, self.archive)
        self.assertEqual(result["deleted_files"], 3)
        rules = load_rules(self.root / "reports/privacy-exclusions.json")
        self.assertIn(alternate, rules["paths"])
        self.assertIn(digest, rules["sha256"])
        with zipfile.ZipFile(self.archive) as z:
            self.assertNotIn("huusd-board/alternate.txt", z.namelist())

    def test_catalog_does_not_create_metadata_for_content_hash_alias(self):
        self.write("reports/privacy-exclusions.json", {"source_ids": [], "paths": [], "sha256": [self.digest]})
        records = self.root / "archive/huusd-board/records"
        records.mkdir()
        (records / "manifest.csv").write_text("id,title\n")
        (self.root / "supplements/test").mkdir(parents=True)
        self.write("supplements/test/catalog.json", [
            {"source_id": "renamed", "title": "synthetic alias", "local_path": "alias.txt"},
            {"source_id": "nested", "title": "synthetic nested alias", "files": [{"local_path": "alias.txt"}]},
        ])
        result = subprocess.run([sys.executable, str(Path(__file__).with_name("build_catalog.py"))],
                                env={**os.environ, "SCHOOL_BOARD_ROOT": str(self.root)}, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(json.loads((self.root / "catalog/sources.json").read_text()), [])


if __name__ == "__main__":
    unittest.main()
