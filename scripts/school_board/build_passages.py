"""Add retrieval passages to a validated publication candidate.

Reads only files listed in lineage.json and re-hashes each one before extracting
text. Writes passages.jsonl and passages.json beside the three candidate files.
See docs/school-board/assistant.md for the contract. The embedding cache stores
vectors and provenance, never text; it is derived data and follows the same
privacy cleanup as candidates (excluded provenance is purged on every run).
"""
import argparse
import hashlib
from html.parser import HTMLParser
import io
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

from build_public_snapshot import canonical_json, digest, local_file, read_json, require
from privacy_rules import canonical_id, load_rules

MODEL = 'baai/bge-m3'
DIMS = 1024
ENDPOINT = 'https://openrouter.ai/api/v1/embeddings'
CORE_FILES = ('candidate.json', 'payload.json', 'lineage.json')
PASSAGE_FILES = ('passages.json', 'passages.jsonl')
CHUNK_WORDS, OVERLAP_WORDS, TAIL_WORDS = 320, 50, 80
MIN_PAGE_WORDS = 3      # Pages below this are dropped as empty (page numbers, stray marks).
LOW_TEXT_WORDS = 25     # Pages below this are counted as low-text (likely scanned images).
MAX_MEMBER_BYTES = 256 * 1024 * 1024
# Earlier formats win when their text is close to the most complete edition.
FORMATS = ('pages.json', 'pdf', 'docx', 'pptx', 'txt', 'html', 'htm', 'xlsx')
ROW_FIELDS = ('embedding', 'ordinal', 'page_end', 'page_start', 'passage_id', 'sha256', 'source_id', 'text', 'text_sha256')
MANIFEST_FIELDS = ('content_digest', 'coverage', 'embedding', 'passage_count', 'passages_file', 'passages_sha256', 'rows_digest', 'schema_version')
HEX32, HEX64 = re.compile(r'[0-9a-f]{32}'), re.compile(r'[0-9a-f]{64}')
PAGE_MARKER = re.compile(r'^PDF page (\d+)\s*$', re.M)


class Unsupported(Exception):
    """A lineage file has no supported text representation."""


# --- extraction -------------------------------------------------------------

def normalize(value):
    value = unicodedata.normalize('NFKC', value)
    return ' '.join(''.join(c if unicodedata.category(c)[0] != 'C' else ' ' for c in value).split())


def decode(data):
    for encoding in ('utf-8-sig', 'cp1252'):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode('latin-1')


def pdf_pages(data):
    result = subprocess.run(['pdftotext', '-layout', '-enc', 'UTF-8', '-q', '-', '-'], input=data,
                            capture_output=True, timeout=300, check=False)
    if result.returncode != 0:
        raise Unsupported('pdf')
    pages = result.stdout.decode('utf-8', 'replace').split('\f')
    if pages and not pages[-1].strip():
        pages.pop()  # pdftotext ends every page, including the last, with a form feed.
    return [(number, text) for number, text in enumerate(pages, 1)]


def text_pages(data):
    value = decode(data)
    markers = list(PAGE_MARKER.finditer(value))
    if markers and not value[:markers[0].start()].strip():
        # Reviewed text exports mark physical PDF pages explicitly.
        return [(int(m[1]), value[m.end():markers[i + 1].start() if i + 1 < len(markers) else len(value)])
                for i, m in enumerate(markers)]
    return [(None, value)]


class _HTMLText(HTMLParser):
    SKIP = {'script', 'style', 'noscript', 'template', 'svg', 'head'}
    INLINE = {'a', 'abbr', 'b', 'code', 'em', 'i', 'small', 'span', 'strong', 'sub', 'sup', 'u', 'font'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.skipping = [], []

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skipping.append(tag)
        elif tag not in self.INLINE:
            self.parts.append(' ')

    def handle_endtag(self, tag):
        if self.skipping and self.skipping[-1] == tag:
            self.skipping.pop()
        elif tag not in self.INLINE:
            self.parts.append(' ')

    def handle_data(self, data):
        if not self.skipping:
            self.parts.append(data)


def html_pages(data):
    parser = _HTMLText()
    parser.feed(decode(data))
    parser.close()
    return [(None, ''.join(parser.parts))]


def _member(archive, name):
    info = archive.getinfo(name)
    if info.file_size > MAX_MEMBER_BYTES:
        raise Unsupported('oversized archive member')
    return archive.read(info)


def _xml_text(element, text_tag, breaks=()):
    parts = []
    for node in element.iter():
        if node.tag == text_tag and node.text:
            parts.append(node.text)
        elif node.tag in breaks:
            parts.append(' ')
    return ''.join(parts)


W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
P = '{http://schemas.openxmlformats.org/presentationml/2006/main}'
S = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
REL = '{http://schemas.openxmlformats.org/package/2006/relationships}'


def _relationships(archive, name):
    root = ET.fromstring(_member(archive, name))
    base = name.split('_rels/')[0]
    return {r.get('Id'): (r.get('Target').lstrip('/') if r.get('Target', '').startswith('/') else base + r.get('Target'))
            for r in root.iter(REL + 'Relationship')}


def docx_pages(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        root = ET.fromstring(_member(archive, 'word/document.xml'))
    return [(None, '\n'.join(_xml_text(p, W + 't', (W + 'tab', W + 'br')) for p in root.iter(W + 'p')))]


def pptx_pages(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        rels = _relationships(archive, 'ppt/_rels/presentation.xml.rels')
        presentation = ET.fromstring(_member(archive, 'ppt/presentation.xml'))
        slides = [rels[s.get(R + 'id')] for s in presentation.iter(P + 'sldId')]
        return [(number, '\n'.join(_xml_text(p, A + 't', (A + 'br',)) for p in ET.fromstring(_member(archive, name)).iter(A + 'p')))
                for number, name in enumerate(slides, 1)]


def xlsx_pages(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = set(archive.namelist())
        shared = []
        if 'xl/sharedStrings.xml' in names:
            shared = [_xml_text(si, S + 't') for si in ET.fromstring(_member(archive, 'xl/sharedStrings.xml')).iter(S + 'si')]
        rels = _relationships(archive, 'xl/_rels/workbook.xml.rels')
        lines = []
        for sheet in ET.fromstring(_member(archive, 'xl/workbook.xml')).iter(S + 'sheet'):
            lines.append(sheet.get('name', ''))
            for row in ET.fromstring(_member(archive, rels[sheet.get(R + 'id')])).iter(S + 'row'):
                cells = []
                for cell in row.iter(S + 'c'):
                    kind, value = cell.get('t'), cell.find(S + 'v')
                    if kind == 'inlineStr':
                        cells.append(_xml_text(cell, S + 't'))
                    elif value is not None and value.text is not None:
                        cells.append(shared[int(value.text)] if kind == 's' else value.text)
                lines.append(' '.join(cells))
    return [(None, '\n'.join(lines))]


def json_pages(data):
    value = json.loads(decode(data))
    # Only page lists produced by the research library (PDF text or OCR) are documents.
    if not (isinstance(value, list) and value and all(
            isinstance(p, dict) and type(p.get('page')) is int and p['page'] >= 1 and isinstance(p.get('text'), str)
            for p in value)):
        raise Unsupported('json data')
    return [(p['page'], p['text']) for p in value]


def file_format(path):
    name = path.lower()
    if name.endswith('.pages.json'):
        return 'pages.json'
    return name.rsplit('.', 1)[-1] if '.' in name.rsplit('/', 1)[-1] else ''


EXTRACTORS = {'pages.json': json_pages, 'pdf': pdf_pages, 'docx': docx_pages, 'pptx': pptx_pages,
              'txt': text_pages, 'html': html_pages, 'htm': html_pages, 'xlsx': xlsx_pages}


def extract(path, data):
    """Return [(page or None, normalized text)] and the number of low-text pages."""
    kind = file_format(path)
    if kind not in EXTRACTORS:
        raise Unsupported(kind or 'unknown')
    try:
        raw = EXTRACTORS[kind](data)
    except (zipfile.BadZipFile, ET.ParseError, KeyError, ValueError, IndexError, subprocess.TimeoutExpired) as error:
        raise Unsupported(kind) from error
    pages, low = [], 0
    merged = {}
    for number, value in raw:
        words = normalize(value)
        if number is not None and number in merged:
            merged[number] = (merged[number] + ' ' + words).strip()
        else:
            merged[number] = words
    for number, words in merged.items():
        count = len(words.split())
        if number is not None and count < LOW_TEXT_WORDS:
            low += 1
        if count >= MIN_PAGE_WORDS:
            pages.append((number, words))
    return pages, low


def chunk(pages):
    """Split one edition into overlapping word windows; never crosses sources."""
    words = [(word, number) for number, value in pages for word in value.split()]
    result, start = [], 0
    while start < len(words):
        end = min(start + CHUNK_WORDS, len(words))
        if len(words) - end < TAIL_WORDS:
            end = len(words)  # Fold a short tail into the last passage.
        window = words[start:end]
        numbers = [n for _, n in window if n is not None]
        result.append({'text': ' '.join(w for w, _ in window),
                       'page_start': min(numbers) if numbers else None,
                       'page_end': max(numbers) if numbers else None})
        if end == len(words):
            break
        start = end - OVERLAP_WORDS
    return result


# --- candidate ---------------------------------------------------------------

def read_core(candidate):
    candidate = Path(candidate)
    names = {p.name for p in candidate.iterdir()}
    require(names in (set(CORE_FILES), set(CORE_FILES) | set(PASSAGE_FILES)), 'candidate', 'unexpected candidate files')
    data = {}
    for name in CORE_FILES:
        path = candidate / name
        require(not path.is_symlink() and path.is_file(), 'candidate', 'candidate file must be a regular file')
        data[name] = path.read_bytes()
    manifest = json.loads(data['candidate.json'])
    require(digest(data['payload.json']) == manifest.get('payload_sha256') and
            digest(data['lineage.json']) == manifest.get('lineage_sha256'), 'candidate', 'candidate hash mismatch')
    payload, lineage = json.loads(data['payload.json']), json.loads(data['lineage.json'])
    require(payload['content_digest'] == manifest['content_digest'] == lineage['content_digest'],
            'candidate', 'content digest mismatch')
    return payload, lineage


def editions(payload, lineage):
    """Payload source ID -> unique lineage files (path, sha256)."""
    public = {canonical_id(s['source_id']) for s in payload['sources']}
    result = {}
    for source in lineage['sources']:
        sid = canonical_id(source['source_id'])
        if sid in public:
            result[sid] = sorted({(f['path'], f['sha256']) for f in source['files']})
    require(set(result) == public, 'lineage', 'payload source without lineage files')
    return dict(sorted(result.items()))


def excluded(rules, sid, path, sha):
    return (sid in {canonical_id(v) for v in rules['source_ids']} or path in set(rules['paths'])
            or sha in set(rules['sha256']))


def select_edition(root, rules, sid, files, stats):
    """Re-hash, extract and choose the preferred, near-most-complete edition."""
    candidates = []
    for path, sha in files:
        require(not excluded(rules, sid, path, sha), 'source ' + sid, 'excluded source; rebuild the candidate')
        kind = file_format(path)
        if kind not in EXTRACTORS:
            stats['skipped_formats'][kind or 'unknown'] = stats['skipped_formats'].get(kind or 'unknown', 0) + 1
            continue
        data = local_file(root, path, 'source ' + sid).read_bytes()
        require(digest(data) == sha, 'source ' + sid, 'source file hash mismatch; rebuild the candidate')
        try:
            pages, low = extract(path, data)
        except Unsupported as error:
            stats['failed_formats'][str(error)] = stats['failed_formats'].get(str(error), 0) + 1
            continue
        words = sum(len(text.split()) for _, text in pages)
        candidates.append((FORMATS.index(kind), path, sha, pages, low, words))
    if not candidates:
        return None
    best = max(c[5] for c in candidates)
    eligible = [c for c in candidates if c[5] >= 0.8 * best]
    _, path, sha, pages, low, words = min(eligible, key=lambda c: (c[0], c[1]))
    return {'path': path, 'sha256': sha, 'format': file_format(path), 'pages': pages, 'low_text_pages': low, 'words': words}


def passage_id(source_id, sha256, ordinal, text_sha256):
    return digest('\n'.join([source_id, sha256, str(ordinal), text_sha256]).encode('utf-8'))[:32]


def collect(candidate, root, limit=None):
    payload, lineage = read_core(candidate)
    root = Path(root).resolve()
    rules = load_rules(root / 'reports/privacy-exclusions.json')
    sources = editions(payload, lineage)
    if limit is not None:
        sources = dict(list(sources.items())[:limit])
    stats = {'sources': len(sources), 'sources_with_text': 0, 'sources_without_text': [], 'low_text_pages': 0,
             'pages': 0, 'words': 0, 'passages': 0, 'formats': {}, 'skipped_formats': {}, 'failed_formats': {}}
    rows, provenance = [], {}
    for sid, files in sources.items():
        chosen = select_edition(root, rules, sid, files, stats)
        if chosen is None or not chosen['pages']:
            stats['sources_without_text'].append(sid)
            stats['low_text_pages'] += chosen['low_text_pages'] if chosen else 0
            continue
        stats['sources_with_text'] += 1
        stats['low_text_pages'] += chosen['low_text_pages']
        stats['pages'] += len(chosen['pages'])
        stats['words'] += chosen['words']
        stats['formats'][chosen['format']] = stats['formats'].get(chosen['format'], 0) + 1
        for ordinal, part in enumerate(chunk(chosen['pages'])):
            text_sha = digest(part['text'].encode('utf-8'))
            rows.append({'passage_id': passage_id(sid, chosen['sha256'], ordinal, text_sha), 'source_id': sid,
                         'sha256': chosen['sha256'], 'ordinal': ordinal, 'page_start': part['page_start'],
                         'page_end': part['page_end'], 'text': part['text'], 'text_sha256': text_sha})
            provenance.setdefault(text_sha, set()).add((sid, chosen['path'], chosen['sha256']))
    stats['passages'] = len(rows)
    return payload, rules, sorted(rows, key=lambda r: r['passage_id']), provenance, stats


# --- embeddings --------------------------------------------------------------

def api_key():
    if os.environ.get('OPENROUTER_API_KEY'):
        return os.environ['OPENROUTER_API_KEY'].strip()
    if os.environ.get('OPENROUTER_API_KEY_FILE'):
        return Path(os.environ['OPENROUTER_API_KEY_FILE']).read_text().strip()
    raise ValueError('OPENROUTER_API_KEY or OPENROUTER_API_KEY_FILE is required')


def check_vector(vector, dims=DIMS):
    require(isinstance(vector, list) and len(vector) == dims, 'embedding', 'unexpected dimensions')
    require(all(type(x) in (int, float) and math.isfinite(x) for x in vector), 'embedding', 'non-finite value')
    require(any(x != 0 for x in vector), 'embedding', 'zero vector')


class OpenRouterEmbedder:
    provider = 'openrouter'

    def __init__(self, model=MODEL, key=None, batch_size=32, retries=6, timeout=120):
        self.model, self.key, self.batch_size, self.retries, self.timeout = model, key or api_key(), batch_size, retries, timeout

    def __call__(self, texts):
        body = json.dumps({'model': self.model, 'input': texts, 'encoding_format': 'float',
                           'provider': {'data_collection': 'deny', 'allow_fallbacks': False}}).encode()
        for attempt in range(self.retries):
            try:
                request = urllib.request.Request(ENDPOINT, data=body, method='POST', headers={
                    'Authorization': 'Bearer ' + self.key, 'Content-Type': 'application/json'})
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    value = json.loads(response.read())
                data = sorted(value['data'], key=lambda item: item['index'])
                require([item['index'] for item in data] == list(range(len(texts))), 'embedding', 'response count/order mismatch')
                vectors = [item['embedding'] for item in data]
                for vector in vectors:
                    check_vector(vector)
                require(isinstance(value.get('model'), str) and value['model'], 'embedding', 'missing returned model')
                return vectors, value['model']
            except urllib.error.HTTPError as error:
                if error.code not in (408, 409, 425, 429) and error.code < 500:
                    raise ValueError(f'embedding request rejected (HTTP {error.code})') from None
                failure = f'HTTP {error.code}'
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
                failure = type(error).__name__  # Never echo response bodies or headers.
            if attempt + 1 < self.retries:
                time.sleep(min(60, 2 ** attempt))
        raise ValueError(f'embedding request failed after {self.retries} attempts ({failure})')


def synthetic_embedder(texts):
    """Deterministic, offline vectors for tests and synthetic fixtures only."""
    vectors = []
    for text in texts:
        seed = digest(text.encode('utf-8'))
        vectors.append([(int(digest(f'{seed}:{i // 8}'.encode())[(i % 8) * 8:(i % 8) * 8 + 8], 16) / 2 ** 31) - 1
                        for i in range(DIMS)])
    return vectors, 'synthetic/hash'


synthetic_embedder.provider = 'synthetic'
synthetic_embedder.batch_size = 64


class Cache:
    """Embeddings keyed by model and text hash. Provenance permits privacy purges."""

    def __init__(self, directory):
        directory = Path(directory)
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.db = sqlite3.connect(directory / 'embeddings.sqlite3')
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS embeddings(model TEXT, text_sha256 TEXT, returned_model TEXT, vector TEXT,
            PRIMARY KEY(model, text_sha256));
          CREATE TABLE IF NOT EXISTS provenance(model TEXT, text_sha256 TEXT, source_id TEXT, path TEXT, sha256 TEXT,
            PRIMARY KEY(model, text_sha256, source_id, path, sha256));''')

    def close(self):
        self.db.close()

    def purge(self, rules):
        with self.db:
            for column, values in (('source_id', {canonical_id(v) for v in rules['source_ids']}),
                                   ('path', set(rules['paths'])), ('sha256', set(rules['sha256']))):
                self.db.executemany(f'DELETE FROM provenance WHERE {column}=?', [(v,) for v in sorted(values)])
            self.db.execute('DELETE FROM embeddings WHERE NOT EXISTS (SELECT 1 FROM provenance p '
                            'WHERE p.model=embeddings.model AND p.text_sha256=embeddings.text_sha256)')

    def get(self, model, text_sha):
        row = self.db.execute('SELECT returned_model, vector FROM embeddings WHERE model=? AND text_sha256=?',
                              (model, text_sha)).fetchone()
        return (json.loads(row[1]), row[0]) if row else None

    def put(self, model, items, provenance):
        with self.db:
            for text_sha, vector, returned in items:
                self.db.execute('INSERT OR REPLACE INTO embeddings VALUES (?,?,?,?)',
                                (model, text_sha, returned, json.dumps(vector)))
                self.db.executemany('INSERT OR IGNORE INTO provenance VALUES (?,?,?,?,?)',
                                    [(model, text_sha, *p) for p in sorted(provenance.get(text_sha, ()))])

    def link(self, model, provenance):
        with self.db:
            self.db.executemany('INSERT OR IGNORE INTO provenance VALUES (?,?,?,?,?)',
                                [(model, t, *p) for t, items in sorted(provenance.items()) for p in sorted(items)])


def normalized(vector):
    norm = math.sqrt(math.fsum(x * x for x in vector))
    require(norm > 0, 'embedding', 'zero vector')
    result = [round(x / norm, 7) + 0.0 for x in vector]  # + 0.0 folds -0.0 into 0.0.
    require(any(result), 'embedding', 'zero vector after rounding')
    return result


def embed(rows, provenance, cache, model, embedder, log=None):
    unique = sorted({r['text_sha256']: r['text'] for r in rows}.items())
    vectors, returned = {}, set()
    missing = []
    for text_sha, text in unique:
        hit = cache.get(model, text_sha)
        if hit:
            vectors[text_sha], model_name = hit
            returned.add(model_name)
        else:
            missing.append((text_sha, text))
    cache.link(model, {t: p for t, p in provenance.items() if t in vectors})
    batch_size = getattr(embedder, 'batch_size', 32)
    for start in range(0, len(missing), batch_size):
        batch = missing[start:start + batch_size]
        result, model_name = embedder([text for _, text in batch])
        require(len(result) == len(batch), 'embedding', 'response count mismatch')
        for vector in result:
            check_vector(vector)
        cache.put(model, [(t, v, model_name) for (t, _), v in zip(batch, result)], provenance)
        for (text_sha, _), vector in zip(batch, result):
            vectors[text_sha] = vector
        returned.add(model_name)
        if log:
            log(f'embedded {min(start + batch_size, len(missing))}/{len(missing)} new passages')
    require(len(returned) <= 1, 'embedding', 'cache mixes returned models; clear the cache and rebuild')
    for row in rows:
        row['embedding'] = normalized(vectors[row['text_sha256']])
    return returned.pop() if returned else None


# --- output and verification -------------------------------------------------

def rows_digest(rows):
    return digest(''.join(f"{r['passage_id']}:{r['text_sha256']}\n" for r in rows).encode('utf-8'))


def write_atomic(path, content):
    temporary = path.with_name(f'.{path.name}.{os.getpid()}.tmp')
    try:
        with temporary.open('xb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def build_passages(candidate, root, cache_dir, model=MODEL, embedder=None, limit=None, log=None):
    candidate = Path(candidate).absolute()
    require(not candidate.is_symlink() and candidate.resolve() == candidate, 'candidate', 'candidate path must not be a symlink')
    payload, rules, rows, provenance, stats = collect(candidate, root, limit)
    require(rows, 'passages', 'no text extracted')
    embedder = embedder or OpenRouterEmbedder(model)
    cache = Cache(cache_dir)
    try:
        cache.purge(rules)
        returned = embed(rows, provenance, cache, model, embedder, log)
    finally:
        cache.close()
    lines = b''.join(canonical_json({k: r[k] for k in ROW_FIELDS}) + b'\n' for r in rows)
    manifest = {'schema_version': 1, 'content_digest': payload['content_digest'], 'passages_file': 'passages.jsonl',
                'passages_sha256': digest(lines), 'rows_digest': rows_digest(rows), 'passage_count': len(rows),
                'embedding': {'model': model, 'dims': DIMS, 'provider': embedder.provider, 'returned_model': returned},
                'coverage': {k: stats[k] for k in ('sources', 'sources_with_text', 'sources_without_text', 'low_text_pages')}}
    # Never pair a stale manifest with new rows: remove it, replace rows, then add it.
    (candidate / 'passages.json').unlink(missing_ok=True)
    write_atomic(candidate / 'passages.jsonl', lines)
    write_atomic(candidate / 'passages.json', canonical_json(manifest) + b'\n')
    read_core(candidate)  # The candidate itself must not have changed meanwhile.
    return manifest, stats


def verify_passages(candidate, payload, lineage):
    """Publisher check: return the manifest of a five-file candidate, or None for three files."""
    candidate = Path(candidate)
    names = {p.name for p in candidate.iterdir()}
    if names == set(CORE_FILES):
        return None
    require(names == set(CORE_FILES) | set(PASSAGE_FILES), 'candidate', 'unexpected candidate files')
    for name in PASSAGE_FILES:
        require(not (candidate / name).is_symlink() and (candidate / name).is_file(), 'passages', 'not a regular file')
    manifest = read_json(candidate / 'passages.json')
    require(sorted(manifest) == list(MANIFEST_FIELDS) and manifest['schema_version'] == 1
            and manifest['passages_file'] == 'passages.jsonl' and manifest['content_digest'] == payload['content_digest']
            and isinstance(manifest['passages_sha256'], str) and HEX64.fullmatch(manifest['passages_sha256'])
            and isinstance(manifest['rows_digest'], str) and HEX64.fullmatch(manifest['rows_digest'])
            and type(manifest['passage_count']) is int and manifest['passage_count'] > 0, 'passages', 'invalid manifest')
    embedding = manifest['embedding']
    require(isinstance(embedding, dict) and sorted(embedding) == ['dims', 'model', 'provider', 'returned_model']
            and embedding['dims'] == DIMS and isinstance(embedding['model'], str)
            and re.fullmatch(r'[a-z0-9._/-]{1,128}', embedding['model'] or '')
            and isinstance(embedding['provider'], str) and embedding['provider']
            and isinstance(embedding['returned_model'], str), 'passages', 'invalid embedding metadata')
    coverage = manifest['coverage']
    require(isinstance(coverage, dict) and sorted(coverage) == ['low_text_pages', 'sources', 'sources_with_text', 'sources_without_text'],
            'passages', 'invalid coverage')
    public = {canonical_id(s['source_id']) for s in payload['sources']}
    files = {(canonical_id(s['source_id']), f['sha256']) for s in lineage['sources'] for f in s['files']}
    hasher, digest_lines, count, previous, ordinals = hashlib.sha256(), hashlib.sha256(), 0, '', {}
    with (candidate / 'passages.jsonl').open('rb') as stream:
        for line in stream:
            hasher.update(line)
            row = json.loads(line)
            require(isinstance(row, dict) and sorted(row) == list(ROW_FIELDS) and line == canonical_json(row) + b'\n',
                    'passages', 'invalid row')
            require(isinstance(row['text'], str) and row['text'] and row['text'] == normalize(row['text'])
                    and row['text_sha256'] == digest(row['text'].encode('utf-8')), 'passages', 'text hash mismatch')
            require(type(row['ordinal']) is int and row['ordinal'] >= 0 and isinstance(row['source_id'], str)
                    and isinstance(row['sha256'], str)
                    and row['passage_id'] == passage_id(row['source_id'], row['sha256'], row['ordinal'], row['text_sha256'])
                    and row['passage_id'] > previous, 'passages', 'invalid or unsorted passage identity')
            require(row['source_id'] in public and (row['source_id'], row['sha256']) in files, 'passages', 'passage outside lineage')
            start, end = row['page_start'], row['page_end']
            require((start is None and end is None) or (type(start) is int and type(end) is int and 1 <= start <= end),
                    'passages', 'invalid page range')
            check_vector(row['embedding'])
            previous = row['passage_id']
            ordinals.setdefault((row['source_id'], row['sha256']), []).append(row['ordinal'])
            digest_lines.update(f"{row['passage_id']}:{row['text_sha256']}\n".encode('utf-8'))
            count += 1
    require(len({sid for sid, _ in ordinals}) == len(ordinals), 'passages', 'one edition per source')
    require(all(sorted(v) == list(range(len(v))) for v in ordinals.values()), 'passages', 'non-contiguous ordinals')
    require(hasher.hexdigest() == manifest['passages_sha256'] and count == manifest['passage_count']
            and digest_lines.hexdigest() == manifest['rows_digest'], 'passages', 'manifest mismatch')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', required=True, type=Path)
    parser.add_argument('--root', type=Path, default=Path(os.environ.get('SCHOOL_BOARD_ROOT', '/rocky/open-valley/school-board')))
    parser.add_argument('--cache', type=Path, help='Private embedding cache directory (required unless --extract-only)')
    parser.add_argument('--embed-model', default=MODEL)
    parser.add_argument('--limit-sources', type=int, help='Smoke test: only the first N payload sources by ID')
    parser.add_argument('--extract-only', action='store_true', help='Report extraction coverage; write nothing, no network')
    args = parser.parse_args()
    try:
        if args.extract_only:
            stats = collect(args.candidate.absolute(), args.root, args.limit_sources)[4]
            stats['sources_without_text_count'] = len(stats['sources_without_text'])
            print(json.dumps(stats, indent=2, sort_keys=True))
            return
        require(args.cache is not None, 'cache', '--cache is required')
        manifest, _ = build_passages(args.candidate, args.root, args.cache, args.embed_model, limit=args.limit_sources,
                                     log=lambda message: print(message, file=sys.stderr, flush=True))
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(2, f'Passages rejected: {error}\n')
    print(json.dumps({k: manifest[k] for k in ('content_digest', 'passage_count', 'rows_digest', 'coverage')}))


if __name__ == '__main__':
    main()
