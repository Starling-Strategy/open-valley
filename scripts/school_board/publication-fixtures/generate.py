"""Create a synthetic U3 collection/inputs/candidate for isolated DB/UI checks."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_public_snapshot import build_candidate


def generate(base, browser=False):
    base = base.resolve()
    root, inputs = base / 'collection', base / 'inputs'
    for directory in (root / 'files', root / 'catalog', root / 'reports', inputs):
        directory.mkdir(parents=True, exist_ok=False)

    def write(path, data):
        path.write_text(json.dumps(data), encoding='utf-8')

    content = b'Synthetic aggregate report. Not HUUSD evidence.'
    original = b'Synthetic original presentation. Not HUUSD evidence.'
    for name, data in [('report.txt', content), ('original.txt', original), ('alias.txt', original)]:
        (root / 'files' / name).write_bytes(data)
    digest, original_digest = hashlib.sha256(content).hexdigest(), hashlib.sha256(original).hexdigest()
    write(root / 'reports/privacy-exclusions.json', {'schema_version': 1, 'source_ids': [], 'paths': [], 'sha256': []})
    write(root / 'catalog/summary.json', {'generated_at': '2026-10-04T00:00:00+00:00'})
    write(root / 'catalog/sources.json', [
        {'source_id': 'report', 'url': 'https://huusd.org/synthetic-example', 'files': [{'local_path': 'files/report.txt', 'sha256': digest},
                                         {'local_path': 'files/original.txt', 'sha256': original_digest}]},
        {'source_id': 'alias', 'files': [{'local_path': 'files/alias.txt', 'sha256': original_digest}]}])
    ref = {'source_id': 'report', 'source_locator': 'p1; synthetic table'}
    observation = {'series_id': 'attending-october', 'entity_id': 'school', 'school_year': '2025-26', 'grade_scope': 'K-12'}
    register = {
        'updated_at': '2026-10-04',
        'campuses': [{'campus_id': 'campus', 'name': 'Synthetic school', 'address': '1 Example Street',
                      'physical_town': 'Waterbury', 'latitude': 44.3, 'longitude': -72.7,
                      'state_school_id': 'SYNTHETIC', 'sources': [ref], 'notes': 'Synthetic preview only.'}],
        'schools': [{'school_id': 'school', 'name': 'Synthetic school', 'campus_id': 'campus',
                     'directory_school_id': 'school', 'state_school_id': 'SYNTHETIC', 'aliases': [],
                     'grade_configurations': [{'school_year': '2025-26', 'grade_scope': 'K-12', 'verified_at': '2026-10-04', **ref}],
                     'usual_next_school_ids': [], 'pathway_note': 'Synthetic example only.', 'sources': [ref],
                     'current_enrollment_ref': observation, 'latest_attending_enrollment_ref': observation}],
        'programs': [], 'notes': ['Synthetic preview. These are not HUUSD enrollment figures.']}
    write(inputs / 'sources.json', [{'source_id': 'report', 'title': 'Synthetic report — not evidence',
        'url': 'https://huusd.org/synthetic-example', 'published_at': '2025-10-02', 'sha256': digest,
        'reviewed_at': '2026-10-04', 'public_eligible': True, 'locators': ['p1; synthetic table']}])
    fields = 'series_id entity_id school_year reference_date grade_scope population_basis count_basis value value_state status source_id source_locator notes'.split()
    rows = [dict(series_id='attending-october', entity_id=entity, school_year='2025-26',
                 reference_date='2025-10-01', grade_scope='K-12', population_basis='attending_excludes_early_college',
                 count_basis='reported_headcount', value=10, value_state='observed', status='observed',
                 source_id='report', source_locator='p1; synthetic table', notes='Synthetic preview only.')
            for entity in ('huusd', 'school')]
    projections = []
    if browser:
        # Distinct reporting groups share one physical campus, not students.
        school = register['schools'][0]
        register['schools'].append({
            **school, 'school_id': 'school-shared', 'name': 'Synthetic shared-campus group',
            'directory_school_id': 'school-shared',
            'pathway_note': 'Synthetic separate reporting group at the same campus; no overlapping students.'})
        template = rows[1]
        rows = []
        history = [
            ('2021-22', 8, 3, 11, 'observed'),
            ('2022-23', 0, 4, 4, 'observed'),
            ('2023-24', '', '', '', 'missing'),
            ('2024-25', '', '', '', 'suppressed'),
            ('2025-26', 10, 4, 14, 'observed'),
        ]
        for year, first, second, district, state in history:
            for entity, value in (('school', first), ('school-shared', second), ('huusd', district)):
                # Do not expose totals from which a suppressed group could be inferred.
                value_state = 'missing' if state == 'suppressed' and entity != 'school' else state
                rows.append({**template, 'entity_id': entity, 'school_year': year,
                             'reference_date': year[:4] + '-10-01', 'value': value, 'value_state': value_state})
        for entity, value in (('school', 11), ('school-shared', 5), ('huusd', 16)):
            rows.append({**template, 'series_id': 'september-2026-preliminary', 'entity_id': entity,
                         'school_year': '2026-27', 'reference_date': '',
                         'population_basis': 'preliminary_reported_enrollment', 'value': value,
                         'status': 'preliminary',
                         'notes': 'Synthetic preliminary count only; exact reference day unknown. Not HUUSD evidence.'})
        for school in register['schools']:
            school['grade_configurations'] = [
                {'school_year': year, 'grade_scope': 'K-12', 'verified_at': '2026-10-04', **ref}
                for year in [row[0] for row in history] + ['2026-27']]
            school['latest_attending_enrollment_ref'] = {**observation, 'entity_id': school['school_id']}
            school['current_enrollment_ref'] = {
                **observation, 'series_id': 'september-2026-preliminary',
                'entity_id': school['school_id'], 'school_year': '2026-27'}
        for year, k12, pk in [('2026-27', 18, 6), ('2027-28', 19, 7), ('2028-29', 20, 8)]:
            for series, scope, basis, value in (
                ('nesdec-2026-k12', 'K-12', 'nesdec_2026_projected_enrollment', k12),
                ('nesdec-2026-pk', 'PK', 'nesdec_2026_projected_pk', pk),
            ):
                projections.append({
                    **template, 'series_id': series, 'entity_id': 'huusd', 'school_year': year,
                    'reference_date': '', 'grade_scope': scope, 'population_basis': basis,
                    'count_basis': 'projected_headcount', 'value': value, 'status': 'projection',
                    'forecast_vintage': 'Synthetic 2026 edition', 'author': 'Synthetic consultant, not NESDEC',
                    'base_year': '2025-26', 'horizon': '2026-27 through 2028-29',
                    'assumptions': 'Invented preview counts, not HUUSD or NESDEC evidence. PK and K-12 populations are separate; neither is joined to attending history.'})
    write(inputs / 'schools.json', register)
    for name, data, header in [('enrollment.csv', rows, fields),
                               ('projections.csv', projections, fields + 'forecast_vintage author base_year horizon assumptions'.split())]:
        with (inputs / name).open('w', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=header)
            writer.writeheader()
            writer.writerows(data)
    write(inputs / 'derivations.json', {'schema_version': 1, 'derivations': [], 'reconciliations': []})
    build_candidate(inputs, root, base / 'candidate')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base', type=Path)
    parser.add_argument('--browser', action='store_true', help='Include shared-campus, history and forecast examples')
    args = parser.parse_args()
    generate(args.base, browser=args.browser)
    print('Synthetic collection, reviewed inputs and candidate created.')
