"""Synthetic, archive-free tests of library selection and citation preservation."""
import copy
import csv
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from build_public_library import (COMMITTEE, CORE_LIBRARY, ENROLLMENT_REPORT_IDS, PERSONAL_COMMENTS,
                                  SCHOOL_REFERENCE_IDS, blocked_sources, build_library, document_date,
                                  kind_of, school_year)


class PublicLibraryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=os.environ.get('RUNNER_TEMP', '/tmp/opencode'))
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for folder in ('catalog', 'reports', 'supplements/committee', 'archive/huusd-board/records', 'files'):
            (self.root / folder).mkdir(parents=True)
        self.catalog = []
        self.core = self.source('core', 'Original reviewed title')
        self.core['locators'] = ['p. 1; original citation.', 'p. 2; another original citation.']
        self.committee = []
        self.meetings = []
        self.history = []
        self.rules = dict(schema_version=1, source_ids=[], paths=[], sha256=[])

    def source(self, sid, title, url=None):
        payload = ('synthetic public bytes ' + sid).encode()
        relative = 'files/' + sid + '.txt'
        (self.root / relative).write_bytes(payload)
        digest = hashlib.sha256(payload).hexdigest()
        url = url or f'https://docs.google.com/document/d/{sid}/edit'
        self.catalog.append(dict(source_id=sid, title=title, url=url,
                                 files=[dict(local_path=relative, sha256=digest)]))
        return dict(source_id=sid, title=title, url=url, sha256=digest,
                    published_at=None, reviewed_at='2026-10-04', public_eligible=True,
                    locators=['Original locator.'])

    def write(self, relative, value):
        (self.root / relative).write_text(json.dumps(value), encoding='utf-8')

    def build(self, existing=None):
        self.write('catalog/sources.json', self.catalog)
        self.write('catalog/meetings.json', self.meetings)
        self.write('reports/privacy-exclusions.json', self.rules)
        self.write('supplements/committee/catalog.json', self.committee)
        with (self.root / 'archive/huusd-board/records/manifest.csv').open('w', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=['id', 'name', 'kind', 'path'])
            writer.writeheader()
            writer.writerows(self.history)
        with patch('build_public_library.CORE_LIBRARY', {'core': ('Enrollment', 'Report')}), patch('build_public_library.REPORTS', []):
            return build_library(self.root, existing or [self.core])

    def test_selection_deduplication_core_preservation_and_repeatability(self):
        cip = self.source('cip', 'BPS CIP 26-27')
        agenda = self.source('agenda', '2026-09-23 Board Agenda')
        old = self.source('old', '10/22/15 Board Minutes')
        self.committee = [cip | {'kind': 'linked-target'},
                          {'source_id': 'folder', 'kind': 'linked-folder'},
                          {'source_id': 'url-external'},
                          {'source_id': PERSONAL_COMMENTS}]
        self.meetings = [dict(body='HUUSD Board', date='2026-09-23', occurrence_status='held',
                              evidence=[agenda | {'kind': 'agenda'}, cip | {'kind': 'attachment'}])]
        self.history = [dict(id='old', name=old['title'], kind='minute', path='2015-2016'),
                        dict(id='agenda', name=agenda['title'], kind='agenda', path='2026-2027'),
                        dict(id='ignored', name='Routine warrant', kind='warrant', path='')]
        originals = copy.deepcopy(self.core)
        first, skipped = self.build()
        indexed = {s['source_id']: s for s in first}
        self.assertEqual(set(indexed), {'core', 'cip', 'agenda', 'old'})
        for key, value in originals.items():
            self.assertEqual(indexed['core'][key], value)
        self.assertEqual(indexed['core']['library'], dict(
            category='Enrollment', body='HUUSD', kind='Report', school_year='Unknown',
            document_date=None, meetings=[], collections=['core']))
        self.assertEqual(indexed['cip']['locators'], [])
        self.assertEqual(indexed['cip']['library'], dict(
            category='School improvement', body=COMMITTEE, kind='Continuous Improvement Plan',
            school_year='2026-27', document_date=None,
            meetings=[dict(date='2026-09-23', body='HUUSD Board', status='held')],
            collections=['building_use_visioning', 'meetings']))
        self.assertIsNone(indexed['cip']['published_at'])
        self.assertEqual(indexed['agenda']['library']['collections'], ['historical_board', 'meetings'])
        self.assertEqual(indexed['old']['library']['collections'], ['historical_board'])
        self.assertEqual(indexed['old']['published_at'], '2015-10-22')
        self.assertEqual(skipped['folder'], 1)
        self.assertEqual(first, self.build(first)[0])
        self.assertEqual(self.core, originals)

    def test_privacy_aliases_missing_editions_and_bad_urls_are_excluded(self):
        blocked = self.source('blocked', 'Public report')
        alias = self.source('alias', 'Another report')
        self.catalog[-1]['files'] = copy.deepcopy(self.catalog[-2]['files'])
        bad = self.source('bad', 'Unverified URL', 'https://third-party.example/report')
        self.committee = [blocked, alias, bad, {'source_id': 'absent'}]
        self.rules['source_ids'] = ['blocked']
        sources, skipped = self.build()
        self.assertEqual([s['source_id'] for s in sources], ['core'])
        self.assertEqual(skipped['privacy or unverified personal comments'], 2)
        self.assertEqual(skipped['unsupported official URL identity'], 1)
        self.assertEqual(skipped['no catalog-backed local edition'], 1)

    def test_changed_bytes_fail_closed_and_catalog_fragments_are_stripped(self):
        item = self.source('slide', 'Facilities presentation',
                           'https://docs.google.com/presentation/d/slide/edit#slide=id.p1')
        self.committee = [item]
        sources, _ = self.build()
        self.assertEqual(sources[-1]['url'], 'https://docs.google.com/presentation/d/slide/edit')
        (self.root / 'files/slide.txt').write_text('changed bytes')
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            self.build()

    def test_hash_and_path_exclusions_propagate_transitively(self):
        self.source('one', 'One')
        self.source('two', 'Two')
        self.catalog[-1]['files'].append(copy.deepcopy(self.catalog[-2]['files'][0]))
        for field, value in [('sha256', self.catalog[-2]['files'][0]['sha256']),
                             ('paths', self.catalog[-2]['files'][0]['local_path'])]:
            rules = dict(schema_version=1, source_ids=[], paths=[], sha256=[])
            rules[field] = [value]
            self.assertEqual(blocked_sources(self.catalog, rules), {'one', 'two'})

    def test_calendar_dates_school_years_and_document_kinds(self):
        self.assertEqual(document_date('2025-09-23 Agenda'), '2025-09-23')
        self.assertEqual(document_date('Minutes 10/22/25'), '2025-10-22')
        self.assertEqual(document_date('Facility Report 10-27-2025'), '2025-10-27')
        self.assertIsNone(document_date('2025-02-30 report'))
        self.assertIsNone(document_date('November 2025'))
        self.assertEqual(school_year('BPS CIP 25-26', None), '2025-26')
        self.assertEqual(school_year('Report', '2026-06-22'), '2025-26')
        self.assertEqual(school_year('Report', None), 'Unknown')
        self.assertEqual(kind_of('Board Policy', 'attachment'), 'Policy')

    def test_core_categories_are_explicit_not_positional(self):
        self.assertEqual(len(CORE_LIBRARY), len(ENROLLMENT_REPORT_IDS) + len(SCHOOL_REFERENCE_IDS))
        self.assertEqual(CORE_LIBRARY['1EwSuAJSRB2LzbzVriNOn5xya5ULajgBv'], ('Enrollment', 'Report'))
        self.assertEqual(CORE_LIBRARY['huusd-schools'], ('Schools', 'Reference'))

    def test_legacy_metadata_strings_never_become_locators(self):
        sources, _ = self.build()
        for source in sources:
            self.assertFalse(any(l.startswith(('Library metadata', 'Meeting record:')) for l in source['locators']))


if __name__ == '__main__':
    unittest.main()
