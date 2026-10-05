"""Synthetic filesystem regressions for registered publication cleanup."""
import csv
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

from build_public_snapshot import build_candidate
from publication_policy import INPUTS, cleanup, register_export, registry, validate

sys.path.insert(0, str(Path(__file__).resolve().parent / 'publication-fixtures'))
from generate import generate


def replace_source(base):
    """Build a genuine source-B replacement at source A's candidate/input paths."""
    base = Path(base)
    root, inputs = base / 'collection', base / 'inputs'
    source = b'Synthetic independent replacement source B. Not HUUSD evidence.'
    (root / 'files/replacement.txt').write_bytes(source)
    digest = hashlib.sha256(source).hexdigest()
    url = 'https://huusd.org/synthetic-replacement'
    (root / 'catalog/sources.json').write_text(json.dumps([
        {'source_id': 'replacement', 'url': url,
         'files': [{'local_path': 'files/replacement.txt', 'sha256': digest}]}]))
    reviewed = json.loads((inputs / 'sources.json').read_text())
    reviewed[0].update(source_id='replacement', sha256=digest, url=url)
    (inputs / 'sources.json').write_text(json.dumps(reviewed))
    for name in ('schools.json', 'derivations.json'):
        path = inputs / name
        path.write_text(path.read_text().replace('"report"', '"replacement"'))
    for name in ('enrollment.csv', 'projections.csv'):
        path = inputs / name
        with path.open(newline='') as stream:
            reader = csv.DictReader(stream)
            fields, rows = reader.fieldnames, list(reader)
        with path.open('w', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            writer.writerows(row | {'source_id': 'replacement'} for row in rows)
    build_candidate(inputs, root, base / 'candidate')


class PublicationPolicyTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(dir=os.environ.get('RUNNER_TEMP', '/tmp/opencode'))
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name) / 'fixture'
        generate(self.base)
        self.root, self.inputs, self.candidate = (self.base / name for name in ('collection', 'inputs', 'candidate'))
        self.request = {'candidate': str(self.candidate), 'inputs': str(self.inputs)}
        self.rules = {'schema_version': 1, 'source_ids': ['report'], 'paths': [], 'sha256': []}
        self.export = self.base / 'registered-export.json'

    def export_payload(self):
        self.export.write_bytes((self.candidate / 'payload.json').read_bytes())
        register_export(self.root, self.candidate, self.export)

    def test_source_replacement_keeps_old_export_dependencies_until_cleanup(self):
        validate(self.root, self.request)
        self.export_payload()
        replace_source(self.base)
        replacement = validate(self.root, self.request)
        self.assertEqual([s['source_id'] for s in json.loads(replacement['lineage'])['sources']], ['replacement'])
        self.assertEqual(cleanup(self.root, self.rules), {'removed_artifacts': 1})
        self.assertFalse(self.export.exists())
        self.assertFalse(self.candidate.exists())
        self.assertFalse(any((self.inputs / name).exists() for name in INPUTS))
        self.assertEqual(registry(self.root)['artifacts'], [])

    def test_unverified_inputs_stay_pending_after_candidate_and_export_deletion(self):
        (self.root / 'reports/privacy-exclusions.json').write_text(json.dumps(self.rules))
        with self.assertRaises(ValueError):
            validate(self.root, self.request)
        self.export_payload()
        for _ in range(2):
            with self.assertRaises(ValueError):
                cleanup(self.root, self.rules)
            self.assertFalse(self.candidate.exists())
            self.assertFalse(self.export.exists())
            self.assertTrue(all((self.inputs / name).exists() for name in INPUTS))
            pending = registry(self.root)['artifacts']
            self.assertEqual(len(pending), 1)
            self.assertFalse(pending[0]['verified_inputs'])
            self.assertEqual(set(pending[0]), {'candidate', 'inputs', 'exports', 'sources', 'verified_inputs'})
        # Authorized removal of these exact synthetic input containers; no copy.
        for name in INPUTS:
            (self.inputs / name).unlink()
        self.assertEqual(cleanup(self.root, self.rules), {'removed_artifacts': 1})
        self.assertEqual(registry(self.root)['artifacts'], [])


if __name__ == '__main__':
    unittest.main()
