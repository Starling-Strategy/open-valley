"""Build portable catalogs over preserved snapshots; never modify source files."""
import csv
import hashlib
import html
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from privacy_filter import ROOT, excluded

ARCHIVE = ROOT / 'archive/huusd-board'
OUT = ROOT / 'catalog'
OUT.mkdir(exist_ok=True)


def load(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def portable(value):
    if not value:
        return None
    text = str(value)
    if '/huusd-board/' in text:
        path = ARCHIVE / text.split('/huusd-board/', 1)[1]
    else:
        path = Path(text) if text.startswith('/') else ROOT / text
    return str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else None


hash_cache = {}


def file_info(relative):
    path = ROOT / relative
    if relative not in hash_cache:
        with path.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        hash_cache[relative] = {'local_path': relative, 'sha256': digest, 'bytes': path.stat().st_size}
    return hash_cache[relative]


sources = {}


def add(row, origin):
    key = row.get('source_id') or row.get('id') or row.get('url') or row.get('local_path')
    if not key:
        return
    key = str(key)
    raw = row.get('local_path') or row.get('path')
    if excluded(key, portable(raw), row.get('sha256')):
        return
    relative = portable(raw)
    if relative and (ROOT / relative).is_file() and excluded(digest=file_info(relative)['sha256']):
        return
    # A source may have only nested formats. Reject the whole record before its
    # title/observations are created if any representation is excluded.
    for artifact in row.get('files', []):
        if not isinstance(artifact, dict):
            continue
        artifact_path = portable(artifact.get('local_path') or artifact.get('path'))
        if excluded(path=artifact_path, digest=artifact.get('sha256')):
            return
        if artifact_path and (ROOT / artifact_path).is_file() and excluded(digest=file_info(artifact_path)['sha256']):
            return
    entry = sources.setdefault(key, {'source_id': key, 'title': '', 'url': '', 'files': [], 'observations': []})
    entry['title'] = entry['title'] or row.get('title') or row.get('name') or key
    entry['url'] = entry['url'] or row.get('url') or row.get('link') or ''
    observation = {k: row[k] for k in ('status', 'access', 'acquisition_status', 'date', 'body', 'kind', 'publication_status', 'linked_from', 'parents', 'scope_notes', 'collections', 'transcript_status', 'match_status', 'review_status', 'meeting_id', 'error', 'reason') if k in row}
    observation['origin'] = origin
    entry['observations'].append(observation)
    raw = row.get('local_path') or row.get('path')
    relative = portable(raw)
    if relative and (ROOT / relative).is_file():
        info = file_info(relative)
        if row.get('sha256') and row['sha256'] != info['sha256']:
            raise ValueError('Acquisition checksum mismatch: ' + relative)
        if row.get('bytes') is not None and int(row['bytes']) != info['bytes']:
            raise ValueError('Acquisition size mismatch: ' + relative)
        if info not in entry['files']:
            entry['files'].append(info)
    elif raw:
        observation['unresolved_local_reference'] = raw
    for artifact in row.get('files', []):
        if isinstance(artifact, dict) and artifact.get('local_path') and artifact.get('local_path') != raw:
            add({'source_id': key, **artifact}, origin + ':additional_format')


fetches = load(ARCHIVE / 'records/fetch-log.json', {})
with (ARCHIVE / 'records/manifest.csv').open() as stream:
    for row in csv.DictReader(stream):
        row['source_id'] = row['id']
        # Manifest path is a remote folder label, not a local file path.
        row.pop('path', None)
        fetched = fetches.get(row['id'], {})
        row['local_path'] = fetched.get('path') if fetched.get('status') == 'ok' else None
        row['status'] = 'saved_original' if row['local_path'] else 'catalog_only'
        row['access'] = 'archived_source_not_rechecked'
        add(row, 'historical_manifest')

for row in load(ARCHIVE / 'research/meeting-pipeline/inventory/documents.json', []):
    add(row, 'recent_inventory_2026-09-29')

# Preserve additional original formats/editions under their known Drive identity.
for folder in ('research/raw', 'research/facilities-discovery'):
    for path in sorted((ARCHIVE / folder).rglob('*')):
        if path.is_file() and path.suffix.lower() in ('.pdf', '.html', '.txt', '.docx', '.pptx', '.xlsx') and path.stem in sources:
            add({'source_id': path.stem, 'local_path': str(path.relative_to(ROOT)), 'kind': 'additional_saved_format', 'access': 'archived_source_not_rechecked'}, 'additional_archive_editions')

recording_root = ARCHIVE / 'research/meeting-pipeline/recordings'
for meeting in load(recording_root / 'recordings.json', {}).get('meetings', []):
    for recording in meeting.get('recordings', []):
        video_id = recording.get('platform_id')
        if not video_id:
            continue
        base = {'source_id': 'youtube:' + video_id, 'title': recording.get('title', video_id), 'url': recording.get('video_url', ''), 'date': meeting.get('meeting_date'), 'body': meeting.get('body'), 'meeting_id': meeting.get('meeting_id'), 'status': recording.get('acquisition_status'), 'match_status': recording.get('match_status'), 'review_status': recording.get('review_status'), 'transcript_status': recording.get('transcript_status'), 'access': 'archived_recording_metadata_not_rechecked'}
        add(base, 'recording_registry_2026-09-29')
        for caption in recording.get('caption_artifacts', []):
            relative = str((recording_root / caption['path']).relative_to(ROOT))
            add({**base, **caption, 'local_path': relative, 'kind': 'caption_track', 'access': 'automatic_captions_unreviewed'}, 'recording_registry_2026-09-29')

# An orphan caption can have a known recording without a verified meeting identity.
for path in sorted((recording_root / 'captions').glob('*/*.info.json')):
    metadata = load(path, {})
    video_id = metadata.get('id')
    if not video_id or 'youtube:' + video_id in sources:
        continue
    for caption in path.parent.glob('*.vtt'):
        add({'source_id': 'youtube:' + video_id, 'title': metadata.get('title', video_id), 'url': metadata.get('webpage_url', ''), 'local_path': str(caption.relative_to(ROOT)), 'kind': 'caption_track', 'status': 'saved_caption_unmatched_meeting', 'access': 'automatic_captions_unreviewed', 'review_status': 'unreviewed', 'scope_notes': ['Meeting identity/date unresolved; publisher upload date is not a meeting date.']}, 'orphan_recording_metadata')

for path in sorted(ROOT.glob('supplements/*/catalog.json')) + sorted(ROOT.glob('notion/**/catalog.json')) + sorted(ROOT.glob('github/*/catalog.json')):
    rows = load(path, [])
    if isinstance(rows, dict):
        rows = rows.get('records', rows.get('sources', rows.get('pages', [])))
    for row in rows:
        add(row, str(path.relative_to(ROOT)))

for path in sorted((ROOT / 'supplements/committee/listings').glob('*.json')):
    if path.stem == '14rKp4XfLrUknri2dK4kK0usjcagRjKba' and path.stem in sources and not sources[path.stem]['files']:
        add({'source_id': path.stem, 'local_path': str(path.relative_to(ROOT)), 'kind': 'folder_listing', 'status': 'saved_listing', 'access': 'anonymous_public_listing', 'scope_notes': ['Folder metadata snapshot; individual child documents retain their own acquisition statuses.']}, 'supplemental_folder_listing')

# Include caption files and other source assets lacking a unified document ID.
known = {f['local_path'] for entry in sources.values() for f in entry['files']}
for folder, access in [('records/files', 'archived_source_not_rechecked'), ('research/facilities-discovery', 'archived_source_not_rechecked'), ('research/meeting-pipeline/recordings/captions', 'automatic_captions_unreviewed')]:
    for path in sorted((ARCHIVE / folder).rglob('*')):
        relative = str(path.relative_to(ROOT))
        if path.is_file() and relative not in known and path.suffix.lower() in ('.pdf', '.txt', '.docx', '.pptx', '.xlsx', '.vtt'):
            add({'source_id': 'archive-file:' + str(path.relative_to(ARCHIVE)), 'title': path.name, 'local_path': relative, 'access': access, 'status': 'saved_asset'}, 'supplemental_archive_assets')

entries = sorted(sources.values(), key=lambda x: (x['title'].lower(), x['source_id']))
for entry in entries:
    entry['local_status'] = 'local_content' if entry['files'] else 'no_local_content'
    entry['sha256_groups'] = sorted({f['sha256'] for f in entry['files']})

duplicates = defaultdict(list)
for entry in entries:
    for f in entry['files']:
        duplicates[f['sha256']].append({'source_id': entry['source_id'], 'local_path': f['local_path']})
duplicates = {h: values for h, values in duplicates.items() if len(values) > 1}
(OUT / 'sources.json').write_text(json.dumps(entries, ensure_ascii=False, indent=2))
(OUT / 'duplicate-content.json').write_text(json.dumps(duplicates, indent=2))
with (OUT / 'sources.csv').open('w', newline='') as stream:
    writer = csv.DictWriter(stream, fieldnames=['source_id', 'title', 'url', 'local_status', 'local_paths'])
    writer.writeheader()
    for entry in entries:
        writer.writerow({**{k: entry[k] for k in ('source_id', 'title', 'url', 'local_status')}, 'local_paths': ' | '.join(f['local_path'] for f in entry['files'])})

# Portable mapping is separate from original, unmodified Mac-era metadata.
mapping = {}
for path in ARCHIVE.rglob('*'):
    if path.is_file():
        mapping['/Users/maconphillips/Documents/Projects/huusd-board/' + str(path.relative_to(ARCHIVE))] = str(path.relative_to(ROOT))
(OUT / 'legacy-path-map.json').write_text(json.dumps(mapping, indent=2))

summary = {'generated_at': datetime.now(timezone.utc).isoformat(), 'source_records': len(entries), 'status_counts': dict(Counter(e['local_status'] for e in entries)), 'indexed_local_files': len(hash_cache), 'duplicate_content_groups': len(duplicates), 'distinct_content_hashes': len({f['sha256'] for e in entries for f in e['files']}), 'note': 'Source records and file counts overlap across editions and origins; not a count of unique meetings. Private working snapshots are not publication-cleared.'}
(OUT / 'summary.json').write_text(json.dumps(summary, indent=2))
escape = html.escape
table = []
for e in entries:
    files = '<br>'.join(f'<a href="{quote(f["local_path"])}">{escape(Path(f["local_path"]).name)}</a>' for f in e['files']) or 'No local file — see source observations'
    url = e['url']
    source = f'<a href="{escape(url, quote=True)}">Original source</a>' if url.startswith(('http://', 'https://')) else ''
    origins = ', '.join(sorted({o['origin'] for o in e['observations']}))
    details = '<details><summary>Source observations</summary><pre>' + escape(json.dumps(e['observations'], ensure_ascii=False, indent=2)) + '</pre></details>'
    table.append(f'<tr id="source-{escape(e["source_id"], quote=True)}"><td>{escape(e["title"])}<small>{escape(e["source_id"])}</small></td><td>{files}</td><td>{source}<small>{escape(origins)}</small>{details}</td><td>{escape(e["local_status"])}</td></tr>')
page = '''<!doctype html><meta charset="utf-8"><title>Open Valley — School Board sources</title>
<style>body{font:16px system-ui;margin:2rem;max-width:1500px}input{padding:.7rem;width:80%;margin:1rem 0}table{border-collapse:collapse;width:100%}td,th{padding:.7rem;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}small{display:block;color:#666;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-width:38rem}a{color:#075c9c}.notice{background:#fff3d6;padding:1rem}h1{margin-bottom:.4rem}</style>
<style>table{table-layout:fixed}td{overflow-wrap:anywhere}</style>
<h1>School Board source collection</h1><p>Open Valley · Local research collection</p>
<p class="notice">Executive-session content and the remaining withheld records have been deleted. Public agendas, minutes and procedural references are retained. Exclusion rules prevent reimport. Scanned pages and unreviewed recordings still have review gaps. <a href="reports/privacy-review.md">Privacy review</a>.</p>
<p><a href="README.md">Start here</a> · <a href="meetings.html">Browse meetings</a> · <a href="reports/README.md">Coverage reports</a> · <a href="catalog/sources.csv">CSV catalog</a> · <a href="catalog/sources.json">Full provenance</a></p>
<input id="q" placeholder="Filter by document title, source ID, or collection" aria-label="Filter sources">
<p id="count"></p><table><thead><tr><th>Document</th><th>Local files</th><th>Provenance</th><th>Availability</th></tr></thead><tbody>'''+''.join(table)+'''</tbody></table>
<script>const rows=[...document.querySelectorAll('tbody tr')];function filter(){let n=0;const q=document.querySelector('#q').value.toLowerCase();rows.forEach(r=>{r.hidden=!r.textContent.toLowerCase().includes(q);if(!r.hidden)n++});document.querySelector('#count').textContent=n+' source records'}document.querySelector('#q').addEventListener('input',filter);filter();</script>'''
(ROOT / 'index.html').write_text(page)
print(json.dumps(summary, indent=2))
