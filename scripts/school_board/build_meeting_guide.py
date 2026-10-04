"""Create a meeting-first reading guide from the preserved September 29 inventory."""
import html
import json
from pathlib import Path
from urllib.parse import quote
from privacy_filter import ROOT, excluded

INVENTORY = ROOT / 'archive/huusd-board/research/meeting-pipeline/inventory'
catalog = {r['source_id']: r for r in json.loads((ROOT / 'catalog/sources.json').read_text())}
meetings = []
for name in ('meetings.json', 'future-meetings.json'):
    meetings.extend(json.loads((INVENTORY / name).read_text()))
meetings.sort(key=lambda r: (r['date'], r['body']), reverse=True)
meetings.sort(key=lambda r: r['occurrence_status'] == 'scheduled')
output = []
sections = []
for row in meetings:
    record = {k: row[k] for k in ('meeting_id', 'date', 'body', 'occurrence_status', 'scope_notes', 'session') if k in row}
    seen = set()
    evidence = []
    links = []
    for item in row.get('evidence', []):
        source_id = item.get('source_id')
        if excluded(source_id):
            continue
        if source_id in seen:
            continue
        seen.add(source_id)
        source = catalog.get(source_id, {})
        if not source:
            continue
        files = [f for f in source.get('files', []) if not excluded(path=f['local_path'], digest=f['sha256'])]
        evidence.append({**item, 'local_path': files[0]['local_path'] if files else None, 'local_files': files})
        title = html.escape(item.get('title', source_id or 'Document'))
        ranks = {'.pdf': 0, '.xlsx': 1, '.xls': 1, '.pptx': 2, '.docx': 2, '.txt': 3, '.html': 4, '.zip': 5}
        display_files = sorted(files, key=lambda f: ranks.get(Path(f['local_path']).suffix, 6))
        local = ' · '.join(f'<a href="{quote(f["local_path"])}">Local {html.escape(Path(f["local_path"]).suffix or "file")}</a>' for f in display_files[:3])
        additional = ''
        if len(display_files) > 3:
            alternatives = ''.join(f'<li><a href="{quote(f["local_path"])}">{html.escape(Path(f["local_path"]).name)}</a></li>' for f in display_files[3:])
            additional = f'<details><summary>{len(display_files)-3} additional files / sheet resources</summary><ul>{alternatives}</ul></details>'
        url = item.get('url', '')
        original = f'<a href="{html.escape(url, quote=True)}">Original</a>' if url.startswith(('http://', 'https://')) else ''
        links.append(f'<li><b>{html.escape(item.get("kind", "source"))}:</b> {title} — {local or "No local file"} · {original}{additional}</li>')
    record['evidence'] = evidence
    output.append(record)
    notes = html.escape('; '.join(row.get('scope_notes', [])))
    sections.append(f'<section><h2>{html.escape(row["date"])} — {html.escape(row["body"])}</h2><p>Status as recorded September 29: <b>{html.escape(row["occurrence_status"])}</b>. {notes}</p><ul>{"".join(links) or "<li>No document evidence in this snapshot.</li>"}</ul></section>')
(ROOT / 'catalog/meetings.json').write_text(json.dumps(output, indent=2, ensure_ascii=False))
(ROOT / 'meetings.html').write_text('''<!doctype html><meta charset="utf-8"><title>HUUSD meeting documents</title><style>body{font:16px system-ui;max-width:1000px;margin:2rem auto;padding:0 1rem}li{margin:.6rem 0}section{border-bottom:1px solid #ddd;padding-bottom:1rem}input{padding:.7rem;width:90%}a{color:#075c9c}</style><h1>Meetings and their documents</h1><p><a href="index.html">All sources</a> · <a href="README.md">Collection guide</a></p><p>September 29, 2026 inventory snapshot: 82 through-cutoff records and 22 future records. An elapsed date does not prove a meeting occurred. New acquisitions appear in the source catalog; this guide preserves the original meeting identities and their uncertainty.</p><input id="q" aria-label="Filter meetings" placeholder="Filter by committee, date or document title">'''+''.join(sections)+'''<script>document.querySelector('#q').addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('section').forEach(s=>s.hidden=!s.textContent.toLowerCase().includes(q))});</script>''')
print('Created meeting guide:', len(output), 'snapshot meeting records')
