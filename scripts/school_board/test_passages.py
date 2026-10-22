"""Synthetic passage tests. No archive, no network, no real embeddings."""
import io
import json
import math
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest import mock
import urllib.error
import zipfile

import build_passages as bp
from build_public_snapshot import canonical_json, digest

sys.path.insert(0, str(Path(__file__).resolve().parent / 'publication-fixtures'))
from generate import generate


def zip_bytes(members):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        for name, value in members.items():
            archive.writestr(name, value)
    return buffer.getvalue()


def minimal_pdf(pages):
    """A tiny uncompressed PDF with one text line per page."""
    objects = ['<< /Type /Catalog /Pages 2 0 R >>', None, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    kids = []
    for text in pages:
        stream = f'BT /F1 12 Tf 72 720 Td ({text}) Tj ET'
        objects.append(f'<< /Length {len(stream)} >>\nstream\n{stream}\nendstream')
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {len(objects)} 0 R '
                       '/Resources << /Font << /F1 3 0 R >> >> >>')
        kids.append(f'{len(objects)} 0 R')
    objects[1] = f'<< /Type /Pages /Kids [{" ".join(kids)}] /Count {len(kids)} >>'
    out, offsets = bytearray(b'%PDF-1.4\n'), []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f'{number} 0 obj\n{body}\nendobj\n'.encode()
    xref = len(out)
    out += f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode()
    out += b''.join(f'{o:010d} 00000 n \n'.encode() for o in offsets)
    out += f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    return bytes(out)


class CountingEmbedder:
    provider, batch_size = 'synthetic', 4

    def __init__(self):
        self.calls = 0

    def __call__(self, texts):
        self.calls += 1
        return bp.synthetic_embedder(texts)


class ExtractionTest(unittest.TestCase):
    def test_text_and_reviewed_page_markers(self):
        pages, low = bp.extract('a.txt', '﻿Board  minutes of the\tmeeting'.encode())
        self.assertEqual(pages, [(None, 'Board minutes of the meeting')])
        self.assertEqual(low, 0)
        marked = 'PDF page 1\nfirst page words here\n\nPDF page 2\nx\nPDF page 3\nthird page has words'.encode()
        pages, low = bp.extract('b.txt', marked)
        self.assertEqual(pages, [(1, 'first page words here'), (3, 'third page has words')])
        self.assertEqual(low, 3)  # All three are under the low-text threshold; page 2 is dropped.

    def test_html_strips_scripts_styles_and_head(self):
        html = (b'<html><head><title>T</title><style>.x{color:red}</style></head><body><script>alert(1)</script>'
                b'<p>School <b>board</b> agenda</p><div>Item&nbsp;one</div><noscript>no</noscript></body></html>')
        self.assertEqual(bp.extract('a.html', html)[0], [(None, 'School board agenda Item one')])

    def test_docx_pptx_xlsx(self):
        w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
        docx = zip_bytes({'word/document.xml': f'<w:document {w}><w:body><w:p><w:r><w:t>Policy</w:t><w:tab/>'
                          f'<w:t>adopted today</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>'})
        self.assertEqual(bp.extract('a.docx', docx)[0], [(None, 'Policy adopted today Second paragraph')])
        ns = ('xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
              'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
              'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"')
        rel = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'
        slide = lambda text: f'<p:sld {ns}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
        pptx = zip_bytes({
            'ppt/presentation.xml': f'<p:presentation {ns}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst></p:presentation>',
            'ppt/_rels/presentation.xml.rels': f'<Relationships {rel}><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>',
            'ppt/slides/slide1.xml': slide('Enrollment forecast slide'), 'ppt/slides/slide2.xml': slide('Title slide words')})
        self.assertEqual(bp.extract('a.pptx', pptx)[0], [(1, 'Title slide words'), (2, 'Enrollment forecast slide')])
        s = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
        xlsx = zip_bytes({
            'xl/workbook.xml': f'<workbook {s}><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>',
            'xl/_rels/workbook.xml.rels': f'<Relationships {rel}><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
            'xl/sharedStrings.xml': f'<sst {s}><si><t>Line item</t></si><si><t>Amount</t></si></sst>',
            'xl/worksheets/sheet1.xml': f'<worksheet {s}><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row>'
                                        f'<row><c t="inlineStr"><is><t>Heat</t></is></c><c><v>1200</v></c></row></sheetData></worksheet>'})
        self.assertEqual(bp.extract('a.xlsx', xlsx)[0], [(None, 'Budget Line item Amount Heat 1200')])

    def test_json_only_when_page_list(self):
        pages = json.dumps([{'page': 1, 'text': 'OCR text of a scanned page', 'method': 'ocr'}]).encode()
        self.assertEqual(bp.extract('x.pages.json', pages)[0], [(1, 'OCR text of a scanned page')])
        for name, data in (('x.json', b'{"features": []}'), ('x.jpg', b'\xff'), ('x.zip', b'PK')):
            with self.assertRaises(bp.Unsupported):
                bp.extract(name, data)
        with self.assertRaises(bp.Unsupported):
            bp.extract('x.docx', b'not a zip')

    @unittest.skipUnless(shutil.which('pdftotext'), 'pdftotext unavailable')
    def test_pdf_physical_pages(self):
        pdf = minimal_pdf(['Alpha page words appear here', '', 'Gamma page words appear here'])
        pages, low = bp.extract('a.pdf', pdf)
        self.assertEqual(pages, [(1, 'Alpha page words appear here'), (3, 'Gamma page words appear here')])
        self.assertEqual(low, 3)


class ChunkTest(unittest.TestCase):
    def test_windows_overlap_and_pages(self):
        pages = [(n, ' '.join(f'p{n}w{i}' for i in range(200))) for n in (1, 2, 3, 4)]
        chunks = bp.chunk(pages)
        words = [c['text'].split() for c in chunks]
        self.assertTrue(all(len(w) <= bp.CHUNK_WORDS + bp.TAIL_WORDS for w in words))
        for left, right in zip(words, words[1:]):
            self.assertEqual(left[-bp.OVERLAP_WORDS:], right[:bp.OVERLAP_WORDS])
        self.assertEqual((chunks[0]['page_start'], chunks[0]['page_end']), (1, 2))
        self.assertEqual(chunks[-1]['page_end'], 4)
        self.assertEqual(words[-1][-1], 'p4w199')

    def test_short_tail_folds_and_unpaged(self):
        chunks = bp.chunk([(None, ' '.join(['w'] * (bp.CHUNK_WORDS + bp.TAIL_WORDS - 1)))])
        self.assertEqual(len(chunks), 1)
        self.assertEqual((chunks[0]['page_start'], chunks[0]['page_end']), (None, None))
        self.assertEqual(bp.chunk([]), [])


class BuildTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR'))
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name) / 'fixture'
        generate(self.base)
        self.root, self.candidate, self.cache = self.base / 'collection', self.base / 'candidate', self.base / 'cache'
        # A second reviewed edition with pages; the long PDF-marked text wins over the short one.
        long_text = '\n'.join(f'PDF page {n}\n' + ' '.join(f'report{n}word{i}' for i in range(150)) for n in (1, 2, 3))
        (self.root / 'files/original.txt').write_text(long_text)
        lineage = json.loads((self.candidate / 'lineage.json').read_text())
        for source in lineage['sources']:
            for item in source['files']:
                if item['path'] == 'files/original.txt':
                    item['sha256'] = digest(long_text.encode())
        self.rewrite_lineage(lineage)

    def rewrite_lineage(self, lineage):
        data = canonical_json(lineage) + b'\n'
        (self.candidate / 'lineage.json').write_bytes(data)
        manifest = json.loads((self.candidate / 'candidate.json').read_text())
        manifest['lineage_sha256'] = digest(data)
        (self.candidate / 'candidate.json').write_bytes(canonical_json(manifest) + b'\n')

    def build(self, embedder=None):
        return bp.build_passages(self.candidate, self.root, self.cache, embedder=embedder or CountingEmbedder())

    def rows(self):
        return [json.loads(line) for line in (self.candidate / 'passages.jsonl').read_bytes().splitlines()]

    def payload_lineage(self):
        return (json.loads((self.candidate / 'payload.json').read_text()),
                json.loads((self.candidate / 'lineage.json').read_text()))

    def test_build_rows_manifest_and_verification(self):
        manifest, stats = self.build()
        rows = self.rows()
        self.assertEqual(sorted(p.name for p in self.candidate.iterdir()),
                         ['candidate.json', 'lineage.json', 'passages.json', 'passages.jsonl', 'payload.json'])
        self.assertEqual([r['passage_id'] for r in rows], sorted(r['passage_id'] for r in rows))
        self.assertEqual({r['source_id'] for r in rows}, {'report'})  # Payload sources only, never alias-only sources.
        self.assertEqual(sorted(r['ordinal'] for r in rows), list(range(len(rows))))
        first = min(rows, key=lambda r: r['ordinal'])
        self.assertEqual((first['page_start'], first['page_end']), (1, 3))
        for row in rows:
            self.assertEqual(row['text_sha256'], digest(row['text'].encode()))
            self.assertEqual(row['passage_id'], digest(f"report\n{row['sha256']}\n{row['ordinal']}\n{row['text_sha256']}".encode())[:32])
            self.assertEqual(len(row['embedding']), 1024)
            self.assertAlmostEqual(math.sqrt(sum(x * x for x in row['embedding'])), 1, places=4)
            self.assertTrue(all(round(x, 7) == x for x in row['embedding']))
        expected_digest = digest(''.join(f"{r['passage_id']}:{r['text_sha256']}\n" for r in rows).encode())
        self.assertEqual(manifest['rows_digest'], expected_digest)
        self.assertEqual(manifest['passages_sha256'], digest((self.candidate / 'passages.jsonl').read_bytes()))
        self.assertEqual(manifest['coverage'], {'sources': 1, 'sources_with_text': 1, 'sources_without_text': [], 'low_text_pages': 0})
        self.assertEqual(manifest['embedding'], {'model': 'baai/bge-m3', 'dims': 1024, 'provider': 'synthetic', 'returned_model': 'synthetic/hash'})
        self.assertEqual(stats['passages'], len(rows))
        self.assertEqual(bp.verify_passages(self.candidate, *self.payload_lineage()), manifest)

    def test_deterministic_rebuild_uses_warm_cache(self):
        first = CountingEmbedder()
        self.build(first)
        before = {n: (self.candidate / n).read_bytes() for n in bp.PASSAGE_FILES}
        second = CountingEmbedder()
        self.build(second)
        self.assertGreater(first.calls, 0)
        self.assertEqual(second.calls, 0)
        self.assertEqual({n: (self.candidate / n).read_bytes() for n in bp.PASSAGE_FILES}, before)
        shutil.rmtree(self.cache)  # Cold cache with the same deterministic vectors is also identical.
        self.build()
        self.assertEqual({n: (self.candidate / n).read_bytes() for n in bp.PASSAGE_FILES}, before)

    def test_source_hash_is_rechecked(self):
        (self.root / 'files/original.txt').write_text('changed edition after review')
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            self.build()
        self.assertFalse((self.candidate / 'passages.json').exists())

    def test_tampered_candidate_and_excluded_source_rejected(self):
        payload = (self.candidate / 'payload.json').read_bytes()
        (self.candidate / 'payload.json').write_bytes(payload.replace(b'Synthetic', b'Changed', 1))
        with self.assertRaisesRegex(ValueError, 'candidate hash mismatch'):
            self.build()
        (self.candidate / 'payload.json').write_bytes(payload)
        self.build()
        policy = self.root / 'reports/privacy-exclusions.json'
        policy.write_text(json.dumps({'schema_version': 1, 'source_ids': [], 'paths': ['files/original.txt'], 'sha256': []}))
        with self.assertRaisesRegex(ValueError, 'excluded source'):
            self.build()

    def test_cache_purges_excluded_provenance(self):
        self.build()
        cache = bp.Cache(self.cache)
        self.addCleanup(cache.close)
        self.assertGreater(cache.db.execute('SELECT count(*) FROM embeddings').fetchone()[0], 0)
        cache.purge({'source_ids': ['report'], 'paths': [], 'sha256': []})
        self.assertEqual(cache.db.execute('SELECT count(*) FROM embeddings').fetchone()[0], 0)
        self.assertEqual(cache.db.execute('SELECT count(*) FROM provenance').fetchone()[0], 0)

    def test_tampered_passages_rejected(self):
        self.build()
        payload, lineage = self.payload_lineage()
        jsonl, manifest_path = self.candidate / 'passages.jsonl', self.candidate / 'passages.json'
        original_rows, original_manifest = jsonl.read_bytes(), manifest_path.read_bytes()
        manifest = json.loads(original_manifest)

        def with_rows(rows, fix_manifest=True):
            data = b''.join(canonical_json(r) + b'\n' for r in rows)
            jsonl.write_bytes(data)
            value = dict(manifest)
            if fix_manifest:
                value.update(passages_sha256=digest(data), passage_count=len(rows),
                             rows_digest=digest(''.join(f"{r['passage_id']}:{r['text_sha256']}\n" for r in rows).encode()))
            manifest_path.write_bytes(canonical_json(value) + b'\n')

        rows = self.rows()
        cases = {
            'edited text': [dict(rows[0], text=rows[0]['text'] + ' extra')] + rows[1:],
            'unsorted': list(reversed(rows)),
            'outside lineage': [dict(r, sha256='0' * 64) for r in rows],
            'wrong dims': [dict(rows[0], embedding=rows[0]['embedding'][:-1])] + rows[1:],
            'zero vector': [dict(rows[0], embedding=[0.0] * 1024)] + rows[1:],
        }
        for label, value in cases.items():
            with self.subTest(label):
                with_rows(value)
                with self.assertRaises(ValueError):
                    bp.verify_passages(self.candidate, payload, lineage)
        with self.subTest('stale manifest'):
            with_rows(rows[:-1], fix_manifest=False)
            with self.assertRaises(ValueError):
                bp.verify_passages(self.candidate, payload, lineage)
        with self.subTest('other content digest'):
            jsonl.write_bytes(original_rows)
            manifest_path.write_bytes(canonical_json(dict(manifest, content_digest='f' * 64)) + b'\n')
            with self.assertRaises(ValueError):
                bp.verify_passages(self.candidate, payload, lineage)
        with self.subTest('four files'):
            manifest_path.unlink()
            with self.assertRaises(ValueError):
                bp.verify_passages(self.candidate, payload, lineage)
        jsonl.unlink()
        self.assertIsNone(bp.verify_passages(self.candidate, payload, lineage))

    def test_embedder_output_is_validated(self):
        def short(texts):
            return [[1.0] * 1023 for _ in texts], 'x'
        short.provider = 'synthetic'
        with self.assertRaisesRegex(ValueError, 'dimensions'):
            self.build(short)

        def missing(texts):
            return [[1.0] * 1024 for _ in texts][:-1], 'x'
        missing.provider = 'synthetic'
        with self.assertRaisesRegex(ValueError, 'count'):
            self.build(missing)
        self.assertFalse((self.candidate / 'passages.jsonl').exists())


class OpenRouterTest(unittest.TestCase):
    def response(self, data):
        return io.BytesIO(json.dumps(data).encode())

    def test_request_shape_order_and_retry(self):
        vectors = [[0.5] * 1024, [0.25] * 1024]
        calls = []

        def urlopen(request, timeout):
            calls.append(json.loads(request.data))
            self.assertEqual(request.get_header('Authorization'), 'Bearer synthetic-key')
            if len(calls) == 1:
                raise urllib.error.HTTPError(request.full_url, 429, 'busy', {}, io.BytesIO())
            return self.response({'model': 'BAAI/bge-m3', 'data': [
                {'index': 1, 'embedding': vectors[1]}, {'index': 0, 'embedding': vectors[0]}]})

        embedder = bp.OpenRouterEmbedder(key='synthetic-key')
        with mock.patch('urllib.request.urlopen', urlopen), mock.patch('time.sleep'):
            result, model = embedder(['a', 'b'])
        self.assertEqual((result, model), (vectors, 'BAAI/bge-m3'))
        self.assertEqual(calls[0], {'model': 'baai/bge-m3', 'input': ['a', 'b'], 'encoding_format': 'float',
                                    'provider': {'data_collection': 'deny', 'allow_fallbacks': False}})

    def test_rejection_does_not_echo_key(self):
        def urlopen(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 401, 'no', {}, io.BytesIO())
        with mock.patch('urllib.request.urlopen', urlopen):
            with self.assertRaises(ValueError) as caught:
                bp.OpenRouterEmbedder(key='synthetic-key')(['a'])
        self.assertNotIn('synthetic-key', str(caught.exception))


if __name__ == '__main__':
    unittest.main()
