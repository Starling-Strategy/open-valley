"""Rebuild the public library from local official collection metadata.

No acquisition or collection writes. Existing core citations are immutable; added
records must have a valid official URL and a hash-verified, privacy-safe edition.
The snapshot resolver is the final authority, including transitive aliases.
"""
import argparse
from collections import Counter, defaultdict
import copy
import csv
from datetime import date
import json
import os
from pathlib import Path
import re

from build_public_snapshot import (LIBRARY_COLLECTIONS, REPO, read_json, require, resolve_sources,
                                   text, url_identity)
from privacy_rules import canonical_id, load_rules, write_json


ROOT = '/rocky/open-valley/school-board'
PUBLIC = REPO / 'data/school-board/public/sources.json'
REVIEWED_AT = '2026-10-20'
COMMITTEE = 'Building Use & Visioning Committee'
BODIES = {'HUUSD Board', COMMITTEE, 'Finance Committee', 'Outreach Committee'}
HISTORICAL_KINDS = {'agenda', 'minute', 'packet', 'presentation', 'budget', 'polic'}
PERSONAL_COMMENTS = '14etwNOANtwQ2W--KI9CQ4hiWF8294CfvTduOpXBGu6A'
REPORT_HASHES = dict(zip(('F16', 'F17', 'C16', 'C19', 'P24', 'P25', 'T25'), (
    '3bbcfd69a982c323aaa0b4a76c986edd2394c3898ad534e91e0769efe6a324ca',
    'a0844934a8589264c5483c9c73c07d23fb0963c76b065ed73c56e53fe4e5d6e0',
    '529aa39d3bf4b130766f1a00b95b5b56a9fed0357c02d3042095f44d7e13d9a2',
    'f265d8a864e1850c2be0598847124edfeb06166d56947ee8b95cbf0f8825a1e2',
    '2a07c4c5728e3f377ceb56d6b0d1feb4d42ea15cadd821cfa9fa200626ba218b',
    'd406efe225ee27412c6ca2bf8700847a8da929244eb0b0ea2cb49dcc67eba4d6',
    'c0b63129f93a2e2b2e328f223bbce495f41c34196d8ebbb630c340dd5db0ea01',
)))
# Original reviewed sources, in register order. Their locators are immutable;
# library metadata is assigned here explicitly rather than by position.
ENROLLMENT_REPORT_IDS = (
    '1g7PC4OTz2KsWShYNSd0p4DouDdfsOoP2', '146yQpsn-lwf-AwRzXPwrXB6PAHtA5LY3',
    '0B2uQwDkbPKEVUWFkaTFlUXBHN1hjaXVweU42THhfSzM2Yy1Z', '1ZgT8xG9VWAbQ-rN-P93EMe9As8ttnamP',
    '1BQ-9Jn6QiTg8K_o8rXTF-bTgoSk8HJSR', '1hurfiw4WmHLdq8brBVCWXLj4n8tjPiCF',
    '1NYi0bLCAh_HQzUfUJpAp7ao_GXsx0cSv', '14nuOyhvdQmXOtU9LaQFITrJnm1trO24_',
    '1yKJ2X008tCXI1tnHPcLV1MhPQh9wMZBh', '1EwSuAJSRB2LzbzVriNOn5xya5ULajgBv',
)
SCHOOL_REFERENCE_IDS = (
    'huusd-schools', 'huusd-about', 'brookside-about', 'crossett-home', 'fayston-home',
    'moretown-home', 'waitsfield-home', 'warren-home', 'harwood-about', 'huusd-prek',
    'huusd-choice', 'harwood-pathways', 'harwood-hclc', 'vcgi-schools', 'vcgi-warren-e911',
)
CORE_LIBRARY = ({sid: ('Enrollment', 'Report') for sid in ENROLLMENT_REPORT_IDS}
                | {sid: ('Schools', 'Reference') for sid in SCHOOL_REFERENCE_IDS})
# Dates below are document dates, not dates inferred from acquisition metadata.
# Month-only reports deliberately retain a null publication date.
REPORTS = [
    ('F16', '1ZOuzzM4a-5UNYZtv-UExEryn9uN7D4li', 'WWSU Detail Staffing FTE — November 2016', None, 'Staffing', 'pp. 1–5; aggregate staffing tables and ratios, not measured class sizes.'),
    ('F17', '1NsvVeZ-_6DmL1suTeVG-OFMgSjOILh4c', 'HUUSD Staffing FTE Presentation — December 6, 2017', '2017-12-06', 'Staffing', 'pp. 1–5; aggregate staffing and proposed changes. Named staff listings are not needed for aggregate analysis.'),
    ('C16', '1Ct9eAyeIHPE9CTN5k1Dtdd0mSE2sfrrh', 'Average Class Size Report — December 7, 2016', '2016-12-07', 'Class size', 'pp. 1–7; scanned candidate report. Measured date and denominators remain unverified; page 7 readability gap.'),
    ('C19', '0B2uQwDkbPKEVOEZZN2g2eE1vVGszdVlqYlcxeXJ3czZYcHRZ', 'Projected Classroom Size by Grade for 2019–20 — March 27, 2019', '2019-03-27', 'Class size', 'p. 1; Exhibit 6, grades K–8. Planning projection, not observed class size.'),
    ('P24', '10jsWqaLnc9UcB445CnORi6fib7eubf0G', 'HUUSD Facilities Committee presentation — December 19, 2024', '2024-12-19', 'Facilities', 'pp. 1–23; p. 6 planning themes. Not implemented reconfiguration or observed class groups.'),
    ('P25', '18hZ4T-r5LPiTkvlm4YCXHOtcWd8QmJ-X', 'District Reconfiguration Options — HUUSD MP report v5, March 2025', None, 'Facilities', 'pp. 1–36; p. 6 building capacity methodology and p. 9 planning guidelines. Consultant assumptions, not current spare places.'),
    ('T25', '196MS-2vANg6_awxanmAbUyV_wlqzgaKVY90-AHEQkiE', 'Year over Year Enrollment Trends — October and November 2025', None, 'Budget', 'pp. 1–21; cover states October 21 and November 5, 2025, with no single publication date established. p. 14 history and forecast; p. 18 simple annual-decline scenario, not the NESDEC forecast.'),
]


def clean_title(value):
    value = re.sub(r'\s+', ' ', value or '').strip()
    value = re.sub(r'\.(?:pdf|pptx|docx|xlsx|txt|html)$', '', value, flags=re.I).strip()
    text(value, 'library title')
    return value


def document_date(value):
    """Only full, calendar-valid dates; never file creation or modification times."""
    patterns = (r'(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)',
                r'(?<!\d)(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})(?!\d)')
    for index, pattern in enumerate(patterns):
        for match in re.finditer(pattern, value or ''):
            a, b, c = map(int, match.groups())
            year, month, day = (a, b, c) if index == 0 else (c + 2000 if c < 100 else c, a, b)
            try:
                return date(year, month, day).isoformat()
            except ValueError:
                continue
    return None


def school_year(title, published):
    match = re.search(r'(?<!\d)(20\d{2})[–-](20\d{2}|\d{2})(?!\d)', title)
    if not match and re.search(r'\bCIP\b', title, re.I):
        match = re.search(r'(?<!\d)(2[56])[–-](2[67])(?!\d)', title)
        if match:
            return f'20{match[1]}-{match[2]}'
    if match and (int(match[1]) + 1) % 100 == int(match[2]) % 100:
        return f'{match[1]}-{int(match[2]) % 100:02d}'
    if published:
        d = date.fromisoformat(published)
        start = d.year if d.month >= 7 else d.year - 1
        return f'{start}-{(start + 1) % 100:02d}'
    return 'Unknown'


def kind_of(title, hint=''):
    lower = title.lower()
    if 'minutes' in lower or hint in ('minute', 'minutes'):
        return 'Minutes'
    if 'agenda' in lower or hint == 'agenda':
        return 'Agenda'
    if re.search(r'\bcip\b|continuous improvement', lower):
        return 'Continuous Improvement Plan'
    if 'schedule' in lower or hint == 'schedule':
        return 'Schedule'
    if hint == 'polic' or 'policy' in lower:
        return 'Policy'
    if hint == 'budget':
        return 'Budget'
    if 'presentation' in lower or hint == 'presentation':
        return 'Presentation'
    if hint == 'packet':
        return 'Packet'
    if 'report' in lower:
        return 'Report'
    if 'rfp' in lower:
        return 'Request for proposals'
    if 'map scenarios' in lower:
        return 'Map scenarios'
    return 'Supporting document'


def library(category, body, kind, title, published, collection):
    return dict(category=category, body=body, kind=kind, school_year=school_year(title, published),
                document_date=published, meetings=set(), collections={collection})


def finish(source):
    """Return a register entry with deterministic, JSON-ready library metadata."""
    meta = source['library']
    collections = meta['collections'] | ({'meetings'} if meta['meetings'] else set())
    return source | {'library': meta | {
        'meetings': [dict(zip(('date', 'body', 'status'), m)) for m in sorted(meta['meetings'])],
        'collections': [c for c in LIBRARY_COLLECTIONS if c in collections]}}


def blocked_sources(catalog, rules):
    """Propagate privacy exclusions over the same identity/hash/path graph as the resolver."""
    neighbors = defaultdict(set)
    blocked = set()
    ids = {canonical_id(s) for s in rules['source_ids']}
    for i, record in enumerate(catalog):
        sid = canonical_id(record['source_id'])
        keys = [('id', sid)]
        if sid in ids:
            blocked.add(i)
        for file in record.get('files', []):
            for key, field in (('path', 'local_path'), ('hash', 'sha256')):
                value = file.get(field)
                if value:
                    keys.append((key, value))
            if file.get('local_path') in rules['paths'] or file.get('sha256') in rules['sha256']:
                blocked.add(i)
        for key in keys:
            neighbors[key].add(i)
    graph = defaultdict(set)
    for indices in neighbors.values():
        for i in indices:
            graph[i].update(indices)
    pending = list(blocked)
    while pending:
        added = graph[pending.pop()] - blocked
        pending.extend(added)
        blocked.update(added)
    return {canonical_id(catalog[i]['source_id']) for i in blocked}


def build_library(root, existing):
    root = Path(root)
    rules = load_rules(root / 'reports/privacy-exclusions.json')
    catalog = read_json(root / 'catalog/sources.json')
    by_id = {canonical_id(r['source_id']): r for r in catalog}
    blocked = blocked_sources(catalog, rules)
    sources, skipped = {}, Counter()
    originals = {s['source_id']: s for s in existing}
    require(set(CORE_LIBRARY) <= originals.keys(), 'core', 'missing original reviewed source')
    for sid, (category, kind) in CORE_LIBRARY.items():
        source = copy.deepcopy(originals[sid])
        # Preserve all original locators, including private edition annotations
        # which the snapshot's existing sanitizer handles at publication time.
        source['library'] = library(category, 'HUUSD', kind, source['title'], source['published_at'], 'core')
        sources[sid] = source

    def add(sid, title, category, body, kind, collection, published=None, meeting=None, locator=None):
        sid = canonical_id(sid)
        if sid == PERSONAL_COMMENTS or sid in blocked:
            skipped['privacy or unverified personal comments'] += 1
            return
        if sid.startswith('url-'):
            skipped['generic external link'] += 1
            return
        record = by_id.get(sid)
        if not record or not record.get('files'):
            skipped['no catalog-backed local edition'] += 1
            return
        url = record.get('url', '').split('#', 1)[0]
        try:
            url_identity(url, sid, 'library source')
        except ValueError:
            skipped['unsupported official URL identity'] += 1
            return
        title = clean_title(title or record['title'])
        if sid not in sources:
            sources[sid] = dict(source_id=sid, title=title, url=url, published_at=published,
                                sha256=record['files'][0]['sha256'], reviewed_at=REVIEWED_AT,
                                public_eligible=True, locators=[],
                                library=library(category, body, kind, title, published, collection))
        source = sources[sid]
        source['library']['collections'].add(collection)
        if meeting:
            source['library']['meetings'].add(meeting)
        if locator and locator not in source['locators']:
            source['locators'].append(text(locator, 'library locator'))

    for ref, sid, title, published, category, locator in REPORTS:
        require(sid in by_id, ref, 'reviewed report missing from catalog')
        # Preserve the actual reviewed PDF edition identified by coverage notes.
        add(sid, title, category, COMMITTEE if ref.startswith('P') else 'HUUSD Board',
            'Report', 'reviewed_report', published, locator=locator)
        require(sid in sources, ref, 'reviewed report is not eligible')
        require(any(f['sha256'] == REPORT_HASHES[ref] for f in by_id[sid]['files']),
                ref, 'reviewed report edition missing from catalog')
        sources[sid]['sha256'] = REPORT_HASHES[ref]

    for record in read_json(root / 'supplements/committee/catalog.json'):
        if record.get('kind') == 'linked-folder' or '/folders/' in record.get('url', ''):
            skipped['folder'] += 1
            continue
        title = record.get('title', '')
        kind = kind_of(title, record.get('kind'))
        category = 'School improvement' if kind == 'Continuous Improvement Plan' else 'Facilities'
        add(record['source_id'], title, category, COMMITTEE, kind, 'building_use_visioning', document_date(title))

    for meeting in read_json(root / 'catalog/meetings.json'):
        if meeting['body'] not in BODIES:
            continue
        for evidence in meeting.get('evidence', []):
            if evidence.get('kind') not in {'agenda', 'minutes', 'schedule', 'attachment'}:
                continue
            title = evidence.get('title', '')
            kind = kind_of(title, evidence['kind'])
            # A linked attachment/schedule is not dated by the meeting at which
            # it was linked. Its date remains independent of meeting context.
            published = document_date(title)
            if not published and evidence['kind'] in {'agenda', 'minutes'}:
                published = document_date(meeting['date'])
            add(evidence['source_id'], title, 'Meetings', meeting['body'], kind, 'meetings', published,
                meeting=(meeting['date'], meeting['body'], meeting['occurrence_status']))

    with (root / 'archive/huusd-board/records/manifest.csv').open(encoding='utf-8', newline='') as stream:
        for row in csv.DictReader(stream):
            if row['kind'] not in HISTORICAL_KINDS:
                continue
            title = row['name']
            body = next((b for b in sorted(BODIES) if b in row['path']), None)
            if body is None:
                body = 'Bond Planning Committee' if 'Bond Planning Committee' in row['path'] else ('Workgroup' if 'workgroup' in title.lower() else 'HUUSD Board')
            add(row['id'], title, 'Governance', body, kind_of(title, row['kind']), 'historical_board', document_date(title))
    ordered = [finish(sources[sid]) for sid in CORE_LIBRARY] + [
        finish(s) for sid, s in sorted(sources.items()) if sid not in CORE_LIBRARY]
    # Check bytes, paths, aliases, dates, URL matches, and every public text field
    # before replacing the register. Fail closed on missing/changed editions.
    resolve_sources(ordered, catalog, root, rules)
    return ordered, dict(sorted(skipped.items()))


def counts(sources):
    return {field: dict(sorted(Counter(s['library'][field] for s in sources).items()))
            for field in ('category', 'body', 'kind')} | {
        'collections': dict(sorted(Counter(c for s in sources for c in s['library']['collections']).items()))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(os.environ.get('SCHOOL_BOARD_ROOT', ROOT)))
    parser.add_argument('--sources', type=Path, default=PUBLIC)
    args = parser.parse_args()
    try:
        sources, skipped = build_library(args.root, read_json(args.sources))
        write_json(args.sources, sources)
    except (ValueError, OSError) as error:
        parser.exit(2, f'Library rejected: {error}\n')
    print(json.dumps({'sources': len(sources), 'counts': counts(sources), 'skipped_candidate_occurrences': skipped}, indent=2))


if __name__ == '__main__':
    main()
