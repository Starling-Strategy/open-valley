"""Build a page-addressable, deduplicated library from explicitly reviewed editions.

Only allowlisted PDFs and the existing reviewed corpus are eligible. AppleDouble
files are never imported. No crawling, transcript ingestion, or inferred clearance.
"""
import argparse
import fcntl
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

from import_facilities_review import excluded_ids
from privacy_rules import load_rules, write_json, canonical_id


PDFS = [
    ('1DtJ_8h8RFzVgBdam6bkhdb6IGYjXLisO', '7dd71fc9054d9998e936317b3fdfac87e89d61fc7dfa7dca7ef1242daf926d66', 'Facility evaluation: six elementary and middle schools', '2025-10-27', 'Facilities', 'Building conditions, modernization priorities and consultant cost estimates. Harwood costs are carried forward from an older estimate; these are not consolidation savings.'),
    ('18hZ4T-r5LPiTkvlm4YCXHOtcWd8QmJ-X', 'd406efe225ee27412c6ca2bf8700847a8da929244eb0b0ea2cb49dcc67eba4d6', 'District reconfiguration options', '2025-03', 'Planning options', 'Consultant scenarios, educational planning guidelines and a high-level 30-year cost model. Historical assumptions and modeled differences, not adopted decisions or guaranteed savings.'),
    ('10jsWqaLnc9UcB445CnORi6fib7eubf0G', '2a07c4c5728e3f377ceb56d6b0d1feb4d42ea15cadd821cfa9fa200626ba218b', 'Planning project update', '2024-12', 'Planning options', 'Early planning themes, capacity assumptions and configuration options. Historical presentation, not the current district configuration.'),
    ('1zsA5cP6h71RBY3sPL1afyFabcG4NOHJGiZgTxdIn-tY', '66b09863c41ab75f88f55d55bb2f7bada8512a8f325c9b0b614c785aee0833d7', 'Facility evaluation presentation', '2025-10', 'Facilities', 'Presentation of condition assessments and estimated modernization costs; October 2024 enrollment inputs.'),
]
PROVIDED = [
    ('18hZ4T-r5LPiTkvlm4YCXHOtcWd8QmJ-X', 'HUUSD Reconfiguration Options Report 03-11-25.pdf', '2fb05214a9954a2d2735cac338002107ea4658c4202cb1e035f2efe50ec7cd23', 'Provided March draft: unfinished introduction; differs from the committee-linked edition. Available for comparison, not used for answers.'),
    ('10jsWqaLnc9UcB445CnORi6fib7eubf0G', 'OPTIONS.pdf', '6220505f9eada49f19109b9a8c3d435d72f5976d8c2d8d02a41cf1cd4a27ccd7', 'Provided December version: omits capacity and cost-model slides found in the committee-linked edition. Available for comparison, not used for answers.'),
]
BOUNDARY = re.compile(r'executive[\s-]+session|closed[\s-]+session|confidential[\s-]+student|student[\s-]+case', re.I)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def checked_file(root, relative, expected):
    filename = root / relative
    if filename.resolve() != filename or not filename.is_relative_to(root):
        raise ValueError('Invalid artifact path')
    if sha(filename.read_bytes()) != expected:
        raise ValueError('Edition changed since review')
    return filename


def pdf_pages(filename, ocr):
    text = subprocess.check_output(['pdftotext', '-layout', str(filename), '-'], text=True)
    pages = text.split('\f')
    if not pages[-1].strip():
        pages.pop()
    result = []
    for number, text in enumerate(pages, 1):
        method = 'pdf-text'
        # Sparse pages often contain rasterized option tables/maps. Do not silently
        # index just their headers. OCR is marked separately from native PDF text.
        if ocr and len(' '.join(text.split())) < 350:
            with tempfile.TemporaryDirectory() as tmp:
                prefix = str(Path(tmp) / 'page')
                subprocess.run(['pdftoppm', '-f', str(number), '-l', str(number), '-singlefile', '-r', '180', '-png', str(filename), prefix], check=True, capture_output=True)
                recognized = subprocess.check_output(['tesseract', prefix + '.png', 'stdout', '-l', 'eng', '--psm', '3'], stderr=subprocess.DEVNULL, text=True)
                if len(recognized.strip()) > len(text.strip()):
                    text, method = recognized, 'ocr'
        if BOUNDARY.search(text):
            raise ValueError('Boundary review required; no extraction retained')
        result.append({'page': number, 'text': text.strip(), 'method': method})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--provided', type=Path)
    parser.add_argument('--ocr', action='store_true')
    args = parser.parse_args()
    root = args.root.resolve()
    with (root.parent / '.school-board-cleanup.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        policy_bytes = (root / 'reports/privacy-exclusions.json').read_bytes()
        rules = load_rules(root / 'reports/privacy-exclusions.json')
        catalog = json.loads((root / 'catalog/sources.json').read_text())
        reviews = json.loads((root / 'supplements/rebuild-reviewed/reviewed.json').read_text())
        # Include projections and provided variants in the same exclusion graph,
        # including editions absent from a newly rebuilt acquisition catalog.
        related = [{'source_id': r['id'], 'files': [{'local_path': r['localPath'], 'sha256': r['sha256']}]} for r in reviews]
        related += [{'source_id': sid, 'files': [{'local_path': f'supplements/research-library/{checksum}.pdf', 'sha256': checksum}]} for sid, _, checksum, _ in PROVIDED]
        prior_path = root / 'supplements/research-library/library.json'
        if prior_path.exists():
            for d in json.loads(prior_path.read_text())['documents']:
                related.extend({'source_id': alias, 'files': [{'local_path': f['localPath'], 'sha256': f['sha256']} for f in d['files']] + [{'local_path': d['pagesPath'], 'sha256': d['pagesSha256']}]} for alias in d['aliases'])
        blocked = excluded_ids(catalog + related, rules)
        folder = root / 'supplements/research-library'
        folder.mkdir(exist_ok=True, mode=0o700)
        documents, pending, artifacts = [], [], []
        pdf_ids = {p[0] for p in PDFS}
        for sid, expected, title, date, topic, description in PDFS:
            if canonical_id(sid) in blocked:
                continue
            source = next(s for s in catalog if s['source_id'] == sid)
            file = next(f for f in source['files'] if f['sha256'] == expected)
            filename = checked_file(root, file['local_path'], expected)
            pages = pdf_pages(filename, args.ocr)
            doc = dict(id=sid, aliases=[sid], title=title, date=date, topic=topic,
                       kind='Consultant study', description=description, url=source['url'],
                       reviewedAt='2026-10-14', files=[dict(id=expected, localPath=file['local_path'], sha256=expected, label='Committee-linked PDF', mime='application/pdf')])
            if args.provided:
                for parent, name, checksum, label in PROVIDED:
                    if parent != sid:
                        continue
                    raw = checked_file(args.provided.resolve(), name, checksum).read_bytes()
                    relative = f'supplements/research-library/{checksum}.pdf'
                    if checksum in rules['sha256'] or relative in rules['paths']:
                        raise ValueError('Provided artifact is excluded')
                    # These alternate editions were reviewed independently; never
                    # replace the public edition or collapse changed content by title.
                    pdf_pages(args.provided / name, False)
                    pending.append((relative, raw))
                    doc['files'].append(dict(id=checksum, localPath=relative, sha256=checksum, label=label, mime='application/pdf'))
            documents.append((doc, pages))
        seen = {}
        for review in reviews:
            sid = review['id']
            if sid in pdf_ids or canonical_id(sid) in blocked:
                continue
            raw = checked_file(root, review['localPath'], review['sha256']).read_bytes()
            text = raw.decode('utf-8-sig')
            if BOUNDARY.search(text):
                raise ValueError('Boundary review required: ' + sid)
            content_hash = sha(' '.join(text.split()).encode())
            if content_hash in seen:
                seen[content_hash]['aliases'].append(sid)
                continue
            topic = 'Committee minutes' if 'Committee' in review['title'] else 'Context & perspectives'
            date = re.match(r'^\d{4}-\d{2}-\d{2}', review['title'])
            doc = dict(id=sid, aliases=[sid], title=review['title'], date=date[0] if date else None,
                       topic=topic, kind=review['kind'], description=review['kind'], url=review['url'],
                       reviewedAt=review['reviewedAt'], files=[])
            seen[content_hash] = doc
            # Text edition is the reviewed artifact; unreviewed PDF variants are not served.
            doc['files'].append(dict(id=review['sha256'], localPath=review['localPath'], sha256=review['sha256'], label='Reviewed text copy', mime='text/plain'))
            documents.append((doc, [{'page': None, 'text': text, 'method': 'reviewed-text'}]))
        for doc, pages in documents:
            content = json.dumps(pages, ensure_ascii=False).encode()
            relative = f'supplements/research-library/{doc["id"]}.pages.json'
            if relative in rules['paths'] or sha(content) in rules['sha256']:
                raise ValueError('Excluded derived pages')
            doc.update(pagesPath=relative, pagesSha256=sha(content), pageCount=len(pages),
                       ocrPages=sum(p['method'] == 'ocr' for p in pages))
            pending.append((relative, content))
            for f in doc['files'] + [{'localPath': relative, 'sha256': sha(content)}]:
                artifacts.append(dict(source_id=doc['id'], title=doc['title'], url=doc['url'],
                                      local_path=f['localPath'], sha256=f['sha256'], status='reviewed_private_preview'))
        if (root / 'reports/privacy-exclusions.json').read_bytes() != policy_bytes:
            raise ValueError('Policy changed during extraction')
        for relative, content in pending:
            target = root / relative
            # Atomic replace; no retained previous extraction or quarantine.
            with tempfile.NamedTemporaryFile(dir=folder, delete=False) as stream:
                stream.write(content)
                temporary = Path(stream.name)
            temporary.replace(target)
        write_json(folder / 'catalog.json', artifacts)
        write_json(folder / 'library.json', {'schemaVersion': 1, 'reviewedAt': '2026-10-14', 'documents': [d for d, _ in documents]})
        print(json.dumps({'documents': len(documents), 'pages': sum(len(p) for _, p in documents),
                          'ocrPages': sum(d['ocrPages'] for d, _ in documents), 'providedVariants': len(PROVIDED) if args.provided else 0}))


if __name__ == '__main__':
    main()
