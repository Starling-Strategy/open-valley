import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from import_facilities_review import excluded_ids, prepare


class FacilitiesReviewTests(unittest.TestCase):
    def test_exclusions_propagate_across_editions_and_aliases(self):
        rows = [
            {'source_id': 'a', 'files': [{'local_path': 'a.txt', 'sha256': '1'}, {'local_path': 'b.txt', 'sha256': '2'}]},
            {'source_id': 'b', 'files': [{'local_path': 'c.txt', 'sha256': '2'}]},
        ]
        self.assertEqual(excluded_ids(rows, {'source_ids': [], 'paths': ['a.txt'], 'sha256': []}), {'a', 'b'})

    def test_changed_or_excluded_source_cannot_be_promoted(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            content = b'Public committee minutes'
            sha = hashlib.sha256(content).hexdigest()
            source = root / 'minutes.txt'
            source.write_bytes(content)
            rows = [{'source_id': 's', 'title': '2026-09-01 Minutes', 'url': 'https://huusd.org/board',
                     'files': [{'local_path': 'minutes.txt', 'sha256': sha}]}]
            rules = {'source_ids': [], 'paths': [], 'sha256': []}
            with patch('import_facilities_review.SELECTIONS', [('s', sha, None)]):
                result = prepare(root, rows, rules, [])
                self.assertEqual(result[0][0], content + b'\n')
                # Keep the original identity so runtime exclusions withdraw derivatives too.
                self.assertEqual(result[0][1]['id'], 's')
                rules['sha256'] = [sha]
                with self.assertRaisesRegex(ValueError, 'excluded'):
                    prepare(root, rows, rules, [])
                rules['sha256'] = []
                source.write_bytes(b'Changed since review')
                with self.assertRaisesRegex(ValueError, 'changed since review'):
                    prepare(root, rows, rules, [])


if __name__ == '__main__':
    unittest.main()
