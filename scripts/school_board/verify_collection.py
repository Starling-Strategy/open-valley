"""Verify archived bytes and portable catalog file links without altering sources."""
import hashlib
import json
import re
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import unquote
from privacy_filter import ROOT, excluded, PATHS

errors = []
checked = {}
deletion_report = ROOT / 'reports/privacy-deletions.json'
deletions = json.loads(deletion_report.read_text()) if deletion_report.exists() else {}
tombstones = {r['original_path']: r for r in deletions.get('deleted_files', [])}
deleted_receipts_checked = set()


def verify(info, allow_deleted=True):
    relative = info['local_path'] if 'local_path' in info else info['path']
    path = ROOT / relative
    if relative in PATHS and allow_deleted:
        receipt = tombstones.get(relative)
        if path.exists():
            errors.append('deleted_file_restored:' + relative)
        if not receipt or receipt['sha256'] != info['sha256'] or receipt['bytes'] != info['bytes']:
            errors.append('deletion_receipt_mismatch:' + relative)
        deleted_receipts_checked.add(relative)
        return
    if not path.resolve().is_relative_to(ROOT):
        errors.append('outside_root:' + relative)
        return
    if not path.is_file():
        errors.append('missing:' + relative)
        return
    if relative not in checked:
        with path.open('rb') as stream:
            checked[relative] = hashlib.file_digest(stream, 'sha256').hexdigest()
    if checked[relative] != info['sha256']:
        errors.append('hash_mismatch:' + relative)
    if path.stat().st_size != info['bytes']:
        errors.append('size_mismatch:' + relative)


extraction = json.loads((ROOT / 'reports/extraction.json').read_text())
for item in extraction['files']:
    verify(item)
for item in extraction['inputs']:
    with Path(item['path']).open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != item['sha256']:
            errors.append('original_input_changed:' + item['path'])
sources = json.loads((ROOT / 'catalog/sources.json').read_text())
for source in sources:
    if excluded(source['source_id']):
        errors.append('excluded_source_in_catalog:' + source['source_id'])
    for item in source['files']:
        if excluded(path=item['local_path'], digest=item['sha256']):
            errors.append('excluded_file_in_catalog:' + item['local_path'])
        verify(item, allow_deleted=False)

# Acquisition receipts remain independent of the regeneratable combined catalog.
receipt_catalogs = sorted(ROOT.glob('github/*/catalog.json')) + sorted(ROOT.glob('supplements/*/catalog.json')) + sorted(ROOT.glob('notion/**/catalog.json'))
receipts_checked = 0
for receipt in receipt_catalogs:
    rows = json.loads(receipt.read_text())
    if isinstance(rows, dict):
        rows = rows.get('records', rows.get('sources', rows.get('pages', [])))
    for row in rows:
        if row.get('local_path') and row.get('sha256') and row.get('bytes') is not None:
            verify(row)
            receipts_checked += 1
        for artifact in row.get('files', []):
            if isinstance(artifact, dict) and artifact.get('local_path') and artifact.get('sha256') and artifact.get('bytes') is not None:
                verify(artifact)
                receipts_checked += 1
woody = ROOT / 'github/woody'
provenance = json.loads((woody / 'provenance.json').read_text())
with (woody / 'source.tar.gz').open('rb') as stream:
    if hashlib.file_digest(stream, 'sha256').hexdigest() != provenance['archive_sha256']:
        errors.append('woody_archive_checksum_mismatch')

if PATHS:
    if set(tombstones) != PATHS:
        errors.append('deletion_receipts_do_not_match_exclusion_paths')
    for receipt in tombstones.values():
        if (ROOT / receipt['original_path']).exists():
            errors.append('deleted_file_restored_to_active_collection:' + receipt['original_path'])
        verify({'path': receipt['original_path'], 'sha256': receipt['sha256'], 'bytes': receipt['bytes']})
    if (ROOT.parent / 'school-board-private-review').exists():
        errors.append('private_review_directory_recreated')


class LocalLinks(HTMLParser):
    def handle_starttag(self, tag, attrs):
        href = dict(attrs).get('href', '')
        if tag == 'a' and href and not href.startswith(('https://', 'http://', '#')):
            path = ROOT / unquote(href)
            if not path.exists():
                errors.append('broken_index_link:' + href)


for name in ('index.html', 'meetings.html'):
    LocalLinks().feed((ROOT / name).read_text())
for guide in (ROOT / 'README.md', ROOT / 'reports/README.md', ROOT.parent / 'START_HERE.md'):
    for href in re.findall(r'\]\(([^)]+)\)', guide.read_text()):
        if not href.startswith(('https://', 'http://', '#')) and not (guide.parent / unquote(href.split('#', 1)[0])).exists():
            errors.append('broken_guide_link:' + str(guide) + ':' + href)
result = {'passed': not errors, 'checked_local_files': len(checked), 'input_files_checked': len(extraction['inputs']), 'intentional_deletions_verified': len(deleted_receipts_checked), 'independent_acquisition_receipts_checked': receipts_checked, 'woody_archive_checked': True, 'source_records': len(sources), 'errors': errors, 'scope': 'Retained-file integrity, intentional deletion receipts and index links; not full privacy/publication clearance.'}
(ROOT / 'reports/verification.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
raise SystemExit(0 if not errors else 1)
