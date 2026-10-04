"""Archive-free publication boundary tests; all source bytes are synthetic."""
import copy
import csv
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from build_public_snapshot import build_candidate


FIELDS = 'series_id entity_id school_year reference_date grade_scope population_basis count_basis value value_state status source_id source_locator notes'.split()
FORECAST_FIELDS = FIELDS + 'forecast_vintage author base_year horizon assumptions'.split()


class PublicSnapshotTest(unittest.TestCase):
    def setUp(self):
        # The managed runtime supplies this scratch directory; CI uses RUNNER_TEMP.
        scratch = os.environ.get('RUNNER_TEMP', '/tmp/opencode')
        self.tmp = tempfile.TemporaryDirectory(dir=scratch)
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.root = self.base / 'collection'
        self.inputs = self.base / 'inputs'
        self.output = self.base / 'candidate'
        for folder in ('catalog', 'reports', 'files'):
            (self.root / folder).mkdir(parents=True)
        self.inputs.mkdir()
        self.sources = []
        self.catalog = []
        self.add_source('report')
        self.ref = {'source_id': 'report', 'source_locator': 'p1; public aggregate table'}
        observation_ref = {'series_id': 'attending-october', 'entity_id': 'school',
                           'school_year': '2025-26', 'grade_scope': 'K-12'}
        self.register = {
            'updated_at': '2026-10-04',
            'campuses': [{'campus_id': 'campus', 'name': 'School', 'address': '1 Main St',
                          'physical_town': 'Waterbury', 'latitude': 44.3, 'longitude': -72.7,
                          'state_school_id': 'PS1', 'sources': [self.ref], 'notes': 'Public location.'}],
            'schools': [{'school_id': 'school', 'name': 'School', 'campus_id': 'campus',
                         'directory_school_id': 'school', 'state_school_id': 'PS1', 'aliases': [],
                         'grade_configurations': [{'school_year': '2025-26', 'grade_scope': 'K-12',
                                                  'verified_at': '2026-10-04', **self.ref}],
                         'usual_next_school_ids': [], 'pathway_note': 'Public pathway.',
                         'sources': [self.ref], 'current_enrollment_ref': observation_ref,
                         'latest_attending_enrollment_ref': observation_ref}],
            'programs': [], 'notes': ['Public minutes record that an executive session occurred.']}
        self.rows = [self.row('huusd', 10), self.row('school', 10)]
        self.projections = []
        self.derivations = {'schema_version': 1, 'derivations': [], 'reconciliations': []}
        self.policy()
        self.write(self.root / 'catalog/summary.json', {'generated_at': '2026-10-04T14:35:00+00:00'})

    def write(self, path, value):
        path.write_text(json.dumps(value), encoding='utf-8')

    def add_source(self, source_id, payload=None):
        data = payload or ('synthetic public source ' + source_id).encode()
        path = 'files/' + source_id + '.txt'
        (self.root / path).write_bytes(data)
        digest = hashlib.sha256(data).hexdigest()
        self.sources.append({'source_id': source_id, 'title': 'Public report',
                             'url': 'https://huusd.org/' + source_id, 'published_at': '2025-10-02',
                             'sha256': digest, 'reviewed_at': '2026-10-04',
                             'public_eligible': True, 'locators': ['p1; table']})
        self.catalog.append({'source_id': source_id, 'url': 'https://huusd.org/' + source_id,
                             'files': [{'local_path': path, 'sha256': digest}],
                             'observations': [{'private_note': 'DO NOT PUBLISH CATALOG CONTEXT'}]})

    def row(self, entity, value, **overrides):
        return dict(series_id='attending-october', entity_id=entity, school_year='2025-26',
                    reference_date='2025-10-01', grade_scope='K-12',
                    population_basis='attending_excludes_early_college', count_basis='reported_headcount',
                    value=str(value) if value is not None else '', value_state='observed' if value is not None else 'missing',
                    status='observed', source_id='report', source_locator='p1; ' + entity,
                    notes='') | overrides

    def policy(self, **overrides):
        self.write(self.root / 'reports/privacy-exclusions.json',
                   dict(schema_version=1, source_ids=[], paths=[], sha256=[]) | overrides)

    def flush(self):
        self.write(self.inputs / 'schools.json', self.register)
        self.write(self.inputs / 'sources.json', self.sources)
        self.write(self.inputs / 'derivations.json', self.derivations)
        self.write(self.root / 'catalog/sources.json', self.catalog)
        for name, rows, fields in [('enrollment.csv', self.rows, FIELDS),
                                   ('projections.csv', self.projections, FORECAST_FIELDS)]:
            with (self.inputs / name).open('w', newline='') as stream:
                writer = csv.DictWriter(stream, fieldnames=fields)
                writer.writeheader()
                writer.writerows(rows)

    def build(self):
        self.flush()
        return build_candidate(self.inputs, self.root, self.output)

    def payload(self):
        return json.loads((self.output / 'payload.json').read_text())

    def assert_rejected(self, message):
        with self.assertRaisesRegex(ValueError, message):
            self.build()
        self.assertFalse(self.output.exists(), 'No stale or partial candidate may survive')

    def test_deterministic_public_payload_and_private_lineage(self):
        self.build()
        first = {p.name: p.read_bytes() for p in self.output.iterdir()}
        self.build()
        self.assertEqual(first, {p.name: p.read_bytes() for p in self.output.iterdir()})
        payload = self.payload()
        self.assertEqual(payload['schema_version'], 1)
        self.assertEqual([r['value'] for r in payload['enrollment']], [10, 10])
        public = (self.output / 'payload.json').read_text()
        for private in ('DO NOT PUBLISH', 'files/report.txt', self.sources[0]['sha256'], 'public_eligible'):
            self.assertNotIn(private, public)
        lineage = json.loads((self.output / 'lineage.json').read_text())
        self.assertEqual(lineage['sources'][0]['files'][0]['path'], 'files/report.txt')
        body = {k: v for k, v in payload.items() if k != 'content_digest'}
        encoded = json.dumps(body, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
        self.assertEqual(payload['content_digest'], hashlib.sha256(encoded).hexdigest())
        manifest = json.loads((self.output / 'candidate.json').read_text())
        self.assertEqual(manifest['payload_sha256'], hashlib.sha256(first['payload.json']).hexdigest())

    def test_duplicate_observation_even_with_different_source_or_status_fails(self):
        self.add_source('edition')
        self.rows.append(self.rows[1] | {'source_id': 'edition', 'status': 'preliminary'})
        self.assert_rejected('duplicate observation')

    def test_invalid_rows_fail_with_record_context(self):
        for field, value in [('entity_id', 'unknown'), ('reference_date', '2025-02-30'),
                             ('school_year', '2025-28'), ('value', '-1'), ('value', '1.5'),
                             ('status', 'finalish'), ('source_locator', ''), ('grade_scope', 'K-99')]:
            with self.subTest(field=field, value=value):
                old = self.rows[1]
                self.rows[1] = old | {field: value}
                self.assert_rejected('enrollment.csv:3')
                self.rows[1] = old

    def test_sources_require_explicit_eligibility_official_https_and_catalog_edition(self):
        original = self.sources[0]
        for change in ({'public_eligible': False}, {'public_eligible': 'true'},
                       {'url': 'https://notion.so/private'}, {'url': 'http://huusd.org/report'},
                       {'url': 'https://huusd.org.evil.test/report'},
                       {'url': 'https://user:password@huusd.org/report'},
                       {'sha256': '0' * 64}, {'sha256': None}, {'source_id': 'unknown'}):
            with self.subTest(change=change):
                self.sources[0] = original | change
                self.assert_rejected('source')

    def test_unknown_fields_in_inputs_and_school_references_fail(self):
        self.sources[0]['private_notes'] = 'private'
        self.assert_rejected('unknown fields')
        del self.sources[0]['private_notes']
        self.register['schools'][0]['grade_configurations'][0]['source_id'] = 'unknown'
        self.assert_rejected('unknown source')
        self.register['schools'][0]['grade_configurations'][0]['source_id'] = 'report'
        self.register['schools'][0]['current_enrollment_ref']['entity_id'] = 'unknown'
        self.assert_rejected('enrollment ref')

    def test_school_enrollment_refs_can_be_null_independently_or_together(self):
        school = self.register['schools'][0]
        fields = ('current_enrollment_ref', 'latest_attending_enrollment_ref')
        original = {field: school[field] for field in fields}
        for null_fields in ((fields[0],), (fields[1],), fields):
            with self.subTest(null_fields=null_fields):
                expected = {field: None if field in null_fields else original[field] for field in fields}
                school.update(expected)
                self.build()
                published = self.payload()['schools'][0]
                self.assertEqual({field: published[field] for field in fields}, expected)
                self.assertEqual(len(self.payload()['enrollment']), 2)

    def test_nonnull_school_enrollment_ref_is_validated_when_other_ref_is_null(self):
        school = self.register['schools'][0]
        fields = ('current_enrollment_ref', 'latest_attending_enrollment_ref')
        original = school['current_enrollment_ref']
        for field in fields:
            for ref, message in ((original | {'school_year': '2024-25'}, 'unknown or ambiguous enrollment ref'),
                                 (original | {'entity_id': 'huusd'}, 'enrollment ref points to another entity'),
                                 ({}, 'missing fields'), (False, 'invalid type')):
                with self.subTest(field=field, ref=ref):
                    school.update({key: None for key in fields})
                    school[field] = ref
                    self.assert_rejected(message)

    def test_nonnull_school_enrollment_ref_rejects_ambiguity_and_grade_mismatch(self):
        school = self.register['schools'][0]
        fields = ('current_enrollment_ref', 'latest_attending_enrollment_ref')
        original = school['current_enrollment_ref']
        for field in fields:
            with self.subTest(field=field):
                school.update({key: None for key in fields})
                school[field] = original
                self.rows.append(self.row('school', None, reference_date=''))
                self.assert_rejected('unknown or ambiguous enrollment ref')
                self.rows.pop()
                school['grade_configurations'][0]['grade_scope'] = 'K-6'
                self.assert_rejected('enrollment ref disagrees with dated grade configuration')
                school['grade_configurations'][0]['grade_scope'] = 'K-12'

    def test_missing_suppressed_and_not_applicable_remain_null_never_zero(self):
        for state in ('missing', 'suppressed', 'not_applicable'):
            with self.subTest(state=state):
                self.rows[1].update(value='', value_state=state)
                self.build()
                row = next(r for r in self.payload()['enrollment'] if r['entity_id'] == 'school')
                self.assertIsNone(row['value'])
                self.assertEqual(row['value_state'], state)
        self.rows[1]['value'] = '0'
        self.assert_rejected('value_state')

    def test_changed_policy_is_loaded_each_build_and_removes_stale_candidate(self):
        self.build()
        self.policy(source_ids=['report'])
        self.assert_rejected('excluded')

    def test_path_and_hash_exclusions_cover_original_rendering_and_transitive_alias(self):
        original = b'synthetic original presentation'
        (self.root / 'files/original.pptx').write_bytes(original)
        original_hash = hashlib.sha256(original).hexdigest()
        self.catalog[0]['files'].append({'local_path': 'files/original.pptx', 'sha256': original_hash})
        (self.root / 'files/alias.txt').write_bytes(original)
        alternate = b'synthetic alternate representation'
        (self.root / 'files/alternate.txt').write_bytes(alternate)
        alternate_hash = hashlib.sha256(alternate).hexdigest()
        self.catalog.append({'source_id': 'alias', 'files': [
            {'local_path': 'files/alias.txt', 'sha256': original_hash},
            {'local_path': 'files/alternate.txt', 'sha256': alternate_hash}]})
        for policy in ({'source_ids': ['alias']}, {'sha256': [original_hash]},
                       {'sha256': [alternate_hash]}, {'paths': ['files/alternate.txt']}):
            with self.subTest(policy=policy):
                self.policy()
                self.build()
                lineage = json.loads((self.output / 'lineage.json').read_text())
                self.assertEqual({s['source_id'] for s in lineage['sources']}, {'report', 'alias'})
                self.policy(**policy)
                self.assert_rejected('excluded')

    def test_hashes_actual_files_not_only_catalog_metadata(self):
        self.build()
        (self.root / 'files/report.txt').write_bytes(b'changed edition')
        self.assert_rejected('hash mismatch')

    def test_missing_malformed_policy_and_invalid_input_remove_stale_output_first(self):
        for invalid in ('missing', 'malformed', 'input'):
            self.policy()
            self.build()
            self.flush()
            if invalid == 'missing':
                (self.root / 'reports/privacy-exclusions.json').unlink()
            elif invalid == 'malformed':
                self.write(self.root / 'reports/privacy-exclusions.json', {})
            else:
                (self.inputs / 'schools.json').write_text('{')
            with self.assertRaises((ValueError, FileNotFoundError)):
                build_candidate(self.inputs, self.root, self.output)
            self.assertFalse(self.output.exists())

    def test_failed_output_write_cannot_leave_partial_candidate(self):
        self.flush()
        with patch('build_public_snapshot.os.replace', side_effect=OSError('synthetic failure')):
            with self.assertRaises(OSError):
                build_candidate(self.inputs, self.root, self.output)
        self.assertFalse(self.output.exists())
        self.assertFalse(list(self.base.glob('.candidate-*')))

    def make_derived(self):
        self.add_source('contributor')
        self.rows[0]['count_basis'] = 'derived_headcount'
        self.rows[1]['source_id'] = 'contributor'
        ref = lambda row: {k: row[k] for k in ('series_id', 'entity_id', 'school_year', 'grade_scope')}
        self.derivations['derivations'] = [{'output': ref(self.rows[0]), 'kind': 'district',
                                          'contributors': [{'observation': ref(self.rows[1])}]}]

    def test_derived_contributor_exclusion_invalidates_whole_candidate(self):
        self.make_derived()
        self.build()
        self.policy(source_ids=['contributor'])
        self.assert_rejected('excluded')

    def test_derived_requires_complete_nonoverlapping_compatible_numeric_contributors(self):
        self.make_derived()
        original = copy.deepcopy(self.rows)
        for change in ({'reference_date': '2025-10-02'}, {'grade_scope': 'PK'},
                       {'value': '', 'value_state': 'suppressed'}, {'value': '11'}):
            with self.subTest(change=change):
                self.rows = copy.deepcopy(original)
                self.rows[1].update(change)
                self.assert_rejected('reconcil|contributor|enrollment ref|reference date')
        self.rows = original
        self.derivations['derivations'][0]['contributors'] *= 2
        self.assert_rejected('overlap|duplicate')

    def test_reported_district_sum_rejects_wrong_value_scope_or_date(self):
        for change in ({'value': '11'}, {'reference_date': '2025-10-02'}, {'grade_scope': 'K-6'}):
            with self.subTest(change=change):
                original = self.rows[1]
                self.rows[1] = original | change
                self.assert_rejected('reconcil|enrollment ref|reference date')
                self.rows[1] = original

    def test_school_fact_only_source_and_allowed_procedural_reference(self):
        self.add_source('minutes')
        self.register['campuses'][0]['sources'].append({'source_id': 'minutes', 'source_locator': 'p1; procedural reference'})
        self.build()
        self.assertIn('executive session occurred', self.payload()['notes'][0])
        self.policy(source_ids=['minutes'])
        self.assert_rejected('excluded')

    def test_unknown_date_and_forecast_numeric_state_do_not_become_observed_history(self):
        self.projections = [self.row('huusd', 15, series_id='nesdec-2026-k12', school_year='2026-27',
                                    reference_date='', population_basis='nesdec_2026_projected_enrollment',
                                    count_basis='projected_headcount', status='projection') | {
                                        'forecast_vintage': '2026-01-09-v2', 'author': 'NESDEC',
                                        'base_year': '2025-26', 'horizon': '2026-27 through 2035-36',
                                        'assumptions': 'Published supplied-base forecast.'}]
        self.build()
        forecast = self.payload()['projections'][0]
        self.assertEqual(forecast['status'], 'projection')
        self.assertEqual(forecast['value_state'], 'observed')
        self.assertIsNone(forecast['reference_date'])
        self.assertEqual(forecast['reference_date_status'], 'unknown')

    def test_public_pk_reconciles_without_inferring_suppressed_components(self):
        self.rows.extend([self.row('huusd', 4, series_id='public-pk-october', grade_scope='PK', population_basis='attending_public_pk'),
                          self.row('school', 3, series_id='public-pk-october', grade_scope='PK', population_basis='attending_public_pk')])
        self.assert_rejected('reconciliation')
        self.rows[-1].update(value='', value_state='suppressed')
        self.build()
        self.assertIsNone(next(r for r in self.payload()['enrollment'] if r['value_state'] == 'suppressed')['value'])

    def test_inline_derived_contributors_cannot_relabel_a_combined_total_as_a_grade(self):
        self.rows[1]['count_basis'] = 'derived_headcount'
        self.derivations['derivations'] = [{'output': self.register['schools'][0]['current_enrollment_ref'],
            'kind': 'grades', 'contributors': [self.ref | {'grade_scope': 'K-12', 'value': 10}]}]
        self.assert_rejected('grade cell')

    def test_grade_sum_checks_values_completeness_and_overlap(self):
        self.rows += [self.row('school', 10 if g == 'K' else 0, grade_scope=g)
                      for g in ['K'] + [str(n) for n in range(1, 13)]]
        self.build()
        self.rows[-1]['value'] = '1'
        self.assert_rejected('reconciliation sum mismatch')
        self.rows.pop()
        self.assert_rejected('incomplete grade scope')

    def test_lineage_uuid_normalization_and_significant_non_uuid_ids(self):
        compact = '123456781234123412341234567890ab'
        dashed = '12345678-1234-1234-1234-1234567890AB'
        self.add_source(compact)
        self.sources[-1]['source_id'] = dashed
        self.register['campuses'][0]['sources'].append({'source_id': dashed, 'source_locator': 'p1'})
        self.build()
        self.policy(source_ids=[dashed])
        self.assert_rejected('excluded')
        self.policy(source_ids=['REPORT'])
        self.build()  # Non-UUID case remains significant.

    def test_portable_paths_reject_traversal_and_symlinks(self):
        original = self.catalog[0]['files'][0]['local_path']
        self.catalog[0]['files'][0]['local_path'] = '../outside.txt'
        self.assert_rejected('portable path')
        self.catalog[0]['files'][0]['local_path'] = original
        (self.root / 'files/linked.txt').symlink_to(self.root / original)
        self.catalog[0]['files'][0]['local_path'] = 'files/linked.txt'
        self.assert_rejected('symlink')

    def test_mixed_consultant_history_cannot_become_a_common_line(self):
        for year, value in [('2023-24', 1612), ('2024-25', 1613)]:
            self.rows.append(self.row('huusd', value, series_id='nesdec-2026-history',
                school_year=year, reference_date='', population_basis='nesdec_2026_as_supplied_history'))
        self.build()
        groups = [s for s in self.payload()['series'] if s['series_id'] == 'nesdec-2026-history']
        self.assertEqual(len(groups), 1)
        self.assertFalse(groups[0]['connect_points'])
        self.assertEqual([r['value'] for r in self.payload()['enrollment'] if r['series_id'] == 'nesdec-2026-history'], [1612, 1613])

    def test_internal_review_note_and_original_hash_annotation_are_not_public(self):
        self.register['notes'].append('These are reviewed candidate inputs. Catalog additions, host validation and the publication lifecycle are required before runtime use. No app or database release is implied by this file.')
        self.sources[0]['locators'] = ['p1; aggregate table. Original PPTX SHA-256 023bff7751682ef0f79c5bfff74f9ac38e956e85c3e4f4bab4fe23e23ea58d78; both editions are in the catalog.']
        self.build()
        self.assertEqual(len(self.payload()['notes']), 1)
        self.assertEqual(self.payload()['sources'][0]['locators'], ['p1; aggregate table.'])

    def test_unknown_csv_field_rejected_before_candidate_creation(self):
        self.flush()
        path = self.inputs / 'enrollment.csv'
        path.write_text(path.read_text().replace(',notes\n', ',private_notes\n'))
        with self.assertRaisesRegex(ValueError, 'unknown fields'):
            build_candidate(self.inputs, self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_reviewed_pk_inclusive_partition_is_checked_without_merging_series(self):
        base = self.row('huusd', 10, series_id='district-2017', school_year='2017-18',
                        reference_date='2017-10-01', grade_scope='K-12+',
                        population_basis='district_2017_all_attending_12plus')
        inclusive = base | {'series_id': 'district-2017-pk-inclusive', 'grade_scope': 'PK-12+',
                            'population_basis': 'district_2017_pk_inclusive', 'value': '13'}
        self.rows.extend([base, inclusive])
        ref = lambda row: {k: row[k] for k in ('series_id', 'entity_id', 'school_year', 'grade_scope')}
        self.derivations['reconciliations'] = [{'output': ref(inclusive), 'kind': 'pk_inclusive', 'contributors': [
            {'observation': ref(base)}, self.ref | {'entity_id': 'school', 'grade_scope': 'PK', 'value': 3}]}]
        self.build()
        self.assertEqual(len([s for s in self.payload()['series'] if s['series_id'].startswith('district-2017')]), 2)
        self.derivations['reconciliations'][0]['contributors'][1]['value'] = 4
        self.assert_rejected('reconciliation sum mismatch')

    def test_numeric_october_series_requires_its_date_but_preliminary_can_be_unknown(self):
        for row in self.rows:
            row['reference_date'] = ''
        self.assert_rejected('reference date')
        for row in self.rows:
            row.update(series_id='september-2026-preliminary', school_year='2026-27',
                       population_basis='preliminary_reported_enrollment', status='preliminary')
        for key in ('current_enrollment_ref', 'latest_attending_enrollment_ref'):
            self.register['schools'][0][key] = {'series_id': 'september-2026-preliminary',
                'entity_id': 'school', 'school_year': '2026-27', 'grade_scope': 'K-12'}
        self.build()
        self.assertTrue(all(r['reference_date'] is None and r['reference_date_status'] == 'unknown'
                            for r in self.payload()['enrollment']))

    def test_current_grade_configuration_and_program_refs_are_consistent(self):
        self.register['schools'][0]['grade_configurations'][0]['grade_scope'] = 'K-6'
        self.assert_rejected('grade configuration')
        self.register['schools'][0]['grade_configurations'][0]['grade_scope'] = 'K-12'
        program = {'program_id': 'pk', 'name': 'Public preschool', 'school_id': 'school',
                   'campus_id': 'campus', 'grade_scope': 'PK', 'school_year': '2025-26',
                   'current_enrollment_ref': None, 'value_state': 'missing', 'sources': [self.ref],
                   'notes': 'No current headcount.'}
        self.register['programs'] = [program]
        self.build()
        self.assertEqual(self.payload()['programs'][0]['value_state'], 'missing')
        program['current_enrollment_ref'] = self.register['schools'][0]['current_enrollment_ref']
        self.assert_rejected('program enrollment ref')

    def test_nested_public_text_cannot_leak_archive_paths(self):
        self.register['schools'][0]['aliases'] = ['Former school', '/rocky/open-valley/private-note.txt']
        self.assert_rejected('private path/hash')


if __name__ == '__main__':
    unittest.main()
