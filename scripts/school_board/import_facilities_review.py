"""Add explicitly reviewed facilities excerpts to the private assistant corpus.

Reads only pinned editions in the current catalog. Does not crawl or restore old
exports. PDF selections are intentionally partial, not clearance of whole reports.
Run with --apply only after reviewing the selected text and public provenance.
"""
import argparse
import fcntl
import hashlib
import json
from pathlib import Path
import re
import subprocess

from privacy_rules import canonical_id, load_rules, write_json


REVIEWED_ON = '2026-10-14'
# Source ID, reviewed input hash, PDF pages (None means the reviewed text edition).
SELECTIONS = [
    ('1DtJ_8h8RFzVgBdam6bkhdb6IGYjXLisO', '7dd71fc9054d9998e936317b3fdfac87e89d61fc7dfa7dca7ef1242daf926d66', [1, 2, 5, 6, 7, 8]),
    ('1zsA5cP6h71RBY3sPL1afyFabcG4NOHJGiZgTxdIn-tY', '66b09863c41ab75f88f55d55bb2f7bada8512a8f325c9b0b614c785aee0833d7', [1, 3, 4, 5, 6, 45]),
    ('1WyLKeTAA4LYqU6VTRQ_SPs6NzdDTqlSnTJgckuB_gEw', '65d849e201c383490b359aeb5a499b69e56a3c8a85d24baefb2d61bf39722628', None),
    ('1Cs3zh_FEvk2tiuxAw4tD6RIE4uwpJavzwHvqFGtfnkc', '2583ac9e2b914a37017ad858a6d9f234cd7bca32399544e696a780ab11d9af66', None),
    ('1aD-hBgTcrEdHhh1RPDQmXGj62T697JdnRKFbinE5LGA', 'c9f5d3ae3c0dae8de9c8553dfd8a9eb78558c9ec2959cd544c2f659389c53eb3', None),
    ('1CUaQIzkFSGTzp9Eia--ffHGMFDDm5PR1onGQgtOuurg', 'ff9171ff54cbc4aba26c5402f49b55ad2fe539183db7f8edac678c2cc63fd460', None),
    ('1zgB9zTIQB8W9IXXyjIKTSDtc8itfZBm1wvfenjA8s4c', '1bf70ea47109c2a88894d8f81624c27a81549149b4eb9a5f27c61390beb05206', None),
    ('1xWNFnTOXG3oHvgCvmij36FxGj_SdND3BMf5ZZ0x4XtY', '960d5ba6691ba8d41765bc14954d27a746945c3090e99516deffb90a50750645', None),
]


def excluded_ids(rows, rules):
    ids = {canonical_id(x) for x in rules['source_ids']}
    paths, hashes = set(rules['paths']), set(rules['sha256'])
    while True:
        before = (len(ids), len(paths), len(hashes))
        for row in rows:
            if canonical_id(row['source_id']) in ids or any(f['local_path'] in paths or f['sha256'] in hashes for f in row['files']):
                ids.add(canonical_id(row['source_id']))
                paths.update(f['local_path'] for f in row['files'])
                hashes.update(f['sha256'] for f in row['files'])
        if before == (len(ids), len(paths), len(hashes)):
            return ids


def prepare(root, rows, rules, existing):
    blocked = excluded_ids(rows + [
        {'source_id': s['id'], 'files': [{'local_path': s['localPath'], 'sha256': s['sha256']}]}
        for s in existing
    ], rules)
    captures = []
    for sid, expected_hash, pages in SELECTIONS:
        if canonical_id(sid) in blocked:
            raise ValueError('Selected source is excluded: ' + sid)
        source = next(s for s in rows if s['source_id'] == sid)
        file = next(f for f in source['files'] if f['sha256'] == expected_hash)
        filename = root / file['local_path']
        if filename.resolve() != filename or not filename.is_relative_to(root):
            raise ValueError('Invalid source path')
        raw = filename.read_bytes()
        if hashlib.sha256(raw).hexdigest() != expected_hash:
            raise ValueError('Source changed since review: ' + sid)
        if pages:
            extracted = subprocess.check_output(['pdftotext', '-layout', str(filename), '-'], text=True).split('\f')
            text = '\n\n'.join(f'PDF page {page}\n{extracted[page - 1].strip()}' for page in pages)
            locator = 'Selected PDF pages ' + ', '.join(map(str, pages)) + '; remaining pages not included'
            kind = 'TruexCullins consultant facilities estimate, October 2025; not an adopted budget or consolidation saving; enrollment is October 2024; Harwood costs derive from an older estimate'
            topics = ['facilities', 'capital-costs', 'TruexCullins']
        else:
            text = raw.decode('utf-8-sig')
            locator = 'Public committee minutes, ' + source['title'][:10]
            kind = 'Dated public committee minutes; distinguish discussion, recommendation and full-board action'
            if 'DRAFT Minutes' in text:
                kind += '; captured edition labeled DRAFT (September 1 minutes record subsequent approval)'
            topics = ['building-use-and-visioning', 'planning-timeline']
        # This conservative stop is in addition to manual review, not a substitute.
        if re.search(r'executive.session|closed.session|confidential.student|student.case', text, re.I):
            raise ValueError('Boundary review required: ' + sid)
        content = (text.strip() + '\n').encode()
        relative = f'supplements/rebuild-reviewed/{sid}.txt'
        sha = hashlib.sha256(content).hexdigest()
        if relative in rules['paths'] or sha in rules['sha256'] or len(content) > 200_000:
            raise ValueError('Ineligible excerpt: ' + sid)
        record = dict(id=sid, title=source['title'], url=source['url'], kind=kind,
                      locator=locator, reviewedAt=REVIEWED_ON, localPath=relative,
                      sha256=sha, topics=topics, inputSha256=expected_hash)
        prior = next((s for s in existing if s['id'] == sid), None)
        if prior and prior != record:
            raise ValueError('Existing review differs; requires explicit review: ' + sid)
        captures.append((content, record))
    return captures


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    root = args.root.resolve()
    with (root.parent / '.school-board-cleanup.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        rules = load_rules(root / 'reports/privacy-exclusions.json')
        rows = json.loads((root / 'catalog/sources.json').read_text())
        folder = root / 'supplements/rebuild-reviewed'
        manifest = json.loads((folder / 'reviewed.json').read_text())
        catalog = json.loads((folder / 'catalog.json').read_text())
        captures = prepare(root, rows, rules, manifest)
        if args.apply:
            for content, record in captures:
                target = root / record['localPath']
                if target.exists() and target.read_bytes() != content:
                    raise ValueError('Existing capture differs')
            for content, record in captures:
                target = root / record['localPath']
                if not target.exists():
                    with target.open('xb') as stream:
                        stream.write(content)
                if not any(s['id'] == record['id'] for s in manifest):
                    manifest.append(record)
                    catalog.append(dict(source_id=record['id'], title=record['title'], url=record['url'],
                                        local_path=record['localPath'], sha256=record['sha256'], bytes=len(content),
                                        status='reviewed_private_preview', access='public_original', reviewed_at=REVIEWED_ON))
            write_json(folder / 'catalog.json', catalog)
            write_json(folder / 'reviewed.json', manifest)
        print(json.dumps({'applied': args.apply, 'selected_sources': len(captures),
                          'selected_bytes': sum(len(c) for c, _ in captures),
                          'reviewed_sources': len(manifest)}))


if __name__ == '__main__':
    main()
