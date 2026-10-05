"""Build a schema-v1 publication candidate. No network, database, or catalog writes.

Only payload.json is public. candidate.json and lineage.json are publisher-only.
See README.md for canonical encoding, digest and publication/withdrawal contracts.
"""
import argparse
from collections import defaultdict
import csv
from datetime import date, datetime
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile
from urllib.parse import parse_qsl, urlsplit

from privacy_rules import canonical_id, load_rules


REPO = Path(__file__).resolve().parents[2]
SCHEMA_PATH = REPO / 'data/school-board/public/schema.json'
FIELDS = 'series_id entity_id school_year reference_date grade_scope population_basis count_basis value value_state status source_id source_locator notes'.split()
FORECAST_FIELDS = FIELDS + 'forecast_vintage author base_year horizon assumptions'.split()
REF_FIELDS = 'series_id entity_id school_year grade_scope'.split()
KEY_FIELDS = 'series_id entity_id school_year reference_date grade_scope population_basis count_basis'.split()
SERIES_FIELDS = 'series_id entity_id grade_scope population_basis count_basis'.split()
HASH = re.compile(r'[0-9a-f]{64}')
GRADES = ['PK', 'K'] + [str(n) for n in range(1, 13)] + ['12+', 'UNGR']
OFFICIAL_HOSTS = {
    'huusd.org', 'bps.huusd.org', 'cbms.huusd.org', 'faystonschool.org',
    'moretownschool.org', 'waitsfieldschool.org', 'warrenschool.org', 'harwood.org',
    'maps.vcgi.vermont.gov', 'education.vermont.gov', 'datacollection.education.vermont.gov',
}
# Meaning established by U1/U2. A new series requires an explicit definition here.
# count_basis remains a separate key even when reported/derived values reconcile.
SERIES = {
    'attending-october': ('attending_excludes_early_college', True,
        'October 1 counts of students attending grades K–12. Includes students entering through tuition or school choice and students in dual enrollment; excludes fully offsite Early College students. This definition is established from 2021–22 onward; earlier years have no verified count under this definition. Final certification has not been established.'),
    'wwsu-2016': ('wwsu_reported_all_enrollment', False,
        '2016–17 predecessor WWSU enrollment, excluding PK; Early College treatment unstated. Separate historical segment.'),
    'district-2017': ('district_2017_all_attending_12plus', False,
        'The 2017–18 district all-attending column covers K–12+ and excludes PK. The meaning of 12+ and the treatment of Early College remain unresolved.'),
    'district-2017-pk-inclusive': ('district_2017_pk_inclusive', False,
        '2017–18 printed district total includes PK despite its K–12 label; separate from K–12+.'),
    'nesdec-2018-history': ('nesdec_2018_supplied_enrollment', False,
        '2018–19 school-supplied historical counts; exact count date and Early College treatment unverified. Not projections.'),
    'district-retrospective-2019-2020': ('district_2021_reported_history', False,
        'October counts for 2019–20 and 2020–21, reprinted in 2021. The rules for who was included at the time have not been verified, so these are shown as separate historical points.'),
    'district-headline-ec-inclusive': ('reported_including_early_college', True,
        'The district headline totals report earlier K–12 enrollment and include Early College. They are separate from attending counts.'),
    'nesdec-2026-history': ('nesdec_2026_as_supplied_history', False,
        'Historical counts as supplied to NESDEC do not consistently include Early College. The 2023–24 count is seven above the district headline total, with no explanation for the difference. These counts are shown in a table or as separate points because they cannot form a consistent trend line.'),
    'nesdec-2026-pk-history': ('nesdec_2026_supplied_pk', False,
        'Historical public and private PK counts supplied by the consultant. These are not counts of students attending public campuses. Differences between historical editions remain unresolved.'),
    'public-pk-october': ('attending_public_pk', False,
        'Counts of students attending public-school PK, kept separate from K–12 enrollment and district-funded public and private PK.'),
    'september-2026-preliminary': ('preliminary_reported_enrollment', False,
        'A preliminary September 2026 snapshot of K–12 enrollment. The exact count day and treatment of Early College have not been verified. The available information does not support calculating changes from a baseline.'),
    'nesdec-2026-k12': ('nesdec_2026_projected_enrollment', True,
        'The separate NESDEC January 9, 2026 v2 forecast uses a 2025–26 base of 1,591 that includes Early College. The attending count of 1,578 excludes Early College. These populations differ, so the forecast is shown separately from attending history rather than joined to it.'),
    'nesdec-2026-pk': ('nesdec_2026_projected_pk', True,
        'The separate NESDEC January 9, 2026 v2 forecast covers public and private PK. Its base is 196, rather than the public-campus attendance count of 127. It does not allocate students to individual schools.'),
}
INTERNAL_REGISTER_NOTE = ('These are reviewed candidate inputs. Catalog additions, host validation and the publication lifecycle are required before runtime use. No app or database release is implied by this file.')
# These exact U2 edition annotations belong only to publisher metadata, not citations.
INTERNAL_LOCATOR_SUFFIXES = (
    " Catalog title was 'here'.", " Catalog title was 'at this link'.",
    ' Original PPTX SHA-256 023bff7751682ef0f79c5bfff74f9ac38e956e85c3e4f4bab4fe23e23ea58d78; both editions are in the catalog.',
)


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f'{path.name}: duplicate JSON field {key}')
            result[key] = value
        return result
    return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique_pairs)


def require(condition, label, message):
    if not condition:
        raise ValueError(f'{label}: {message}')


def fields(value, required, label, optional=()):
    require(isinstance(value, dict), label, 'expected object')
    require(not (set(value) - set(required) - set(optional)), label, 'unknown fields')
    require(set(required) <= set(value), label, 'missing fields: ' + ', '.join(sorted(set(required) - set(value))))


def text(value, label, empty=False):
    require(isinstance(value, str) and (empty or bool(value.strip())), label, 'expected text')
    # Reviewed prose is permitted; archive metadata and raw hashes are not public prose.
    require(not re.search(r'(?i)(?:/rocky/|/home/|file://|(?:archive|supplements)/|[0-9a-f]{64})', value),
            label, 'private path/hash in public text')
    return value


def iso_date(value, label, nullable=False):
    if nullable and value is None:
        return
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', value), label, 'invalid date')
    try:
        date.fromisoformat(value)
    except ValueError:
        raise ValueError(f'{label}: invalid date') from None


def school_year(value, label):
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}', value), label, 'invalid school year')
    require((int(value[:4]) + 1) % 100 == int(value[-2:]), label, 'invalid school year')


def grade_set(scope, label):
    require(isinstance(scope, str), label, 'invalid grade scope')
    if scope in GRADES:
        return {scope}
    ends = scope.split('-')
    require(len(ends) == 2 and all(x in GRADES[:-1] for x in ends), label, 'invalid grade scope')
    start, end = (GRADES.index(x) for x in ends)
    require(start < end, label, 'invalid grade scope')
    # 12+ replaces 12; it is not an additional grade to add to grade 12.
    return set(GRADES[start:end + 1]) - ({'12'} if ends[-1] == '12+' else set())


def validate_shape(value, spec, schema, label):
    """Validate the small vocabulary used by our committed closed public schema."""
    if '$ref' in spec:
        spec = schema['$defs'][spec['$ref'].removeprefix('#/$defs/')]
    types = spec.get('type', [])
    types = [types] if isinstance(types, str) else types
    valid_types = {'object': isinstance(value, dict), 'array': isinstance(value, list),
                   'string': isinstance(value, str), 'null': value is None,
                   'integer': type(value) is int, 'boolean': type(value) is bool,
                   'number': type(value) in (int, float) and math.isfinite(value)}
    require(not types or any(valid_types[t] for t in types), label, 'invalid type')
    if 'const' in spec:
        require(value == spec['const'], label, 'invalid constant')
    if 'enum' in spec:
        require(value in spec['enum'], label, 'invalid value')
    if isinstance(value, dict):
        fields(value, spec.get('required', []), label, spec.get('properties', {}).keys())
        for key, item in value.items():
            validate_shape(item, spec['properties'][key], schema, label + '.' + key)
    if isinstance(value, list):
        require(len(value) >= spec.get('minItems', 0), label, 'empty array')
        if spec.get('uniqueItems'):
            require(len({canonical_json(x) for x in value}) == len(value), label, 'duplicate values')
        for index, item in enumerate(value):
            validate_shape(item, spec['items'], schema, f'{label}[{index}]')
    if isinstance(value, str):
        if label != 'payload.content_digest':
            text(value, label, empty=True)
        require(len(value) >= spec.get('minLength', 0), label, 'empty string')
        if 'pattern' in spec:
            require(re.search(spec['pattern'], value), label, 'invalid format')
        if spec.get('format') == 'date':
            iso_date(value, label)
    if type(value) in (int, float):
        require(value >= spec.get('minimum', -math.inf) and value <= spec.get('maximum', math.inf), label, 'out of range')


def url_identity(url, source_id, label):
    text(url, label)
    parts = urlsplit(url)
    require(parts.scheme == 'https' and parts.hostname and not parts.username and not parts.password
            and parts.port in (None, 443) and not parts.fragment and not re.search(r'[\s\\]', url),
            label, 'source URL must be official public HTTPS')
    host = parts.hostname.removeprefix('www.')
    if host in ('drive.google.com', 'docs.google.com'):
        pattern = r'/file/d/([^/]+)/view' if host == 'drive.google.com' else r'/(?:presentation|document|spreadsheets)/d/([^/]+)/(?:edit|view)'
        match = re.fullmatch(pattern, parts.path)
        require(match and match[1] == source_id, label, 'source URL identity mismatch')
        # Sharing query parameters vary without changing the reviewed Drive identity.
        return host, source_id
    require(host in OFFICIAL_HOSTS, label, 'source URL must be official public HTTPS')
    return host, parts.path, tuple(sorted(parse_qsl(parts.query, keep_blank_values=True)))


def local_file(root, relative, label):
    require(isinstance(relative, str) and relative and '\\' not in relative, label, 'invalid portable path')
    path = PurePosixPath(relative)
    require(not path.is_absolute() and '..' not in path.parts and str(path) == relative,
            label, 'invalid portable path')
    target = root
    for part in path.parts:
        target /= part
        require(not target.is_symlink(), label, 'symlink source path')
    require(target.is_file(), label, 'missing source file')
    return target


def resolve_sources(reviewed, catalog, root, rules):
    require(isinstance(reviewed, list) and reviewed, 'sources', 'empty source register')
    require(isinstance(catalog, list), 'catalog', 'expected source array')
    by_id, by_hash, by_path = defaultdict(set), defaultdict(set), defaultdict(set)
    for index, record in enumerate(catalog):
        by_id[canonical_id(record['source_id'])].add(index)
        for file in record.get('files', []):
            by_hash[file.get('sha256')].add(index)
            by_path[file.get('local_path')].add(index)
    excluded_ids = {canonical_id(x) for x in rules['source_ids']}
    excluded_paths, excluded_hashes = set(rules['paths']), set(rules['sha256'])
    selected, public = set(), {}
    for source in reviewed:
        label = 'source ' + str(source.get('source_id', '?'))
        fields(source, 'source_id title url published_at sha256 reviewed_at public_eligible locators'.split(), label)
        sid = canonical_id(source['source_id'])
        require(sid not in public, label, 'duplicate source identity')
        require(source['public_eligible'] is True, label, 'source lacks public eligibility review')
        require(isinstance(source['sha256'], str) and HASH.fullmatch(source['sha256']), label, 'invalid source edition hash')
        iso_date(source['published_at'], label, nullable=True)
        iso_date(source['reviewed_at'], label)
        identity = url_identity(source['url'], source['source_id'], label)
        indices = by_id.get(sid, set())
        require(indices, label, 'unknown source in current catalog')
        require(any(identity == url_identity(catalog[i].get('url', ''), source['source_id'], label) for i in indices),
                label, 'catalog/source URL mismatch')
        require(any(f.get('sha256') == source['sha256'] for i in indices for f in catalog[i].get('files', [])),
                label, 'reviewed source edition not in catalog')
        selected.update(indices)
        require(isinstance(source['locators'], list) and source['locators'], label, 'missing source locator')
        locators = []
        for locator in source['locators']:
            for suffix in INTERNAL_LOCATOR_SUFFIXES:
                if isinstance(locator, str) and locator.endswith(suffix):
                    locator = locator[:-len(suffix)]
            locators.append(text(locator, label + '.locators'))
        public[sid] = {'source_id': sid, 'title': text(source['title'], label), 'url': source['url'],
                       'published_at': source['published_at'], 'reviewed_at': source['reviewed_at'], 'locators': locators}
    # Follow every representation and content/path alias to a fixed point. This
    # is metadata-only discovery; catalog observations never enter output.
    pending = list(selected)
    while pending:
        record = catalog[pending.pop()]
        neighbors = set(by_id[canonical_id(record['source_id'])])
        for file in record.get('files', []):
            if file.get('sha256'):
                neighbors.update(by_hash[file['sha256']])
            if file.get('local_path'):
                neighbors.update(by_path[file['local_path']])
        added = neighbors - selected
        pending.extend(added)
        selected.update(added)
    files_by_id, actual_hashes = defaultdict(dict), {}
    for index in sorted(selected):
        record = catalog[index]
        sid = canonical_id(record['source_id'])
        label = 'source ' + sid
        require(sid not in excluded_ids, label, 'excluded source identity')
        require(record.get('files'), label, 'source has no local edition')
        for file in record['files']:
            path, expected = file.get('local_path'), file.get('sha256')
            require(isinstance(expected, str) and HASH.fullmatch(expected), label, 'missing source hash')
            require(path not in excluded_paths and expected not in excluded_hashes, label, 'excluded source path/hash')
            target = local_file(root, path, label)
            if path not in actual_hashes:
                with target.open('rb') as stream:
                    actual_hashes[path] = hashlib.file_digest(stream, 'sha256').hexdigest()
            actual = actual_hashes[path]
            require(actual not in excluded_hashes, label, 'excluded source bytes')
            require(actual == expected, label, 'source file hash mismatch; re-review edition')
            files_by_id[sid][path] = actual
    lineage = [{'source_id': sid, 'files': [{'path': path, 'sha256': h} for path, h in sorted(files.items())]}
               for sid, files in sorted(files_by_id.items())]
    return public, lineage


def citation(ref, sources, label):
    sid = canonical_id(ref['source_id'])
    require(sid in sources, label, 'unknown source')
    ref['source_id'] = sid
    text(ref['source_locator'], label + '.source_locator')


def csv_rows(path, expected):
    with path.open(encoding='utf-8', newline='') as stream:
        reader = csv.DictReader(stream)
        require(reader.fieldnames == expected, path.name, 'missing, duplicate, reordered, or unknown fields')
        for number, row in enumerate(reader, 2):
            require(None not in row and all(v is not None for v in row.values()), f'{path.name}:{number}', 'invalid CSV row')
            yield row, f'{path.name}:{number}'


def observation_key(row):
    return tuple(row[k] for k in KEY_FIELDS)


def ref_key(row):
    return tuple(row[k] for k in REF_FIELDS)


def observation_id(row):
    return '|'.join(row[k] or 'unknown' for k in KEY_FIELDS)


def observations(path, sources, entities, forecast=False):
    result, seen = [], set()
    for raw, label in csv_rows(path, FORECAST_FIELDS if forecast else FIELDS):
        row = dict(raw)
        require(row['entity_id'] in entities, label, 'unknown entity')
        require(row['series_id'] in SERIES, label, 'unknown series definition')
        require(row['population_basis'] == SERIES[row['series_id']][0], label, 'incompatible population basis for series')
        school_year(row['school_year'], label)
        row['reference_date'] = row['reference_date'] or None
        iso_date(row['reference_date'], label, nullable=True)
        if row['reference_date']:
            year = int(row['school_year'][:4])
            require(f'{year}-07-01' <= row['reference_date'] <= f'{year + 1}-06-30', label, 'reference date outside school year')
        grade_set(row['grade_scope'], label)
        require(row['status'] in (('projection',) if forecast else ('observed', 'preliminary', 'final')), label, 'invalid status')
        require(row['count_basis'] in (('projected_headcount',) if forecast else ('reported_headcount', 'derived_headcount')), label, 'invalid headcount basis')
        is_forecast_series = row['series_id'] in ('nesdec-2026-k12', 'nesdec-2026-pk')
        require(is_forecast_series == forecast, label, 'forecast/history series mismatch')
        require(row['value_state'] in ('observed', 'missing', 'suppressed', 'not_applicable'), label, 'invalid value_state')
        if row['value_state'] == 'observed':
            require(re.fullmatch(r'0|[1-9][0-9]*', row['value']), label, 'invalid headcount value')
            row['value'] = int(row['value'])
            require(row['value'] <= 9007199254740991, label, 'headcount outside exact JSON integer range')
            if row['series_id'] in ('attending-october', 'public-pk-october'):
                require(row['reference_date'] == row['school_year'][:4] + '-10-01',
                        label, 'October-series numeric value requires October 1 reference date')
        else:
            require(row['value'] == '', label, 'value_state requires blank value, never zero or inferred value')
            row['value'] = None
        citation(row, sources, label)
        text(row['notes'], label + '.notes', empty=True)
        if forecast:
            for field in FORECAST_FIELDS[len(FIELDS):]:
                text(row[field], label + '.' + field)
            school_year(row['base_year'], label)
            require(row['base_year'] < row['school_year'], label, 'forecast must follow base year')
            require(sources[row['source_id']]['published_at'] is not None, label, 'forecast requires source publication date')
            horizon = row['horizon'].split(' through ')
            require(len(horizon) == 2, label, 'invalid forecast horizon')
            for year in horizon:
                school_year(year, label)
            require(horizon[0] <= row['school_year'] <= horizon[1], label, 'outside forecast horizon')
        key = observation_key(row)
        require(key not in seen, label, 'duplicate observation key; select one reviewed edition')
        seen.add(key)
        row['observation_id'] = observation_id(row)
        row['reference_date_status'] = 'known' if row['reference_date'] else 'unknown'
        result.append(row)
    return sorted(result, key=lambda r: r['observation_id'])


def register_data(value, sources, schema):
    fields(value, 'updated_at campuses schools programs notes'.split(), 'schools.json')
    iso_date(value['updated_at'], 'schools.json.updated_at')
    indices = {}
    for kind, id_field in (('campuses', 'campus_id'), ('schools', 'school_id'), ('programs', 'program_id')):
        require(isinstance(value[kind], list), kind, 'expected array')
        index = {}
        for item in value[kind]:
            label = kind + ':' + str(item.get(id_field, '?'))
            validate_shape(item, schema['$defs']['campus' if kind == 'campuses' else kind[:-1]], schema, label)
            require(item[id_field] not in index, label, 'duplicate entity')
            index[item[id_field]] = item
            for ref in item['sources']:
                citation(ref, sources, label)
            for key, field in item.items():
                if isinstance(field, str):
                    text(field, label + '.' + key, empty=True)
        indices[kind] = index
    require(indices['campuses'] and indices['schools'], 'schools.json', 'empty school/campus register')
    require(not (set(indices['schools']) & set(indices['programs'])) and 'huusd' not in indices['schools']
            and 'huusd' not in indices['programs'], 'schools.json', 'duplicate entity')
    for sid, school in indices['schools'].items():
        require(school['campus_id'] in indices['campuses'], sid, 'unknown campus')
        require(all(s in indices['schools'] and s != sid for s in school['usual_next_school_ids']), sid, 'unknown/self pathway school')
        configurations = set()
        for config in school['grade_configurations']:
            school_year(config['school_year'], sid)
            grade_set(config['grade_scope'], sid)
            require(config['school_year'] not in configurations, sid, 'duplicate grade configuration')
            configurations.add(config['school_year'])
            citation(config, sources, sid)
    for pid, program in indices['programs'].items():
        require(program['school_id'] in indices['schools'], pid, 'unknown program school')
        require(program['campus_id'] is None or program['campus_id'] in indices['campuses'], pid, 'unknown program campus')
        school_year(program['school_year'], pid)
        if program['grade_scope'] is not None:
            grade_set(program['grade_scope'], pid)
    require(isinstance(value['notes'], list), 'schools.json.notes', 'expected array')
    value['notes'] = [text(note, 'schools.json.notes') for note in value['notes'] if note != INTERNAL_REGISTER_NOTE]
    return indices


def lookup_ref(ref, rows, label):
    fields(ref, REF_FIELDS, label)
    matches = [row for row in rows if ref_key(row) == ref_key(ref)]
    require(len(matches) == 1, label, 'unknown or ambiguous enrollment ref')
    return matches[0]


def validate_enrollment_refs(register, rows):
    for school in register['schools']:
        for field in ('current_enrollment_ref', 'latest_attending_enrollment_ref'):
            if school[field] is None:
                continue
            row = lookup_ref(school[field], rows, school['school_id'] + ' enrollment ref')
            require(row['entity_id'] == school['school_id'], field, 'enrollment ref points to another entity')
            for config in school['grade_configurations']:
                if config['school_year'] == row['school_year']:
                    require(config['grade_scope'] == row['grade_scope'], school['school_id'],
                            'enrollment ref disagrees with dated grade configuration')
    for program in register['programs']:
        ref = program['current_enrollment_ref']
        if ref is not None:
            row = lookup_ref(ref, rows, program['program_id'] + ' enrollment ref')
            require(row['entity_id'] == program['program_id'] and row['school_year'] == program['school_year']
                    and row['grade_scope'] == program['grade_scope'] and row['value_state'] == program['value_state'],
                    program['program_id'], 'incompatible program enrollment ref')
        else:
            require(program['value_state'] != 'observed', program['program_id'], 'numeric program state requires enrollment ref')


def reconcile(output, contributors, kind, school_ids, label, must_compute=False):
    require(contributors, label, 'reconciliation has no contributors')
    seen, coverage, entities = set(), set(), set()
    partition_districts = 0
    target_grades = grade_set(output['grade_scope'], label)
    if kind == 'pk_inclusive':
        require(output['series_id'] == 'district-2017-pk-inclusive' and output['entity_id'] == 'huusd'
                and output['grade_scope'] == 'PK-12+', label, 'unreviewed PK-inclusive partition')
    for row in contributors:
        key = observation_key(row)
        require(key not in seen, label, 'duplicate contributor')
        seen.add(key)
        scope_fields = ('school_year', 'reference_date', 'status') if kind == 'pk_inclusive' else (
            'series_id', 'school_year', 'reference_date', 'population_basis', 'status')
        for field in scope_fields:
            require(row[field] == output[field], label, 'reconciliation incompatible ' + field)
        require(row['count_basis'] in ('reported_headcount', 'derived_headcount'), label, 'incompatible contributor count basis')
        # Unknown dates are only compatible in a single reviewed source table.
        if output['reference_date'] is None:
            require(row['source_id'] == output['source_id'], label, 'reconciliation unknown dates across sources')
        grades = grade_set(row['grade_scope'], label)
        require(grades <= target_grades, label, 'reconciliation incompatible grade scope')
        if kind == 'pk_inclusive':
            require(row['source_id'] == output['source_id'], label, 'PK partition requires same-source table')
            if row['entity_id'] == 'huusd':
                require(row['series_id'] == 'district-2017' and row['population_basis'] == 'district_2017_all_attending_12plus'
                        and grades == target_grades - {'PK'}, label, 'incompatible K–12+ partition')
                partition_districts += 1
                require(partition_districts == 1, label, 'overlapping district partition')
            else:
                require(row['entity_id'] in school_ids and grades == {'PK'} and row['entity_id'] not in entities,
                        label, 'overlapping or incompatible PK contributor')
                entities.add(row['entity_id'])
        elif kind == 'grades':
            require(row['entity_id'] == output['entity_id'], label, 'reconciliation incompatible entity')
            require(not (coverage & grades), label, 'overlapping grade contributors')
        else:
            require(output['entity_id'] == 'huusd' and row['entity_id'] in school_ids,
                    label, 'reconciliation requires nonoverlapping school groups, not combined/program totals')
            require(row['entity_id'] not in entities, label, 'overlapping school contributors')
            entities.add(row['entity_id'])
        coverage.update(grades)
    require(coverage == target_grades, label, 'reconciliation incomplete grade scope')
    if kind == 'pk_inclusive':
        require(partition_districts == 1 and entities, label, 'incomplete PK partition')
    if kind == 'district' and target_grades != {'PK'}:
        require(entities == set(school_ids), label, 'reconciliation incomplete school coverage')
    numeric = output['value_state'] == 'observed' and all(r['value_state'] == 'observed' for r in contributors)
    require(not must_compute or numeric, label, 'derived contributor missing or suppressed; cannot infer value')
    if numeric:
        require(sum(r['value'] for r in contributors) == output['value'], label, 'reconciliation sum mismatch')
    return {'observation_id': output['observation_id'], 'kind': kind,
            'contributor_ids': sorted(r['observation_id'] for r in contributors),
            'result': 'matched' if numeric else 'unavailable'}


def arithmetic(rows, document, school_ids, sources):
    fields(document, ('schema_version', 'derivations', 'reconciliations'), 'derivations.json')
    require(document['schema_version'] == 1, 'derivations.json', 'unsupported schema')
    derived, checks, private = set(), [], []
    for section in ('derivations', 'reconciliations'):
        require(isinstance(document[section], list), section, 'expected array')
        for entry in document[section]:
            fields(entry, ('output', 'kind', 'contributors'), section)
            output = lookup_ref(entry['output'], rows, section + ' output')
            label = section + ':' + output['observation_id']
            require(entry['kind'] in ('grades', 'district', 'pk_inclusive'), label, 'unknown reconciliation kind')
            if section == 'derivations':
                require(output['count_basis'] == 'derived_headcount', label, 'not a derived observation')
                require(output['observation_id'] not in derived, label, 'duplicate derivation')
                derived.add(output['observation_id'])
            require(isinstance(entry['contributors'], list), label, 'expected contributors')
            contributors = []
            for part in entry['contributors']:
                if 'observation' in part:
                    fields(part, ('observation',), label)
                    row = lookup_ref(part['observation'], rows, label + ' contributor')
                else:
                    inline_fields = ('source_id', 'source_locator', 'grade_scope', 'value')
                    if entry['kind'] == 'pk_inclusive':
                        inline_fields += ('entity_id',)
                    fields(part, inline_fields, label)
                    require(entry['kind'] in ('grades', 'pk_inclusive') and canonical_id(part['source_id']) == output['source_id'],
                            label, 'inline contributor must be same-source same-scope grade cell')
                    require(len(grade_set(part['grade_scope'], label)) == 1, label, 'inline contributor must be a single grade cell')
                    require(type(part['value']) is int and part['value'] >= 0, label, 'invalid contributor headcount')
                    citation(part, sources, label)
                    # Explicit same-table cells inherit date/entity/population, never free prose.
                    row = output | part | {'count_basis': 'reported_headcount', 'value_state': 'observed'}
                    row['observation_id'] = observation_id(row)
                require(row['observation_id'] != output['observation_id'], label, 'self contributor')
                contributors.append(row)
            checks.append(reconcile(output, contributors, entry['kind'], school_ids, label, section == 'derivations'))
            private.append({'output_id': output['observation_id'], 'kind': entry['kind'],
                            'contributors': [{k: row[k] for k in FIELDS if k != 'notes'} for row in contributors]})
    require(derived == {r['observation_id'] for r in rows if r['count_basis'] == 'derived_headcount'},
            'derivations.json', 'every derived observation requires structured contributors')
    # School totals and grade detail from each series/year must reconcile without
    # hiding differing dates/populations in separate grouping buckets.
    groups = defaultdict(list)
    for row in rows:
        groups[(row['series_id'], row['school_year'])].append(row)
    for group in groups.values():
        for output in group:
            grades = grade_set(output['grade_scope'], 'reconciliation')
            if output['entity_id'] == 'huusd' and len(grades) > 1 and 'PK' not in grades:
                school_rows = [r for r in group if r['entity_id'] in school_ids and
                               len(grade_set(r['grade_scope'], 'reconciliation')) > 1 and r['grade_scope'] != 'PK']
                if school_rows:
                    checks.append(reconcile(output, school_rows, 'district', school_ids, 'reconciliation ' + output['observation_id']))
            elif output['entity_id'] == 'huusd' and grades == {'PK'}:
                school_rows = [r for r in group if r['entity_id'] in school_ids and r['grade_scope'] == 'PK']
                if school_rows:
                    checks.append(reconcile(output, school_rows, 'district', school_ids, 'reconciliation ' + output['observation_id']))
            elif output['entity_id'] in school_ids and len(grades) > 1:
                grade_rows = [r for r in group if r['entity_id'] == output['entity_id'] and
                              len(grade_set(r['grade_scope'], 'reconciliation')) == 1 and r['grade_scope'] not in ('PK', 'UNGR')]
                if grade_rows:
                    checks.append(reconcile(output, grade_rows, 'grades', school_ids, 'reconciliation ' + output['observation_id']))
    return sorted(private, key=lambda x: x['output_id']), sorted(checks, key=canonical_json)


def display_series(rows):
    groups = defaultdict(list)
    for row in rows:
        groups[tuple(row[k] for k in SERIES_FIELDS)].append(row)
    result = []
    for key, values in sorted(groups.items()):
        series_id = key[0]
        forecast = values[0]['status'] == 'projection'
        if forecast:
            for field in ('forecast_vintage', 'author', 'base_year', 'horizon', 'assumptions', 'source_id'):
                require(len({r[field] for r in values}) == 1, series_id, 'incompatible forecast vintage/assumptions')
        result.append(dict(zip(SERIES_FIELDS, key)) | {
            'series_key': '|'.join(key), 'kind': 'projection' if forecast else 'history',
            'connect_points': SERIES[series_id][1], 'description': SERIES[series_id][2],
            'observation_ids': [r['observation_id'] for r in sorted(values, key=lambda r: r['school_year'])]})
    return result


def build_candidate(inputs, root, output):
    """Invalidate old output first; install all three files by one directory rename."""
    inputs, root, output = Path(inputs).resolve(), Path(root).resolve(), Path(output).absolute()
    require(not output.is_symlink() and output.resolve() == output, 'output', 'candidate path must not be a symlink')
    require(all(not output.is_relative_to(p) and output not in p.parents for p in (inputs, root, REPO)),
            'output', 'use a dedicated candidate directory outside inputs, collection root and repository')
    if output.exists():
        require(output.is_dir(), 'output', 'expected candidate directory')
        shutil.rmtree(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    for stale in output.parent.iterdir():
        if stale.name.startswith('.' + output.name + '-') and stale.is_dir() and not stale.is_symlink():
            shutil.rmtree(stale)
    policy_path = root / 'reports/privacy-exclusions.json'
    policy_bytes = policy_path.read_bytes()
    rules = load_rules(policy_path)  # Fresh on every invocation; never import privacy_filter.
    require(policy_path.read_bytes() == policy_bytes, 'policy', 'policy changed while loading')
    catalog_path = root / 'catalog/sources.json'
    catalog_bytes = catalog_path.read_bytes()
    summary = read_json(root / 'catalog/summary.json')
    generated_at = summary.get('generated_at')
    require(isinstance(generated_at, str), 'catalog', 'missing generation date')
    require(datetime.fromisoformat(generated_at).tzinfo is not None, 'catalog', 'generation date needs timezone')
    schema = read_json(SCHEMA_PATH)
    input_names = ['schools.json', 'sources.json', 'enrollment.csv', 'projections.csv']
    if (inputs / 'derivations.json').exists():
        input_names.append('derivations.json')
    input_hashes = {name: digest((inputs / name).read_bytes()) for name in input_names}
    sources, source_lineage = resolve_sources(read_json(inputs / 'sources.json'), json.loads(catalog_bytes), root, rules)
    register = read_json(inputs / 'schools.json')
    indices = register_data(register, sources, schema)
    entities = {'huusd'} | set(indices['schools']) | set(indices['programs'])
    enrollment = observations(inputs / 'enrollment.csv', sources, entities)
    projections = observations(inputs / 'projections.csv', sources, entities, forecast=True)
    validate_enrollment_refs(register, enrollment)
    derivations = (read_json(inputs / 'derivations.json') if 'derivations.json' in input_names else
                   {'schema_version': 1, 'derivations': [], 'reconciliations': []})
    dependencies, checks = arithmetic(enrollment, derivations, indices['schools'], sources)
    payload = {'schema_version': 1, 'dataset_date': register['updated_at'],
               'campuses': sorted(register['campuses'], key=lambda x: x['campus_id']),
               'schools': sorted(register['schools'], key=lambda x: x['school_id']),
               'programs': sorted(register['programs'], key=lambda x: x['program_id']),
               'notes': register['notes'], 'enrollment': enrollment, 'projections': projections,
               'sources': [source for _, source in sorted(sources.items())],
               'series': display_series(enrollment + projections)}
    payload['content_digest'] = digest(canonical_json(payload))
    validate_shape(payload, schema, schema, 'payload')
    lineage = {'schema_version': 1, 'content_digest': payload['content_digest'],
               'policy_digest': digest(policy_bytes), 'catalog_digest': digest(catalog_bytes),
               'catalog_generated_at': generated_at, 'sources': source_lineage,
               'derivations': dependencies, 'reconciliations': checks}
    payload_bytes, lineage_bytes = canonical_json(payload) + b'\n', canonical_json(lineage) + b'\n'
    manifest = {k: lineage[k] for k in ('schema_version', 'content_digest', 'policy_digest', 'catalog_digest', 'catalog_generated_at')}
    manifest.update(payload_file='payload.json', payload_sha256=digest(payload_bytes),
                    lineage_file='lineage.json', lineage_sha256=digest(lineage_bytes),
                    input_sha256=input_hashes)
    stage = Path(tempfile.mkdtemp(prefix='.' + output.name + '-', dir=output.parent))
    try:
        for filename, content in [('payload.json', payload_bytes), ('lineage.json', lineage_bytes),
                                  ('candidate.json', canonical_json(manifest) + b'\n')]:
            with (stage / filename).open('xb') as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
        require(policy_path.read_bytes() == policy_bytes, 'policy', 'policy changed during build')
        require(catalog_path.read_bytes() == catalog_bytes, 'catalog', 'catalog changed during build')
        require(all(digest((inputs / name).read_bytes()) == h for name, h in input_hashes.items()),
                'inputs', 'reviewed inputs changed during build')
        os.replace(stage, output)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inputs', type=Path, default=REPO / 'data/school-board/public')
    parser.add_argument('--root', type=Path, default=Path(os.environ.get('SCHOOL_BOARD_ROOT', '/rocky/open-valley/school-board')))
    parser.add_argument('--output', type=Path, required=True, help='Dedicated, replaceable candidate directory outside the repository')
    args = parser.parse_args()
    try:
        result = build_candidate(args.inputs, args.root, args.output)
    except (ValueError, OSError) as error:
        parser.exit(2, f'Candidate rejected: {error}\n')
    print(json.dumps({'schema_version': 1, 'content_digest': result['content_digest'], 'validated': True}))


if __name__ == '__main__':
    main()
